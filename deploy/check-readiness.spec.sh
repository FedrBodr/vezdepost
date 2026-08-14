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
  if [[ "$*" == *'{{.State.Running}} {{.Config.Hostname}}'* && \
    "${HANG_INSPECT:-0}" == 1 ]]; then
    sleep 30
  fi
  if [[ "$*" == *'.Config.Hostname'* ]]; then
    if [[ "${STOPPED_POSTIZ:-0}" == 1 ]]; then
      printf '%s\n' 'false current-host'
    else
      printf '%s\n' 'true current-host'
    fi
  elif [[ "${STOPPED_POSTIZ:-0}" == 1 ]]; then
    printf '%s\n' false
  else
    printf '%s\n' true
  fi
  exit 0
fi

if [[ "$*" == *'temporal task-queue describe'* ]]; then
  if [[ "${MISSING_POLLER:-0}" == 1 ]]; then
    printf '%s\n' 'Pollers: []'
  elif [[ "${STALE_POLLER:-0}" == 1 ]]; then
    printf '%s\n' 'Identity 123@old-host'
  else
    printf '%s\n' 'Identity 123@current-host'
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

if [[ "$*" == *"grep -qE ':4200"* ]]; then
  [[ "${MISSING_FRONTEND:-0}" != 1 ]]
  exit
fi

if [[ "$*" == *"grep -qE ':5000"* ]]; then
  [[ "${MISSING_ORCHESTRATOR:-0}" != 1 ]]
  exit
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
grep -Fq '.Config.Hostname' "$TMP_DIR/immediate/docker.calls" ||
  fail 'current container hostname was not inspected'

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

if run_probe stale-poller env POSTIZ_READINESS_ATTEMPTS=1 STALE_POLLER=1 \
  > "$TMP_DIR/stale-poller.out" 2>&1; then
  fail 'stale Temporal poller was accepted'
fi
grep -q '123@old-host' "$TMP_DIR/stale-poller.out" ||
  fail 'stale Temporal identity was absent from diagnostics'

if run_probe stopped-postiz env POSTIZ_READINESS_ATTEMPTS=1 STOPPED_POSTIZ=1 \
  > "$TMP_DIR/stopped-postiz.out" 2>&1; then
  fail 'stopped Postiz container was accepted'
fi
grep -q '123@current-host' "$TMP_DIR/stopped-postiz.out" ||
  fail 'Temporal evidence was not collected after an earlier signal failed'

if run_probe frontend-timeout env POSTIZ_READINESS_ATTEMPTS=1 MISSING_FRONTEND=1 \
  > "$TMP_DIR/frontend-timeout.out" 2>&1; then
  fail 'missing frontend was accepted'
fi

if run_probe orchestrator-timeout env POSTIZ_READINESS_ATTEMPTS=1 MISSING_ORCHESTRATOR=1 \
  > "$TMP_DIR/orchestrator-timeout.out" 2>&1; then
  fail 'missing orchestrator was accepted'
fi

if run_probe diagnostic-failure env POSTIZ_READINESS_ATTEMPTS=1 \
  MISSING_BACKEND=1 FAIL_DIAGNOSTICS=1 \
  > "$TMP_DIR/diagnostic-failure.out" 2>&1; then
  fail 'diagnostic failure changed timeout into success'
fi
grep -q 'listening ports' "$TMP_DIR/diagnostic-failure.out" ||
  fail 'remaining diagnostics were suppressed'

started_at=$SECONDS
if run_probe hanging-inspect env POSTIZ_READINESS_ATTEMPTS=10 \
  POSTIZ_READINESS_TIMEOUT_SECONDS=1 \
  POSTIZ_READINESS_COMMAND_TIMEOUT_SECONDS=1 \
  POSTIZ_READINESS_DIAGNOSTIC_TIMEOUT_SECONDS=1 HANG_INSPECT=1 \
  > "$TMP_DIR/hanging-inspect.out" 2>&1; then
  fail 'hanging container inspection was accepted'
fi
elapsed=$((SECONDS - started_at))
((elapsed < 6)) || fail "hanging probe exceeded its wall-clock bound (${elapsed}s)"
grep -q 'readiness timed out' "$TMP_DIR/hanging-inspect.out" ||
  fail 'hanging probe timeout message missing'
grep -q -- '--- container state ---' "$TMP_DIR/hanging-inspect.out" ||
  fail 'container diagnostics missing after a hung probe'
grep -q -- '--- Temporal task queue ---' "$TMP_DIR/hanging-inspect.out" ||
  fail 'Temporal diagnostics missing after a hung probe'
grep -q -- '--- orchestrator logs ---' "$TMP_DIR/hanging-inspect.out" ||
  fail 'later diagnostics were suppressed after a hung probe'

if run_probe invalid-attempts env POSTIZ_READINESS_ATTEMPTS=0 \
  > "$TMP_DIR/invalid-attempts.out" 2>&1; then
  fail 'zero attempts was accepted'
fi
grep -q 'POSTIZ_READINESS_ATTEMPTS must be a positive integer' \
  "$TMP_DIR/invalid-attempts.out" || fail 'invalid attempts message missing'
[[ ! -s "$TMP_DIR/invalid-attempts/docker.calls" ]] ||
  fail 'invalid attempts entered the readiness loop'

if run_probe invalid-interval env POSTIZ_READINESS_INTERVAL_SECONDS=-1 \
  > "$TMP_DIR/invalid-interval.out" 2>&1; then
  fail 'negative interval was accepted'
fi
grep -q 'POSTIZ_READINESS_INTERVAL_SECONDS must be a nonnegative number' \
  "$TMP_DIR/invalid-interval.out" || fail 'invalid interval message missing'
[[ ! -s "$TMP_DIR/invalid-interval/docker.calls" ]] ||
  fail 'invalid interval entered the readiness loop'

echo 'Readiness probe tests passed'
