#!/usr/bin/env bash
# Configure Telegram and accept the live KSY provider/database boundary.
set -euo pipefail
umask 077

KSY_ROOT=${KSY_ROOT:-/opt/ksy-deals}
ENV_FILE="$KSY_ROOT/.env"
COMPOSE_FILE="$KSY_ROOT/docker-compose.yml"
STATE_FILE=${KSY_LIVE_STATE_FILE:-$KSY_ROOT/live-acceptance.state}
TEST_MODE=${KSY_LIVE_TEST_MODE:-0}
WORK_PARENT=${KSY_LIVE_WORK_PARENT:-/tmp}
WORK_DIR=$(mktemp -d "$WORK_PARENT/ksy-live-accept.XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT

fail() { printf 'KSY_LIVE_ACCEPT_FAILED %s\n' "$1" >&2; exit 1; }
file_mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }

disk_used_percent() {
  if [[ "$TEST_MODE" == 1 ]]; then
    [[ "${KSY_LIVE_TEST_DISK_USED_PERCENT:-}" =~ ^[0-9]+$ ]] || fail TEST_DISK_PERCENT_INVALID
    printf '%s\n' "$KSY_LIVE_TEST_DISK_USED_PERCENT"
  else
    df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }'
  fi
}

compact_json() { printf '%s' "$1" | tr -d '[:space:]'; }
json_counts_match() { [[ "$(compact_json "$1")" == "{\"confirmed\":$2,\"existing\":$3,\"mappingRequired\":$4}" ]]; }
safe_token() { [[ "$1" =~ ^[A-Za-z0-9._~:/+=-]+$ ]]; }
install_private() {
  if [[ "$TEST_MODE" == 1 ]]; then cp "$1" "$2"; chmod 600 "$2";
  else install -o root -g root -m 600 "$1" "$2"; fi
}
fingerprint() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
  else LC_ALL=C shasum -a 256 | awk '{print $1}'; fi
}

telegram_request() {
  local method=$1
  local config="$WORK_DIR/telegram-$method.conf"
  KSY_LIVE_CURL_BODY="$WORK_DIR/telegram-$method.body"
  export KSY_LIVE_CURL_BODY
  cat > "$config" <<CONFIG
silent
output = "$KSY_LIVE_CURL_BODY"
write-out = "%{http_code}"
url = "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}"
CONFIG
  if [[ "$method" == setWebhook ]]; then
    cat >> "$config" <<CONFIG
request = "POST"
data-urlencode = "url=${TELEGRAM_WEBHOOK_URL}"
data-urlencode = "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
CONFIG
  fi
  chmod 600 "$config"
  curl --config "$config"
}

webhook_probe() {
  local supplied_secret=$1 label=$2
  local config="$WORK_DIR/webhook-$label.conf"
  KSY_LIVE_CURL_BODY="$WORK_DIR/webhook-$label.body"
  export KSY_LIVE_CURL_BODY
  cat > "$config" <<CONFIG
silent
output = "$KSY_LIVE_CURL_BODY"
write-out = "%{http_code}"
url = "${TELEGRAM_WEBHOOK_URL}"
request = "POST"
header = "Content-Type: application/json"
header = "X-Telegram-Bot-Api-Secret-Token: ${supplied_secret}"
data = "{}"
CONFIG
  chmod 600 "$config"
  curl --config "$config"
}

[[ "$TEST_MODE" == 1 || $EUID -eq 0 ]] || fail ROOT_REQUIRED
[[ -f "$ENV_FILE" && -f "$COMPOSE_FILE" ]] || fail KSY_INSTALLATION_MISSING
[[ "$(file_mode "$ENV_FILE")" == 600 ]] || fail KSY_ENV_MODE_INVALID
if [[ "$TEST_MODE" != 1 ]]; then
  [[ "$(stat -c '%U:%G' "$ENV_FILE")" == root:root ]] || fail KSY_ENV_OWNER_INVALID
