#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/ops-alerts.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

TOKEN='123456:testSecretTokenValueForOpsAlerts0000'

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  [[ "$2" == *"$1"* ]] || fail "$3 (missing '$1' in: $2)"
}

assert_not_contains() {
  [[ "$2" != *"$1"* ]] || fail "$3 (unexpected '$1')"
}

# Stubs: docker answers each psql query from fixtures by its "-- q:<name>"
# marker; curl records its config (stdin) and message, then replies $CURL_REPLY.
setup_case() {
  CASE=$TMP_DIR/$1
  mkdir -p "$CASE/bin" "$CASE/repo" "$CASE/fixtures" "$CASE/state"
  printf 'JWT_SECRET=keep\nTELEGRAM_ASSISTANT_TOKEN=%s\n' "$TOKEN" > "$CASE/repo/.env"
  echo '777001' > "$CASE/fixtures/chat"
  cat > "$CASE/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CASE/docker.calls"
case "$1 $2" in
  'exec postiz')
    [[ "${POSTIZ_UP:-1}" == 1 ]] ;;
  'exec postiz-postgres')
    exit 0 ;;
  'exec -i')
    query=$(cat)
    name=$(sed -nE 's/^-- q:([a-z]+).*/\1/p' <<< "$query" | head -n 1)
    printf '%s\n' "$query" > "$CASE/query.$name"
    cat "$CASE/fixtures/$name" 2>/dev/null || true ;;
  'logs --since')
    cat "$CASE/fixtures/logs" 2>/dev/null || true ;;
esac
STUB
  cat > "$CASE/bin/curl" <<'STUB'
#!/usr/bin/env bash
cat > "$CASE/curl.config"
printf '%s\n' "$*" > "$CASE/curl.args"
for arg in "$@"; do
  [[ "$arg" == text@* ]] && cp "${arg#text@}" "$CASE/message"
done
printf '%s' "${CURL_REPLY:-{\"ok\":true}}"
STUB
  cat > "$CASE/bin/pgrep" <<'STUB'
#!/usr/bin/env bash
[[ "${DEPLOYING:-0}" == 1 ]]
STUB
  chmod +x "$CASE/bin/"*
}

run_alerts() {
  PATH="$CASE/bin:$PATH" CASE="$CASE" REPO_DIR="$CASE/repo" \
    STATE_DIR="$CASE/state" WATCHDOG_LOG="$CASE/watchdog.log" \
    LOG="$CASE/alerts.log" bash "$SCRIPT"
}

message() { cat "$CASE/message" 2>/dev/null || true; }

test_first_run_announces_without_backlog() {
  setup_case first-run
  echo '• vk «old» — someone@example.com' > "$CASE/fixtures/broken"

  run_alerts || fail 'first run failed'

  assert_contains 'Ops-алерты Вездепоста включены' "$(message)" 'first run greets'
  assert_not_contains 'old' "$(message)" 'first run must not replay history'
  [[ -s "$CASE/state/last-run" ]] || fail 'first run stores the window end'
  assert_contains 'chat_id=777001' "$(cat "$CASE/curl.args")" 'sends to the owner chat'
}

