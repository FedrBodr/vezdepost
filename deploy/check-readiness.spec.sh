#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/check-readiness.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

make_docker_stub() {
  local bin_dir=$1
  mkdir -p "$bin_dir"
  cat > "$bin_dir/docker" <<'STUB'
#!/usr/bin/env bash
set -u
printf '%s\n' "$*" >> "$DOCKER_CALLS"

if [[ "$1 $2" == 'inspect -f' ]]; then
  printf '%s\n' true
  exit 0
fi

if [[ "$*" == *'temporal task-queue describe'* ]]; then
  if [[ "${MISSING_POLLER:-0}" == 1 ]]; then
    printf '%s\n' 'Pollers: []'
  else
    printf '%s\n' 'Identity 123@postiz'
  fi
  exit 0
fi

if [[ "$*" == *"grep -qE ':3000"* ]]; then
  count=$(cat "$BACKEND_CHECKS" 2>/dev/null || echo 0)
  count=$((count + 1))
  printf '%s\n' "$count" > "$BACKEND_CHECKS"
  [[ "${MISSING_BACKEND:-0}" != 1 && "$count" -gt "${BACKEND_FAILS:-0}" ]]
  exit
fi

if [[ "$*" == *"grep -qE ':4200"* || "$*" == *"grep -qE ':5000"* ]]; then
  exit 0
fi

if [[ "${FAIL_DIAGNOSTICS:-0}" == 1 && "$*" == *'pm2 '* ]]; then
  exit 1
fi

exit 0
STUB
  chmod +x "$bin_dir/docker"
}

run_probe() {
  local name=$1
  shift
  local case_dir="$TMP_DIR/$name"
  local bin_dir="$case_dir/bin"
  mkdir -p "$case_dir"
  make_docker_stub "$bin_dir"
  : > "$case_dir/docker.calls"
  PATH="$bin_dir:$PATH" \
    DOCKER_CALLS="$case_dir/docker.calls" \
    BACKEND_CHECKS="$case_dir/backend.checks" \
    POSTIZ_READINESS_INTERVAL_SECONDS=0 \
    "$@" bash "$SCRIPT"
}

run_probe immediate env POSTIZ_READINESS_ATTEMPTS=1 \
  > "$TMP_DIR/immediate.out" || fail 'ready stack was rejected'
grep -q 'readiness passed' "$TMP_DIR/immediate.out" ||
  fail 'success confirmation missing'

run_probe delayed env POSTIZ_READINESS_ATTEMPTS=2 BACKEND_FAILS=1 \
  > "$TMP_DIR/delayed.out" || fail 'delayed backend never became ready'

if run_probe backend-timeout env POSTIZ_READINESS_ATTEMPTS=1 MISSING_BACKEND=1 \
  > "$TMP_DIR/backend-timeout.out" 2>&1; then
  fail 'missing backend was accepted'
fi
grep -q 'readiness timed out' "$TMP_DIR/backend-timeout.out" ||
  fail 'timeout message missing'

if run_probe poller-timeout env POSTIZ_READINESS_ATTEMPTS=1 MISSING_POLLER=1 \
  > "$TMP_DIR/poller-timeout.out" 2>&1; then
  fail 'missing Temporal poller was accepted'
fi

if run_probe diagnostic-failure env POSTIZ_READINESS_ATTEMPTS=1 \
  MISSING_BACKEND=1 FAIL_DIAGNOSTICS=1 \
  > "$TMP_DIR/diagnostic-failure.out" 2>&1; then
  fail 'diagnostic failure changed timeout into success'
fi
grep -q 'listening ports' "$TMP_DIR/diagnostic-failure.out" ||
  fail 'remaining diagnostics were suppressed'

echo 'Readiness probe tests passed'
