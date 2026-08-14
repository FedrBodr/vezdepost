#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/autodeploy.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

make_stubs() {
  local case_dir=$1
  mkdir -p "$case_dir/bin" "$case_dir/repo/deploy"
  cat > "$case_dir/bin/git" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  'fetch --no-recurse-submodules origin prod') exit 0 ;;
  'rev-parse origin/prod') echo new-revision ;;
  'reset --hard new-revision') echo 'HEAD is now at new-revision' ;;
  *) echo "unexpected git command: $*" >&2; exit 2 ;;
esac
STUB
  cat > "$case_dir/bin/docker" <<'STUB'
#!/usr/bin/env bash
[[ "$*" == 'compose up -d --build' ]] || exit 2
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
  local case_dir="$TMP_DIR/$name"
  make_stubs "$case_dir"
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

if run_case failure 1; then
  fail 'failed readiness was reported as successful'
fi
[[ "$(cat "$TMP_DIR/failure/state")" == old-revision ]] ||
  fail 'failed readiness advanced marker'
! grep -q 'deploy finished' "$TMP_DIR/failure/autodeploy.log" ||
  fail 'failed readiness logged deploy finished'
grep -q 'readiness-exit-1' "$TMP_DIR/failure/autodeploy.log" ||
  fail 'readiness diagnostics were not retained'

echo 'Autodeploy readiness-gate tests passed'