test_reports_events_since_last_run() {
  setup_case events
  echo '2026-10-11 10:00:00' > "$CASE/state/last-run"
  echo '• vk-group «Барахолка» — owner@example.com (на плановом обновлении)' > "$CASE/fixtures/broken"
  echo '• vk — owner@example.com: 2 шт. — VK photo upload returned invalid fields' > "$CASE/fixtures/failed"
  echo '• telegram — owner@example.com: 1 шт., должны были выйти с 11.10 09:55 UTC' > "$CASE/fixtures/stuck"
  echo '• new@example.com (GOOGLE)' > "$CASE/fixtures/signups"
  printf '%s\n' \
    'x Refresh failed for vk-group (id-1): VkTransientRefreshError: fetch failed' \
    'x Refresh failed for vk-group (id-1): VkTransientRefreshError: fetch failed' \
    'unrelated line' > "$CASE/fixtures/logs"
  printf '%s\n' \
    '2026-10-11T09:59:00Z ALERT: orchestrator unhealthy — restarting' \
    '2026-10-11T10:02:00Z ALERT: backend unhealthy — restarting' > "$CASE/watchdog.log"

  run_alerts || fail 'run with events failed'
  local text
  text=$(message)

  assert_contains 'Отвалились каналы' "$text" 'broken channels section'
  assert_contains 'Барахолка' "$text" 'broken channel listed'
  assert_contains 'Ошибки публикации' "$text" 'failed posts section'
  assert_contains 'Посты не ушли вовремя' "$text" 'stuck posts section'
  assert_contains 'new@example.com' "$text" 'signup listed'
  assert_contains '×2 Refresh failed for vk-group' "$text" 'refresh failures grouped'
  assert_contains 'backend unhealthy' "$text" 'watchdog restart in window'
  assert_not_contains 'orchestrator unhealthy' "$text" 'watchdog restart before window'
  grep -q 'since=2026-10-11 10:00:00' "$CASE/docker.calls" || fail 'psql gets the window start'
  assert_not_contains "$TOKEN" "$(cat "$CASE/curl.args") $(cat "$CASE/docker.calls")" 'token never in argv'
  assert_contains "$TOKEN/sendMessage" "$(cat "$CASE/curl.config")" 'token goes through curl stdin'
  [[ "$(cat "$CASE/state/last-run")" != '2026-10-11 10:00:00' ]] || fail 'window advances after send'
}

test_quiet_when_nothing_happened() {
  setup_case quiet
  echo '2026-10-11 10:00:00' > "$CASE/state/last-run"

  run_alerts || fail 'quiet run failed'

  [[ ! -e "$CASE/curl.args" ]] || fail 'nothing must be sent'
  [[ "$(cat "$CASE/state/last-run")" != '2026-10-11 10:00:00' ]] || fail 'window advances'
}

test_failed_delivery_keeps_window() {
  setup_case failed-send
  echo '2026-10-11 10:00:00' > "$CASE/state/last-run"
  echo '• new@example.com' > "$CASE/fixtures/signups"

  if CURL_REPLY='{"ok":false,"description":"Forbidden"}' run_alerts; then
    fail 'failed delivery must exit non-zero'
  fi
  [[ "$(cat "$CASE/state/last-run")" == '2026-10-11 10:00:00' ]] ||
    fail 'window must stay for the retry'
  assert_not_contains "$TOKEN" "$(cat "$CASE/alerts.log")" 'token not logged'
}

test_container_down_reported_once_and_recovery() {
  setup_case down
  echo '2026-10-11 10:00:00' > "$CASE/state/last-run"

  POSTIZ_UP=0 run_alerts || fail 'down run failed'
  assert_contains 'Контейнер postiz не запущен' "$(message)" 'down reported'

  rm -f "$CASE/message"
  POSTIZ_UP=0 run_alerts || fail 'second down run failed'
  [[ ! -e "$CASE/message" ]] || fail 'down must be reported only once'

  POSTIZ_UP=1 run_alerts || fail 'recovery run failed'
  assert_contains 'снова работает' "$(message)" 'recovery reported'
}

test_container_down_during_deploy_is_silent() {
  setup_case deploying
  echo '2026-10-11 10:00:00' > "$CASE/state/last-run"

  POSTIZ_UP=0 DEPLOYING=1 run_alerts || fail 'deploy run failed'
  [[ ! -e "$CASE/message" ]] || fail 'deploy downtime must not alert'
}

test_missing_chat_fails_without_sending() {
  setup_case no-chat
  : > "$CASE/fixtures/chat"

  if run_alerts; then
    fail 'missing chat must exit non-zero'
  fi
  [[ ! -e "$CASE/curl.args" ]] || fail 'nothing sent without a chat'
}

test_first_run_announces_without_backlog
test_reports_events_since_last_run
test_quiet_when_nothing_happened
test_failed_delivery_keeps_window
test_container_down_reported_once_and_recovery
test_container_down_during_deploy_is_silent
test_missing_chat_fails_without_sending
echo 'ops-alerts.spec.sh: all tests passed'
