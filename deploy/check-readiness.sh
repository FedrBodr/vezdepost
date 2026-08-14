#!/usr/bin/env bash
set -uo pipefail

POSTIZ_CONTAINER=${POSTIZ_CONTAINER:-postiz}
TEMPORAL_ADMIN_CONTAINER=${TEMPORAL_ADMIN_CONTAINER:-temporal-admin-tools}
TEMPORAL_TASK_QUEUE=${TEMPORAL_TASK_QUEUE:-main}
POSTIZ_READINESS_ATTEMPTS=${POSTIZ_READINESS_ATTEMPTS:-90}
POSTIZ_READINESS_INTERVAL_SECONDS=${POSTIZ_READINESS_INTERVAL_SECONDS:-2}
LAST_TEMPORAL_OUTPUT='Temporal task queue has not been checked yet.'

port_up() {
  local port=$1
  docker exec "$POSTIZ_CONTAINER" sh -c \
    "(ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -qE ':${port}[[:space:]]'" \
    >/dev/null 2>&1
}

poller_up() {
  if ! LAST_TEMPORAL_OUTPUT=$(docker exec "$TEMPORAL_ADMIN_CONTAINER" \
    temporal task-queue describe \
    --task-queue "$TEMPORAL_TASK_QUEUE" \
    --task-queue-type workflow \
    --address temporal:7233 2>&1); then
    return 1
  fi
  grep -qE '[0-9]+@[[:alnum:]_.-]+' <<<"$LAST_TEMPORAL_OUTPUT"
}

ready() {
  [[ "$(docker inspect -f '{{.State.Running}}' "$POSTIZ_CONTAINER" 2>/dev/null)" == true ]] &&
    port_up 5000 &&
    port_up 4200 &&
    port_up 3000 &&
    poller_up
}

diagnose() {
  echo '--- container state ---'
  docker inspect -f '{{.State.Status}} running={{.State.Running}} restart={{.RestartCount}}' \
    "$POSTIZ_CONTAINER" 2>&1 || true
  echo '--- PM2 processes ---'
  docker exec "$POSTIZ_CONTAINER" pm2 list 2>&1 || true
  echo '--- listening ports ---'
  docker exec "$POSTIZ_CONTAINER" sh -c \
    '(ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -E ":3000|:4200|:5000"' \
    2>&1 || true
  echo '--- Temporal task queue ---'
  printf '%s\n' "$LAST_TEMPORAL_OUTPUT"
  for process in backend frontend orchestrator; do
    echo "--- ${process} logs ---"
    docker exec "$POSTIZ_CONTAINER" pm2 logs "$process" --lines 30 --nostream \
      2>&1 || true
  done
}

for ((attempt = 1; attempt <= POSTIZ_READINESS_ATTEMPTS; attempt++)); do
  if ready; then
    echo "readiness passed on attempt ${attempt}/${POSTIZ_READINESS_ATTEMPTS}"
    exit 0
  fi
  if ((attempt < POSTIZ_READINESS_ATTEMPTS)); then
    sleep "$POSTIZ_READINESS_INTERVAL_SECONDS"
  fi
done

echo "readiness timed out after ${POSTIZ_READINESS_ATTEMPTS} attempts" >&2
diagnose >&2
exit 1
