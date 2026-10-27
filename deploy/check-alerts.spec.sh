#!/usr/bin/env bash
# Tests for the deploy-health checks added to check-alerts.sh:
#   - the autodeploy poller cron going missing (the 2026-10-24 failure)
#   - prod drifting behind origin/prod for longer than the grace window
# docker/git are stubbed so the earlier liveness checks pass and execution
# reaches the new checks.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/check-alerts.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# a healthy host: postiz running, backend answers, logs empty
make_docker_stub() {
  cat > "$1/docker" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  ps) echo postiz ;;
  exec) exit 0 ;;
  logs) : ;;
  *) : ;;
esac
STUB
  chmod +x "$1/docker"
}
make_git_stub() {
  cat > "$1/git" <<STUB
#!/usr/bin/env bash
# args: -C <dir> <cmd...>
cmd="\${3:-}"
case "\$cmd" in
  fetch) exit 0 ;;
  rev-parse) echo "\${GIT_REMOTE_REV:-origin-rev}" ;;
  *) exit 0 ;;
esac
STUB
  chmod +x "$1/git"
}

setup() { local d="$TMP_DIR/$1"; mkdir -p "$d/bin" "$d/repo/.git" "$d/state"; make_docker_stub "$d/bin"; make_git_stub "$d/bin"; echo "$d"; }
drive() { # dir extra-env...
  local d=$1; shift
  env PATH="$d/bin:$PATH" REPO_DIR="$d/repo" STATE_DIR="$d/state" \
    AUTODEPLOY_CRON="$d/cron" AUTODEPLOY_STATE="$d/deployed-rev" \
    DRIFT_GRACE_MINUTES=30 "$@" bash "$SCRIPT" >/dev/null 2>&1 || true
}

# Case A: poller cron missing, no drift -> only the poller alert
A=$(setup caseA); printf rev1 > "$A/deployed-rev"
drive "$A" GIT_REMOTE_REV=rev1
grep -qi 'autodeploy poller is NOT installed' "$A/state/alerts.log" ||
  fail 'missing poller cron did not alert'

# Case B: poller present, drift older than grace -> drift alert
B=$(setup caseB); : > "$B/cron"; printf oldrev > "$B/deployed-rev"
printf '%s' "$(( $(date +%s) - 40*60 ))" > "$B/state/deploy_drift.since"
drive "$B" GIT_REMOTE_REV=newrev
grep -qi 'behind origin/prod' "$B/state/alerts.log" ||
  fail 'persistent drift did not alert'

# Case C: poller present, drift just started (within grace) -> no alert yet
C=$(setup caseC); : > "$C/cron"; printf oldrev > "$C/deployed-rev"
drive "$C" GIT_REMOTE_REV=newrev
[[ ! -s "$C/state/alerts.log" ]] ||
  fail 'fresh drift alerted before the grace window'
[[ -f "$C/state/deploy_drift.since" ]] ||
  fail 'fresh drift did not record a first-seen marker'

# Case D: in sync -> no alert, drift marker cleared
D=$(setup caseD); : > "$D/cron"; printf samerev > "$D/deployed-rev"
printf '%s' "$(date +%s)" > "$D/state/deploy_drift.since"
drive "$D" GIT_REMOTE_REV=samerev
[[ ! -s "$D/state/alerts.log" ]] || fail 'in-sync prod alerted'
[[ ! -f "$D/state/deploy_drift.since" ]] ||
  fail 'in-sync prod did not clear the drift marker'

echo 'check-alerts.spec.sh: all tests passed'
