#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/autodeploy.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

make_stubs() {
  local case_dir=$1
  local changed=$2
  mkdir -p "$case_dir/bin" "$case_dir/repo/deploy"
  printf '%b' "$changed" > "$case_dir/changed"
  : > "$case_dir/docker.calls"
  cat > "$case_dir/bin/git" <<STUB
#!/usr/bin/env bash
case "\$*" in
  'fetch --no-recurse-submodules origin prod') exit 0 ;;
  'rev-parse origin/prod') echo new-revision ;;
  'diff --no-renames --name-only old-revision new-revision') cat "$case_dir/changed" ;;
  'reset --hard new-revision') echo 'HEAD is now at new-revision' ;;
  *) echo "unexpected git command: \$*" >&2; exit 2 ;;
esac
STUB
  cat > "$case_dir/bin/docker" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$case_dir/docker.calls"
case "\$*" in
  'compose up -d --build'|'tag postiz-max:local postiz-max:prev') exit 0 ;;
  *) exit 2 ;;
esac
STUB
  cat > "$case_dir/bin/flock" <<'STUB'
#!/usr/bin/env bash
[[ "$*" == '-n 9' ]] || exit 2
STUB
  chmod +x "$case_dir/bin/git" "$case_dir/bin/docker" "$case_dir/bin/flock"
}

run_case() {
  local name=$1
  local readiness_exit=$2
  local changed=${3:-'apps/backend/src/main.ts\n'}
  local case_dir="$TMP_DIR/$name"
  make_stubs "$case_dir" "$changed"
  printf '%s\n' old-revision > "$case_dir/state"
  cat > "$case_dir/readiness" <<STUB
#!/usr/bin/env bash
echo readiness-exit-$readiness_exit
exit $readiness_exit
STUB
  chmod +x "$case_dir/readiness"

  PATH="$case_dir/bin:$PATH" \
    REPO_DIR="$case_dir/repo" \
    AUTODEPLOY_LOG="$case_dir/autodeploy.log" \
    AUTODEPLOY_LOCK="$case_dir/autodeploy.lock" \
    AUTODEPLOY_STATE="$case_dir/state" \
    READINESS_SCRIPT="$case_dir/readiness" \
    bash "$SCRIPT"
}

run_case success 0
[[ "$(cat "$TMP_DIR/success/state")" == new-revision ]] ||
  fail 'successful readiness did not advance marker'
grep -q 'deploy finished' "$TMP_DIR/success/autodeploy.log" ||
  fail 'successful readiness did not finish deploy'
grep -qx 'compose up -d --build' "$TMP_DIR/success/docker.calls" ||
  fail 'a code change did not rebuild the image'
[[ "$(head -1 "$TMP_DIR/success/docker.calls")" == 'tag postiz-max:local postiz-max:prev' ]] ||
  fail 'the running image was not kept as :prev before the rebuild'

if run_case failure 1; then
  fail 'failed readiness was reported as successful'
fi
[[ "$(cat "$TMP_DIR/failure/state")" == old-revision ]] ||
  fail 'failed readiness advanced marker'
! grep -q 'deploy finished' "$TMP_DIR/failure/autodeploy.log" ||
  fail 'failed readiness logged deploy finished'
grep -q 'readiness-exit-1' "$TMP_DIR/failure/autodeploy.log" ||
  fail 'readiness diagnostics were not retained'

run_case static 0 'deploy/landing/index.html\ndeploy/blog/articles/a.html\ndocs/PROJECT.md\nREADME.md\n'
! grep -q 'compose' "$TMP_DIR/static/docker.calls" ||
  fail 'a landing/blog/docs-only change rebuilt the image'
grep -q 'image rebuild skipped' "$TMP_DIR/static/autodeploy.log" ||
  fail 'a skipped rebuild was not logged'
[[ "$(cat "$TMP_DIR/static/state")" == new-revision ]] ||
  fail 'a static-only deploy did not advance marker'

run_case mixed 0 'deploy/landing/index.html\ndocker-compose.override.yaml\n'
grep -qx 'compose up -d --build' "$TMP_DIR/mixed/docker.calls" ||
  fail 'a compose change next to a landing change skipped the rebuild'

grep -q 'docs/server-scripts/29-apply-caddyfile.sh' "$SCRIPT" ||
  fail 'a changed Caddyfile is not applied on deploy'

echo 'Autodeploy readiness-gate tests passed'
