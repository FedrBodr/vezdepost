#!/usr/bin/env bash
set -uo pipefail

POSTIZ_CONTAINER=${POSTIZ_CONTAINER:-postiz}
TEMPORAL_ADMIN_CONTAINER=${TEMPORAL_ADMIN_CONTAINER:-temporal-admin-tools}
TEMPORAL_TASK_QUEUE=${TEMPORAL_TASK_QUEUE:-main}
ORCHESTRATOR_HEALTH_URL=${ORCHESTRATOR_HEALTH_URL:-http://127.0.0.1:3002/health/status}
POSTIZ_READINESS_ATTEMPTS=${POSTIZ_READINESS_ATTEMPTS:-90}
POSTIZ_READINESS_INTERVAL_SECONDS=${POSTIZ_READINESS_INTERVAL_SECONDS:-2}
POSTIZ_READINESS_TIMEOUT_SECONDS=${POSTIZ_READINESS_TIMEOUT_SECONDS:-180}
POSTIZ_READINESS_COMMAND_TIMEOUT_SECONDS=${POSTIZ_READINESS_COMMAND_TIMEOUT_SECONDS:-5}
POSTIZ_READINESS_DIAGNOSTIC_TIMEOUT_SECONDS=${POSTIZ_READINESS_DIAGNOSTIC_TIMEOUT_SECONDS:-5}
LAST_TEMPORAL_OUTPUT='Temporal task queue has not been checked yet.'
LAST_ORCHESTRATOR_HEALTH_OUTPUT='Orchestrator health has not been checked yet.'
CURRENT_POSTIZ_HOSTNAME=''
CURRENT_TEMPORAL_WORKER_IDENTITY=''
GNU_TIMEOUT=''

ORCHESTRATOR_HEALTH_SCRIPT='const url = process.argv[1];
fetch(url).then(async (response) => {
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = undefined; }
  if (!response.ok || body?.status !== "ok" || typeof body?.workerIdentity !== "string") {
    console.error(`orchestrator health ${response.status}: ${text}`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(body.workerIdentity);
}).catch((error) => {
  console.error(`orchestrator health request failed: ${error.message}`);
  process.exitCode = 1;
});'

validate_positive_integer() {
  local name=$1
  local value=$2
  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    echo "${name} must be a positive integer" >&2
    return 1
  fi
}

validate_config() {
  local status=0
  validate_positive_integer POSTIZ_READINESS_ATTEMPTS \
    "$POSTIZ_READINESS_ATTEMPTS" || status=1
  validate_positive_integer POSTIZ_READINESS_TIMEOUT_SECONDS \
    "$POSTIZ_READINESS_TIMEOUT_SECONDS" || status=1
  validate_positive_integer POSTIZ_READINESS_COMMAND_TIMEOUT_SECONDS \
    "$POSTIZ_READINESS_COMMAND_TIMEOUT_SECONDS" || status=1
  validate_positive_integer POSTIZ_READINESS_DIAGNOSTIC_TIMEOUT_SECONDS \
    "$POSTIZ_READINESS_DIAGNOSTIC_TIMEOUT_SECONDS" || status=1
  if [[ ! "$POSTIZ_READINESS_INTERVAL_SECONDS" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    echo 'POSTIZ_READINESS_INTERVAL_SECONDS must be a nonnegative number' >&2
    status=1
  fi
  return "$status"
}

detect_gnu_timeout() {
  local version
  if command -v timeout >/dev/null 2>&1; then
    version=$(timeout --version 2>/dev/null || true)
    if [[ "$version" == *'GNU coreutils'* ]]; then
      GNU_TIMEOUT=timeout
    fi
  fi
}

# macOS has no GNU timeout by default, so tests and operator laptops use the
# Bash fallback. Production Linux uses coreutils timeout with a forced kill.
run_bounded() {
  local limit=$1
  shift

  if [[ -n "$GNU_TIMEOUT" ]]; then
    "$GNU_TIMEOUT" --signal=TERM --kill-after=1 "${limit}s" "$@"
    return $?
  fi

  local monitor_was_set=0
  [[ $- == *m* ]] && monitor_was_set=1
  set -m
  "$@" &
  local command_pid=$!
  ((monitor_was_set == 1)) || set +m
  (
    sleep "$limit"
    kill -TERM -- "-$command_pid" 2>/dev/null || exit 0
    sleep 0.1
    kill -KILL -- "-$command_pid" 2>/dev/null || true
  ) </dev/null >/dev/null 2>&1 &
  local timer_pid=$!
  local status

  wait "$command_pid"
  status=$?
  kill "$timer_pid" 2>/dev/null || true
  wait "$timer_pid" 2>/dev/null || true
  return "$status"
}

probe_command() {
  local remaining=$((READINESS_DEADLINE - SECONDS))
  local limit=$POSTIZ_READINESS_COMMAND_TIMEOUT_SECONDS

  ((remaining > 0)) || return 124
  if ((remaining < limit)); then
    limit=$remaining
  fi
  run_bounded "$limit" "$@"
}

port_up() {
  local port=$1
  probe_command docker exec "$POSTIZ_CONTAINER" sh -c \
    "(ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -qE ':${port}[[:space:]]'" \
    >/dev/null 2>&1
}

container_up() {
  local output
  if ! output=$(probe_command docker inspect -f \
    '{{.State.Running}} {{.Config.Hostname}}' "$POSTIZ_CONTAINER" 2>/dev/null); then
    CURRENT_POSTIZ_HOSTNAME=''
    return 1
  fi

  read -r state CURRENT_POSTIZ_HOSTNAME <<<"$output"
  [[ "$state" == true && -n "$CURRENT_POSTIZ_HOSTNAME" ]]
}

poller_up() {
  local token
  if ! LAST_TEMPORAL_OUTPUT=$(probe_command docker exec \
    "$TEMPORAL_ADMIN_CONTAINER" temporal task-queue describe \
    --task-queue "$TEMPORAL_TASK_QUEUE" \
    --task-queue-type workflow \
    --address temporal:7233 2>&1); then
    return 1
  fi

  [[ -n "$CURRENT_TEMPORAL_WORKER_IDENTITY" ]] || return 1
  for token in $LAST_TEMPORAL_OUTPUT; do
    if [[ "$token" == "$CURRENT_TEMPORAL_WORKER_IDENTITY" ]]; then
      return 0
    fi
  done
  return 1
}

orchestrator_up() {
  local output
  if ! output=$(probe_command docker exec "$POSTIZ_CONTAINER" node -e \
    "$ORCHESTRATOR_HEALTH_SCRIPT" "$ORCHESTRATOR_HEALTH_URL" 2>&1); then
    LAST_ORCHESTRATOR_HEALTH_OUTPUT=$output
    CURRENT_TEMPORAL_WORKER_IDENTITY=''
    return 1
  fi

  LAST_ORCHESTRATOR_HEALTH_OUTPUT=$output
  if [[ "$output" =~ ^[0-9]+@([[:alnum:]_.-]+)$ ]] &&
    [[ "${BASH_REMATCH[1]}" == "$CURRENT_POSTIZ_HOSTNAME" ]]; then
    CURRENT_TEMPORAL_WORKER_IDENTITY=$output
    return 0
  fi
  CURRENT_TEMPORAL_WORKER_IDENTITY=''
  return 1
}

ready() {
  local status=0
  container_up || status=1
  port_up 5000 || status=1
  port_up 4200 || status=1
  port_up 3000 || status=1
  orchestrator_up || status=1
  poller_up || status=1
  return "$status"
}

run_diagnostic() {
  if ! run_bounded "$POSTIZ_READINESS_DIAGNOSTIC_TIMEOUT_SECONDS" "$@"; then
    echo '[diagnostic command failed or timed out]'
  fi
}

collect_temporal_diagnostic() {
  local output
  if output=$(run_bounded "$POSTIZ_READINESS_DIAGNOSTIC_TIMEOUT_SECONDS" \
    docker exec "$TEMPORAL_ADMIN_CONTAINER" temporal task-queue describe \
    --task-queue "$TEMPORAL_TASK_QUEUE" \
    --task-queue-type workflow \
    --address temporal:7233 2>&1); then
    LAST_TEMPORAL_OUTPUT=$output
  else
    LAST_TEMPORAL_OUTPUT="${output}"$'\n[Temporal diagnostic command failed or timed out]'
  fi
}

collect_orchestrator_health_diagnostic() {
  local output
  if output=$(run_bounded "$POSTIZ_READINESS_DIAGNOSTIC_TIMEOUT_SECONDS" \
    docker exec "$POSTIZ_CONTAINER" node -e "$ORCHESTRATOR_HEALTH_SCRIPT" \
    "$ORCHESTRATOR_HEALTH_URL" 2>&1); then
    LAST_ORCHESTRATOR_HEALTH_OUTPUT=$output
  else
    LAST_ORCHESTRATOR_HEALTH_OUTPUT="${output}"$'\n[Orchestrator health diagnostic command failed or timed out]'
  fi
}

diagnose() {
  echo '--- container state ---'
  run_diagnostic docker inspect -f \
    '{{.State.Status}} running={{.State.Running}} restart={{.RestartCount}} hostname={{.Config.Hostname}}' \
    "$POSTIZ_CONTAINER"
  echo '--- PM2 processes ---'
  run_diagnostic docker exec "$POSTIZ_CONTAINER" pm2 list
  echo '--- listening ports ---'
  run_diagnostic docker exec "$POSTIZ_CONTAINER" sh -c \
    '(ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -E ":3000|:3002|:4200|:5000"'
  echo '--- orchestrator health ---'
  collect_orchestrator_health_diagnostic
  printf '%s\n' "$LAST_ORCHESTRATOR_HEALTH_OUTPUT"
  echo '--- Temporal task queue ---'
  collect_temporal_diagnostic
  printf '%s\n' "$LAST_TEMPORAL_OUTPUT"
  for process in backend frontend orchestrator; do
    echo "--- ${process} logs ---"
    run_diagnostic docker exec "$POSTIZ_CONTAINER" pm2 logs "$process" \
      --lines 30 --nostream
  done
}

validate_config || exit 1
detect_gnu_timeout

READINESS_STARTED_AT=$SECONDS
READINESS_DEADLINE=$((READINESS_STARTED_AT + POSTIZ_READINESS_TIMEOUT_SECONDS))
attempts_completed=0
for ((attempt = 1; attempt <= POSTIZ_READINESS_ATTEMPTS; attempt++)); do
  ((SECONDS < READINESS_DEADLINE)) || break
  attempts_completed=$attempt
  if ready; then
    echo "readiness passed on attempt ${attempt}/${POSTIZ_READINESS_ATTEMPTS}"
    exit 0
  fi
  if ((attempt < POSTIZ_READINESS_ATTEMPTS && SECONDS < READINESS_DEADLINE)) &&
    [[ "$POSTIZ_READINESS_INTERVAL_SECONDS" != 0 ]]; then
    remaining=$((READINESS_DEADLINE - SECONDS))
    run_bounded "$remaining" sleep "$POSTIZ_READINESS_INTERVAL_SECONDS" || true
  fi
done

elapsed=$((SECONDS - READINESS_STARTED_AT))
echo "readiness timed out or exhausted attempts after ${elapsed}s (${attempts_completed}/${POSTIZ_READINESS_ATTEMPTS}; deadline ${POSTIZ_READINESS_TIMEOUT_SECONDS}s)" >&2
diagnose >&2
exit 1
