#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/23-accept-ksy-live.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

make_case() {
  local case_dir=$1
  mkdir -p "$case_dir/opt/ksy-deals" "$case_dir/bin"
  cat > "$case_dir/opt/ksy-deals/.env" <<'ENV'
TELEGRAM_BOT_TOKEN=123456789:telegram-token-secret
TELEGRAM_WEBHOOK_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
TELEGRAM_WEBHOOK_URL=https://ksy-deals.fedrbodr.com/telegram/webhook
POSTGRES_DB=ksy_deals
POSTGRES_USER=ksy_deals
KSY_DEALS_IMAGE=ghcr.io/fedrbodr/ksy-deals@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
PLATPRICES_API_KEY=platprices-live-api-key
PLATPRICES_PROXY_URL=http://ksy_user_01:abcdefghijklmnopqrstuvwxyzABCDEFGH123456789@185.158.249.84:3128
ENV
  chmod 600 "$case_dir/opt/ksy-deals/.env"
  printf 'services: {}\n' > "$case_dir/opt/ksy-deals/docker-compose.yml"
  cat > "$case_dir/bin/curl" <<'STUB'
#!/usr/bin/env bash
[[ -z "${PLATPRICES_API_KEY:-}" && -z "${PLATPRICES_PROXY_URL:-}" && \
  -z "${TELEGRAM_BOT_TOKEN:-}" && -z "${TELEGRAM_WEBHOOK_SECRET:-}" ]] || exit 93
config=''
while (($#)); do
  [[ "$1" == --config ]] && { config=$2; shift 2; continue; }
  case "$1" in
    http://127.0.0.1:4300/*) exit 0 ;;
  esac
  shift
done
[[ -n "$config" ]] || exit 91
printf '%s\n' "$config" >> "$CURL_CONFIGS"
[[ "$(stat -c '%a' "$config" 2>/dev/null || stat -f '%Lp' "$config")" == 600 ]] || exit 92
if grep -q 'url = "https://platprices.com/api/v2/account"' "$config" &&
  grep -q 'proxy = "http://185.158.249.84:3128"' "$config"; then
  headers=$(sed -n 's/^dump-header = "\(.*\)"$/\1/p' "$config")
  printf 'HTTP/1.0 407 Proxy Authentication Required\r\n\r\n' > "$headers"
  printf 'noAuth\n' >> "$PROXY_CALLS"
  printf '000'
  exit 56
elif grep -q 'url = "https://example.com/"' "$config"; then
  grep -q 'proxy = "http://ksy_user_01:abcdefghijklmnopqrstuvwxyzABCDEFGH123456789@185.158.249.84:3128"' "$config" || exit 94
  headers=$(sed -n 's/^dump-header = "\(.*\)"$/\1/p' "$config")
  printf 'HTTP/1.0 403 Forbidden\r\n\r\n' > "$headers"
  printf 'destinationDenied\n' >> "$PROXY_CALLS"
  printf '000'
  exit 56
elif grep -q 'url = "https://platprices.com/api/v2/account"' "$config"; then
  grep -q 'proxy = "http://ksy_user_01:abcdefghijklmnopqrstuvwxyzABCDEFGH123456789@185.158.249.84:3128"' "$config" || exit 95
  grep -q 'header = "X-API-Key: platprices-live-api-key"' "$config" || exit 96
  headers=$(sed -n 's/^dump-header = "\(.*\)"$/\1/p' "$config")
  [[ -n "$headers" ]] || exit 97
  printf 'X-RateLimit-Limit: 20000\r\nX-RateLimit-Used: 100\r\nX-RateLimit-Remaining: 19900\r\nX-RateLimit-Reset: 2026-09-01T00:00:00.000Z\r\n' > "$headers"
  printf '{"success":true}\n' > "$KSY_LIVE_CURL_BODY"
  printf 'provider\n' >> "$PROXY_CALLS"
  printf '200'
elif grep -q '/setWebhook' "$config"; then
  if [[ "${KSY_TEST_TELEGRAM_BAD:-0}" == 1 ]]; then printf '{"ok":true,"result":false}\n'; else printf '{"ok":true,"result":true}\n'; fi > "$KSY_LIVE_CURL_BODY"
  printf '200'
elif grep -q '/getWebhookInfo' "$config"; then
  printf '{"ok":true,"result":{"url":"https://ksy-deals.fedrbodr.com/telegram/webhook"}}\n' > "$KSY_LIVE_CURL_BODY"
  printf '200'
elif grep -q 'invalid-' "$config"; then
  printf '{}\n' > "$KSY_LIVE_CURL_BODY"
  [[ "${KSY_TEST_BAD_WEBHOOK:-0}" == 1 ]] && printf '200' || printf '403'
else
  printf '{}\n' > "$KSY_LIVE_CURL_BODY"
  [[ "${KSY_TEST_BAD_CONFIGURED:-0}" == 1 ]] && printf '200' || printf '204'
fi
STUB
  cat > "$case_dir/bin/docker" <<'STUB'
#!/usr/bin/env bash
if env | grep -Eq '^(TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|ADMIN_TELEGRAM_IDS|PLATPRICES_API_KEY|PLATPRICES_PROXY_URL|POSTGRES_PASSWORD|DATABASE_URL)='; then
  exit 98
fi
printf '%s\n' "$*" >> "$DOCKER_CALLS"
if [[ "$*" == *'run --rm --no-deps server node apps/server/dist/src/provision-approved-watchlist-cli.js'* ]]; then
  count=$(wc -l < "$PROVISION_CALLS" | tr -d ' ')
  [[ "$count" == 1 && "${KSY_TEST_FAIL_SECOND:-0}" == 1 ]] && exit 77
  if [[ "$count" == 0 ]]; then
    if [[ "${KSY_TEST_BAD_FIRST:-0}" == 1 ]]; then printf '{"confirmed":1,"existing":0,"mappingRequired":2}\n'; else printf '{"confirmed":2,"existing":0,"mappingRequired":1}\n'; fi
  else
    if [[ "${KSY_TEST_BAD_SECOND:-0}" == 1 ]]; then printf '{"confirmed":1,"existing":1,"mappingRequired":1}\n'; else printf '{"confirmed":0,"existing":2,"mappingRequired":1}\n'; fi
  fi
  printf 'x\n' >> "$PROVISION_CALLS"
elif printf '%s' "$*" | grep -Fq 'KSY_FINGERPRINT_V1'; then
  if [[ "${KSY_TEST_CHANGED_IDS:-0}" == 1 && "$(wc -l < "$PROVISION_CALLS" | tr -d ' ')" == 2 ]]; then
    printf 'game_editions|synthetic-row-a\nprice_observations|synthetic-row-changed\n'
  else
    printf 'game_editions|synthetic-row-a\nprice_observations|synthetic-row-b\n'
  fi
elif printf '%s' "$*" | grep -Fq -- '--command SELECT'; then
  if [[ "${KSY_TEST_MATURE:-0}" == 1 ]]; then printf '136|162\n'; elif [[ ! -s "$PROVISION_CALLS" ]]; then printf '0|0\n'; elif [[ "${KSY_TEST_EXTRA_ROWS:-0}" == 1 ]]; then printf '3|2\n'; else printf '2|2\n'; fi
elif [[ "$*" == *'compose '*' ps -q server'* ]]; then
  printf 'server-container\n'
elif [[ "$*" == *'compose '*' ps -q db'* ]]; then
  printf 'db-container\n'
elif [[ "$*" == *'inspect'* ]]; then
  if [[ "${KSY_TEST_BAD_STATE:-0}" == 1 ]]; then printf '1|true|unhealthy|1\n'; else printf '0|false|healthy|%s\n' "$([[ "$*" == *server-container* ]] && printf 1073741824 || printf 536870912)"; fi
elif [[ "$*" == *'stats'* ]]; then
  printf '1048576\n'
fi
STUB
  chmod +x "$case_dir/bin/curl" "$case_dir/bin/docker"
  : > "$case_dir/curl.configs"
  : > "$case_dir/docker.calls"
  : > "$case_dir/provision.calls"
  : > "$case_dir/proxy.calls"
}

run_case() {
  local case_dir=$1 output=$2 mode=${3:-bootstrap}
  PATH="$case_dir/bin:$PATH" KSY_LIVE_TEST_MODE=1 KSY_LIVE_TEST_DISK_USED_PERCENT=72 \
    KSY_ROOT="$case_dir/opt/ksy-deals" KSY_LIVE_WORK_PARENT="$case_dir" \
    CURL_CONFIGS="$case_dir/curl.configs" DOCKER_CALLS="$case_dir/docker.calls" \
    PROVISION_CALLS="$case_dir/provision.calls" PROXY_CALLS="$case_dir/proxy.calls" \
    bash "$SCRIPT" --mode "$mode" > "$output" 2>&1
}

test_accepts_without_leaking_secrets() {
  local case_dir="$TMP_DIR/success" output="$TMP_DIR/success.out"
  make_case "$case_dir"
  run_case "$case_dir" "$output" || { cat "$output" >&2; cat "$case_dir/docker.calls" >&2; fail 'success case failed'; }
  grep -q 'KSY_LIVE_ACCEPTED webhook=PASS invalid_secret=403 configured_secret=204' "$output" || fail 'acceptance summary missing'
  grep -q 'KSY_PROXY_ACCEPTED noAuth=407 destinationDenied=true provider=200 quotaHealthy=true' "$output" || fail 'proxy acceptance summary missing'
  [[ "$(<"$case_dir/proxy.calls")" == $'noAuth\ndestinationDenied\nprovider' ]] || fail 'proxy probes were not ordered'
  grep -q 'mode=bootstrap first=2_confirmed+1_mapping_required second=2_existing+1_mapping_required' "$output" || fail 'provider counts missing'
  grep -q 'editions=2 observations=2 fingerprints=STABLE' "$output" || fail 'fingerprint evidence missing'
  grep -q 'server_restart=0 server_oom=false server_health=healthy server_limit=1g db_restart=0 db_oom=false db_health=healthy db_limit=512m' "$output" || fail 'container evidence missing'
  [[ "$(wc -l < "$case_dir/provision.calls" | tr -d ' ')" == 2 ]] || fail 'watchlist CLI was not invoked twice'
  grep -q 'run --rm --no-deps server node apps/server/dist/src/provision-approved-watchlist-cli.js' "$case_dir/docker.calls" || fail 'image-contained CLI missing'
  for secret in telegram-token-secret aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    platprices-live-api-key ksy_user_01 abcdefghijklmnopqrstuvwxyzABCDEFGH123456789 observation-a observation-b; do
    ! grep -Fq "$secret" "$output" || fail "secret or identity leaked: $secret"
    ! grep -Fq "$secret" "$case_dir/docker.calls" || fail "secret reached argv: $secret"
  done
  sed -i.bak 's/sha256:aaaaaaaa/sha256:bbbbbbbb/' "$case_dir/opt/ksy-deals/.env"
  rm -f "$case_dir/opt/ksy-deals/.env.bak"
  run_case "$case_dir" "$case_dir/rerun.out" routine || fail 'routine acceptance after image change failed'
  [[ "$(wc -l < "$case_dir/provision.calls" | tr -d ' ')" == 2 ]] || fail 'rerun consumed provider requests'
  grep -q 'mode=routine editions=2 observations=2 fingerprints=STABLE provisioning=SKIPPED' "$case_dir/rerun.out" || fail 'routine evidence missing'
  grep -q 'accepted_image=.*sha256:bbbbbbbb' "$case_dir/opt/ksy-deals/live-acceptance.state" || fail 'routine state did not attest new image'
}

test_rejects_public_env() {
  local case_dir="$TMP_DIR/public" output="$TMP_DIR/public.out"
  make_case "$case_dir"
  chmod 644 "$case_dir/opt/ksy-deals/.env"
  if run_case "$case_dir" "$output"; then fail 'public env accepted'; fi
  grep -q 'KSY_LIVE_ACCEPT_FAILED KSY_ENV_MODE_INVALID' "$output" || fail 'wrong public-env failure'
}

test_stops_at_disk_gate() {
  local case_dir="$TMP_DIR/disk" output="$TMP_DIR/disk.out"
  make_case "$case_dir"
  if PATH="$case_dir/bin:$PATH" KSY_LIVE_TEST_MODE=1 KSY_LIVE_TEST_DISK_USED_PERCENT=85 \
    KSY_ROOT="$case_dir/opt/ksy-deals" KSY_LIVE_WORK_PARENT="$case_dir" \
    CURL_CONFIGS="$case_dir/curl.configs" DOCKER_CALLS="$case_dir/docker.calls" \
    PROVISION_CALLS="$case_dir/provision.calls" PROXY_CALLS="$case_dir/proxy.calls" bash "$SCRIPT" --mode bootstrap > "$output" 2>&1; then
    fail 'disk gate accepted 85 percent'
  fi
  grep -q 'KSY_LIVE_ACCEPT_FAILED DISK_USAGE_LIMIT' "$output" || fail 'wrong disk failure'
  [[ ! -s "$case_dir/curl.configs" ]] || fail 'webhook mutated after disk stop'
}

expect_failure() {
  local name=$1 knob=$2 reason=$3
  local case_dir="$TMP_DIR/$name" output="$TMP_DIR/$name.out"
  make_case "$case_dir"
  if env "$knob=1" PATH="$case_dir/bin:$PATH" KSY_LIVE_TEST_MODE=1 KSY_LIVE_TEST_DISK_USED_PERCENT=72 \
    KSY_ROOT="$case_dir/opt/ksy-deals" KSY_LIVE_WORK_PARENT="$case_dir" \
    CURL_CONFIGS="$case_dir/curl.configs" DOCKER_CALLS="$case_dir/docker.calls" \
    PROVISION_CALLS="$case_dir/provision.calls" PROXY_CALLS="$case_dir/proxy.calls" bash "$SCRIPT" --mode bootstrap > "$output" 2>&1; then
    fail "$name unexpectedly passed"
  fi
  grep -q "KSY_LIVE_ACCEPT_FAILED $reason" "$output" || {
    cat "$output" >&2
    fail "$name returned wrong failure"
  }
}

test_resumes_after_first_pass() {
  local case_dir="$TMP_DIR/resume" output="$TMP_DIR/resume.out"
  make_case "$case_dir"
  if KSY_TEST_FAIL_SECOND=1 run_case "$case_dir" "$output"; then fail 'forced second-pass failure passed'; fi
  grep -q 'KSY_LIVE_ACCEPT_FAILED SECOND_PROVISION_FAILED' "$output" || fail 'first-pass checkpoint failure missing'
  grep -q '^phase=FIRST_PASS$' "$case_dir/opt/ksy-deals/live-acceptance.state" || fail 'first-pass checkpoint missing'
  run_case "$case_dir" "$case_dir/resumed.out" || fail 'first-pass resume failed'
  grep -q '^phase=COMPLETE$' "$case_dir/opt/ksy-deals/live-acceptance.state" || fail 'complete checkpoint missing'
  [[ "$(wc -l < "$case_dir/provision.calls" | tr -d ' ')" == 2 ]] || fail 'resume repeated the first pass'
}

test_state_file_is_data_not_code() {
  local case_dir="$TMP_DIR/state-data" output="$TMP_DIR/state-data.out" executed="$TMP_DIR/state-code-executed" checksum
  make_case "$case_dir"
  printf 'x\nx\n' > "$case_dir/provision.calls"
  checksum=$(printf 'observation-a\nobservation-b' | (command -v sha256sum >/dev/null 2>&1 && sha256sum || LC_ALL=C shasum -a 256) | awk '{print $1}')
  cat > "$case_dir/opt/ksy-deals/live-acceptance.state" <<STATE
touch $executed
stored_image=ghcr.io/fedrbodr/ksy-deals@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
phase=COMPLETE
stored_checksum=$checksum
STATE
  chmod 600 "$case_dir/opt/ksy-deals/live-acceptance.state"
  KSY_TEST_MATURE=1 run_case "$case_dir" "$output" routine || fail 'data-only legacy state was rejected'
  [[ ! -e "$executed" ]] || fail 'state content was executed'
  grep -q 'ACCEPTANCE_STATE_OWNER_INVALID' "$SCRIPT" || fail 'production state owner check missing'
}

test_rejects_symlink_state() {
  local case_dir="$TMP_DIR/state-link" output="$TMP_DIR/state-link.out"
  make_case "$case_dir"
  printf 'phase=COMPLETE\n' > "$case_dir/state-target"
  chmod 600 "$case_dir/state-target"
  ln -s "$case_dir/state-target" "$case_dir/opt/ksy-deals/live-acceptance.state"
  if run_case "$case_dir" "$output"; then fail 'symlink state accepted'; fi
  grep -q 'KSY_LIVE_ACCEPT_FAILED ACCEPTANCE_STATE_MODE_INVALID' "$output" || fail 'wrong symlink-state failure'
}

test_routine_requires_completed_state_and_skips_provisioning() {
  local case_dir="$TMP_DIR/routine" output="$TMP_DIR/routine.out" checksum
  make_case "$case_dir"
  printf 'x\nx\n' > "$case_dir/provision.calls"
  if KSY_TEST_MATURE=1 run_case "$case_dir" "$output" routine; then fail 'routine without state passed'; fi
  grep -q 'KSY_LIVE_ACCEPT_FAILED ROUTINE_STATE_REQUIRED' "$output" || fail 'wrong missing routine-state failure'
  checksum=$(printf 'legacy-bootstrap-evidence' | (command -v sha256sum >/dev/null 2>&1 && sha256sum || LC_ALL=C shasum -a 256) | awk '{print $1}')
  cat > "$case_dir/opt/ksy-deals/live-acceptance.state" <<STATE
stored_image=ghcr.io/fedrbodr/ksy-deals@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
phase=COMPLETE
stored_checksum=$checksum
STATE
  chmod 600 "$case_dir/opt/ksy-deals/live-acceptance.state"
  KSY_TEST_MATURE=1 run_case "$case_dir" "$output" routine || fail 'mature routine migration failed'
  grep -q 'mode=routine editions=136 observations=162 fingerprints=STABLE provisioning=SKIPPED' "$output" || fail 'mature routine evidence missing'
  [[ "$(wc -l < "$case_dir/provision.calls" | tr -d ' ')" == 2 ]] || fail 'routine invoked provisioning'
  grep -q '^state_version=2$' "$case_dir/opt/ksy-deals/live-acceptance.state" || fail 'legacy state was not migrated'
}

test_bootstrap_rejects_mature_database() {
  local case_dir="$TMP_DIR/bootstrap-mature" output="$TMP_DIR/bootstrap-mature.out"
  make_case "$case_dir"
  if KSY_TEST_MATURE=1 run_case "$case_dir" "$output" bootstrap; then fail 'bootstrap accepted mature database'; fi
  grep -q 'KSY_LIVE_ACCEPT_FAILED INITIAL_DATABASE_NOT_EMPTY' "$output" || fail 'wrong mature bootstrap failure'
  [[ ! -s "$case_dir/provision.calls" ]] || fail 'mature bootstrap invoked provisioning'
}

test_accepts_without_leaking_secrets
test_rejects_public_env
test_stops_at_disk_gate
expect_failure telegram-api KSY_TEST_TELEGRAM_BAD TELEGRAM_SET_WEBHOOK_FAILED
expect_failure webhook-code KSY_TEST_BAD_WEBHOOK INVALID_SECRET_NOT_REJECTED
expect_failure configured-code KSY_TEST_BAD_CONFIGURED CONFIGURED_SECRET_NOT_ACCEPTED
expect_failure provider-count KSY_TEST_BAD_FIRST FIRST_PROVISION_COUNTS_UNEXPECTED
expect_failure second-count KSY_TEST_BAD_SECOND SECOND_PROVISION_COUNTS_UNEXPECTED
expect_failure changed-ids KSY_TEST_CHANGED_IDS OBSERVATION_IDENTITIES_CHANGED
expect_failure extra-rows KSY_TEST_EXTRA_ROWS FIRST_EVIDENCE_FAILED
expect_failure container-state KSY_TEST_BAD_STATE CONTAINER_STATE_UNHEALTHY
test_resumes_after_first_pass
test_state_file_is_data_not_code
test_rejects_symlink_state
test_routine_requires_completed_state_and_skips_provisioning
test_bootstrap_rejects_mature_database
bash -n "$SCRIPT"
printf 'KSY live acceptance tests passed\n'