fi
used=$(disk_used_percent)
[[ "$used" =~ ^[0-9]+$ && "$used" -lt 85 ]] || fail DISK_USAGE_LIMIT

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
[[ -n "${TELEGRAM_BOT_TOKEN:-}" && "$TELEGRAM_BOT_TOKEN" != *$'\n'* ]] || fail TELEGRAM_BOT_TOKEN_INVALID
[[ "${TELEGRAM_WEBHOOK_SECRET:-}" =~ ^[a-f0-9]{64}$ ]] || fail TELEGRAM_WEBHOOK_SECRET_INVALID
[[ "${TELEGRAM_WEBHOOK_URL:-}" == https://ksy-deals.fedrbodr.com/telegram/webhook ]] || fail TELEGRAM_WEBHOOK_URL_INVALID
[[ "${POSTGRES_DB:-}" == ksy_deals && "${POSTGRES_USER:-}" == ksy_deals ]] || fail POSTGRES_IDENTITY_INVALID
[[ "${KSY_DEALS_IMAGE:-}" =~ ^ghcr\.io/fedrbodr/ksy-deals@sha256:[a-f0-9]{64}$ ]] || fail KSY_DEALS_IMAGE_INVALID
safe_token "$TELEGRAM_BOT_TOKEN" || fail TELEGRAM_BOT_TOKEN_INVALID

curl --fail --silent --show-error http://127.0.0.1:4300/health/live >/dev/null || fail LIVE_FAILED
curl --fail --silent --show-error http://127.0.0.1:4300/health/ready >/dev/null || fail READY_FAILED
compose=(docker compose --project-name ksy-deals --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

[[ "$(telegram_request setWebhook)" == 200 ]] || fail TELEGRAM_SET_WEBHOOK_HTTP_FAILED
[[ "$(tr -d '[:space:]' < "$WORK_DIR/telegram-setWebhook.body")" == *'"ok":true'* &&
  "$(tr -d '[:space:]' < "$WORK_DIR/telegram-setWebhook.body")" == *'"result":true'* ]] || fail TELEGRAM_SET_WEBHOOK_FAILED
[[ "$(telegram_request getWebhookInfo)" == 200 ]] || fail TELEGRAM_GET_WEBHOOK_HTTP_FAILED
webhook_info=$(tr -d '[:space:]' < "$WORK_DIR/telegram-getWebhookInfo.body")
[[ "$webhook_info" == *'"ok":true'* && "$webhook_info" == *"\"url\":\"${TELEGRAM_WEBHOOK_URL}\""* ]] || fail TELEGRAM_WEBHOOK_MISMATCH

invalid_secret="invalid-${TELEGRAM_WEBHOOK_SECRET:0:16}"
[[ "$(webhook_probe "$invalid_secret" invalid)" == 403 ]] || fail INVALID_SECRET_NOT_REJECTED
[[ "$(webhook_probe "$TELEGRAM_WEBHOOK_SECRET" configured)" == 204 ]] || fail CONFIGURED_SECRET_NOT_ACCEPTED

read_ids() {
  "${compose[@]}" exec -T db psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-psqlrc --tuples-only --no-align \
    --command "SELECT o.id FROM price_observations o JOIN game_editions e ON e.id=o.edition_id WHERE o.source_status='CONFIRMED' ORDER BY o.id"
}
read_counts() {
  "${compose[@]}" exec -T db psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-psqlrc --tuples-only --no-align \
    --command "SELECT (SELECT COUNT(*) FROM game_editions),(SELECT COUNT(*) FROM price_observations)"
}
run_provision() {
  "${compose[@]}" run --rm --no-deps server node apps/server/dist/src/provision-approved-watchlist-cli.js
}

phase=NEW
stored_image=''
stored_checksum=''
if [[ -e "$STATE_FILE" ]]; then
  [[ -f "$STATE_FILE" && ! -L "$STATE_FILE" && "$(file_mode "$STATE_FILE")" == 600 ]] || fail ACCEPTANCE_STATE_MODE_INVALID
  if [[ "$TEST_MODE" != 1 ]]; then
    [[ "$(stat -c '%U:%G' "$STATE_FILE")" == root:root ]] || fail ACCEPTANCE_STATE_OWNER_INVALID
  fi
  stored_image=$(sed -n 's/^stored_image=//p' "$STATE_FILE")
  phase=$(sed -n 's/^phase=//p' "$STATE_FILE")
  stored_checksum=$(sed -n 's/^stored_checksum=//p' "$STATE_FILE")
  [[ "$stored_image" == "$KSY_DEALS_IMAGE" && "$phase" =~ ^(FIRST_PASS|COMPLETE)$ && "$stored_checksum" =~ ^[a-f0-9]{64}$ ]] || fail ACCEPTANCE_STATE_INVALID
fi

before=''
if [[ "$phase" == NEW ]]; then
  [[ "$(read_counts)" == '0|0' ]] || fail INITIAL_DATABASE_NOT_EMPTY
  first=$(run_provision) || fail FIRST_PROVISION_FAILED
  json_counts_match "$first" 2 0 1 || fail FIRST_PROVISION_COUNTS_UNEXPECTED
  before=$(read_ids)
  [[ "$(printf '%s\n' "$before" | sed '/^$/d' | wc -l | tr -d ' ')" == 2 ]] || fail FIRST_EVIDENCE_FAILED
  stored_checksum=$(printf '%s' "$before" | fingerprint)
  stored_image=$KSY_DEALS_IMAGE
  phase=FIRST_PASS
  state_candidate="$WORK_DIR/live-acceptance.state"
  printf 'stored_image=%s\nphase=%s\nstored_checksum=%s\n' "$stored_image" "$phase" "$stored_checksum" > "$state_candidate"
  install_private "$state_candidate" "$STATE_FILE"
fi

if [[ "$phase" == FIRST_PASS ]]; then
  before=$(read_ids)
  [[ "$(printf '%s' "$before" | fingerprint)" == "$stored_checksum" ]] || fail FIRST_EVIDENCE_CHANGED
  second=$(run_provision) || fail SECOND_PROVISION_FAILED
  json_counts_match "$second" 0 2 1 || fail SECOND_PROVISION_COUNTS_UNEXPECTED
  after=$(read_ids)
  [[ "$before" == "$after" ]] || fail OBSERVATION_IDENTITIES_CHANGED
  phase=COMPLETE
  state_candidate="$WORK_DIR/live-acceptance.state"
  printf 'stored_image=%s\nphase=%s\nstored_checksum=%s\n' "$stored_image" "$phase" "$stored_checksum" > "$state_candidate"
  install_private "$state_candidate" "$STATE_FILE"
fi

[[ "$(printf '%s' "$(read_ids)" | fingerprint)" == "$stored_checksum" ]] || fail FINAL_IDENTITIES_CHANGED
counts=$("${compose[@]}" exec -T db psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-psqlrc --tuples-only --no-align \
  --command "SELECT (SELECT COUNT(*) FROM game_editions),(SELECT COUNT(*) FROM price_observations)") || fail FINAL_EVIDENCE_FAILED
[[ "$counts" == '2|2' ]] || fail FINAL_COUNTS_UNEXPECTED

server_id=$("${compose[@]}" ps -q server)
db_id=$("${compose[@]}" ps -q db)
[[ -n "$server_id" && -n "$db_id" ]] || fail CONTAINER_ID_MISSING
server_state=$(docker inspect --format '{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.Health.Status}}|{{.HostConfig.Memory}}' "$server_id")
db_state=$(docker inspect --format '{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.Health.Status}}|{{.HostConfig.Memory}}' "$db_id")
[[ "$server_state" == '0|false|healthy|1073741824' && "$db_state" == '0|false|healthy|536870912' ]] || fail CONTAINER_STATE_UNHEALTHY
server_memory=$(docker stats --no-stream --format '{{.MemUsage}}' "$server_id" | cut -d/ -f1 | xargs)
db_memory=$(docker stats --no-stream --format '{{.MemUsage}}' "$db_id" | cut -d/ -f1 | xargs)

unset TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET
printf 'KSY_LIVE_ACCEPTED webhook=PASS invalid_secret=403 configured_secret=204\n'
printf 'KSY_PROVIDER_ACCEPTED first=2_confirmed+1_mapping_required second=2_existing+1_mapping_required editions=2 observations=2 identities=UNCHANGED\n'
printf 'KSY_RESOURCE_EVIDENCE server_restart=0 server_oom=false server_health=healthy server_limit=1g db_restart=0 db_oom=false db_health=healthy db_limit=512m server_memory=%s db_memory=%s disk_used_percent=%s\n' \
  "$server_memory" "$db_memory" "$used"
