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

proxy_probe() {
  local label=$1 proxy=$2 url=$3 include_api_key=$4
  local config="$WORK_DIR/proxy-$label.conf"
  KSY_LIVE_CURL_BODY="$WORK_DIR/proxy-$label.body"
  KSY_LIVE_CURL_HEADERS="$WORK_DIR/proxy-$label.headers"
  export KSY_LIVE_CURL_BODY
  cat > "$config" <<CONFIG
silent
show-error
output = "$KSY_LIVE_CURL_BODY"
dump-header = "$KSY_LIVE_CURL_HEADERS"
write-out = "%{http_code}"
proxy = "$proxy"
connect-timeout = 10
max-time = 20
url = "$url"
CONFIG
  if [[ "$include_api_key" == 1 ]]; then
    printf 'header = "X-API-Key: %s"\n' "$PLATPRICES_API_KEY" >> "$config"
  fi
  chmod 600 "$config"
  curl --config "$config"
}

quota_header() {
  local name=$1 path=$2
  awk -F: -v expected="$name" 'tolower($1) == tolower(expected) {
    sub(/^[^:]*:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit
  }' "$path"
}

proxy_response_status() {
  awk '/^HTTP\// { status=$2 } END { print status }' "$1"
}

MODE=''
while (($#)); do
  case "$1" in
    --mode)
      [[ $# -ge 2 && -z "$MODE" ]] || fail ARGUMENTS_INVALID
      MODE=$2
      shift 2
      ;;
    *) fail ARGUMENTS_INVALID ;;
  esac
done
[[ "$MODE" == bootstrap || "$MODE" == routine ]] || fail ACCEPTANCE_MODE_REQUIRED

[[ "$TEST_MODE" == 1 || $EUID -eq 0 ]] || fail ROOT_REQUIRED
[[ -f "$ENV_FILE" && -f "$COMPOSE_FILE" ]] || fail KSY_INSTALLATION_MISSING
[[ "$(file_mode "$ENV_FILE")" == 600 ]] || fail KSY_ENV_MODE_INVALID
if [[ "$TEST_MODE" != 1 ]]; then
  [[ "$(stat -c '%U:%G' "$ENV_FILE")" == root:root ]] || fail KSY_ENV_OWNER_INVALID
fi
used=$(disk_used_percent)
[[ "$used" =~ ^[0-9]+$ && "$used" -lt 85 ]] || fail DISK_USAGE_LIMIT

# shellcheck disable=SC1090
. "$ENV_FILE"
[[ -n "${TELEGRAM_BOT_TOKEN:-}" && "$TELEGRAM_BOT_TOKEN" != *$'\n'* ]] || fail TELEGRAM_BOT_TOKEN_INVALID
[[ "${TELEGRAM_WEBHOOK_SECRET:-}" =~ ^[a-f0-9]{64}$ ]] || fail TELEGRAM_WEBHOOK_SECRET_INVALID
[[ "${TELEGRAM_WEBHOOK_URL:-}" == https://ksy-deals.fedrbodr.com/telegram/webhook ]] || fail TELEGRAM_WEBHOOK_URL_INVALID
[[ "${POSTGRES_DB:-}" == ksy_deals && "${POSTGRES_USER:-}" == ksy_deals ]] || fail POSTGRES_IDENTITY_INVALID
[[ "${KSY_DEALS_IMAGE:-}" =~ ^ghcr\.io/fedrbodr/ksy-deals@sha256:[a-f0-9]{64}$ ]] || fail KSY_DEALS_IMAGE_INVALID
safe_token "$TELEGRAM_BOT_TOKEN" || fail TELEGRAM_BOT_TOKEN_INVALID
safe_token "${PLATPRICES_API_KEY:-}" || fail PLATPRICES_API_KEY_INVALID
[[ "${PLATPRICES_PROXY_URL:-}" =~ ^http://([A-Za-z0-9_-]{8,32}):([A-Za-z0-9_-]{43,86})@185\.158\.249\.84:3128$ ]] ||
  fail PLATPRICES_PROXY_URL_INVALID
PROXY_USERNAME=${BASH_REMATCH[1]}
PROXY_PASSWORD=${BASH_REMATCH[2]}

compose=(docker --host unix:///var/run/docker.sock compose --project-name ksy-deals --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
read_counts() {
  "${compose[@]}" exec -T db psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --no-psqlrc --tuples-only --no-align \
    --command "SELECT (SELECT COUNT(*) FROM game_editions),(SELECT COUNT(*) FROM price_observations)"
}
read_fingerprint_rows() {
  "${compose[@]}" exec -T db psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --no-psqlrc --tuples-only --no-align --command "-- KSY_FINGERPRINT_V1
SELECT table_name || '|' || row_data
FROM (
  SELECT 'game_editions' AS table_name, row_to_json(e)::text AS row_data FROM game_editions e
  UNION ALL
  SELECT 'price_observations' AS table_name, row_to_json(o)::text AS row_data FROM price_observations o
) snapshot
ORDER BY table_name, row_data"
}
read_fingerprint() { read_fingerprint_rows | fingerprint; }
write_state() {
  local candidate="$WORK_DIR/live-acceptance.state"
  printf 'state_version=2\nphase=%s\naccepted_image=%s\naccepted_counts=%s\naccepted_fingerprint=%s\n' \
    "$phase" "$KSY_DEALS_IMAGE" "$accepted_counts" "$accepted_fingerprint" > "$candidate"
  install_private "$candidate" "$STATE_FILE"
}

phase=NEW
state_kind=none
accepted_counts=''
accepted_fingerprint=''
if [[ -e "$STATE_FILE" ]]; then
  [[ -f "$STATE_FILE" && ! -L "$STATE_FILE" && "$(file_mode "$STATE_FILE")" == 600 ]] || fail ACCEPTANCE_STATE_MODE_INVALID
  if [[ "$TEST_MODE" != 1 ]]; then
    [[ "$(stat -c '%U:%G' "$STATE_FILE")" == root:root ]] || fail ACCEPTANCE_STATE_OWNER_INVALID
  fi
  state_version=$(sed -n 's/^state_version=//p' "$STATE_FILE")
  phase=$(sed -n 's/^phase=//p' "$STATE_FILE")
  if [[ -z "$state_version" ]]; then
    legacy_image=$(sed -n 's/^stored_image=//p' "$STATE_FILE")
    legacy_checksum=$(sed -n 's/^stored_checksum=//p' "$STATE_FILE")
    [[ "$legacy_image" =~ ^ghcr\.io/fedrbodr/ksy-deals@sha256:[a-f0-9]{64}$ &&
      "$legacy_checksum" =~ ^[a-f0-9]{64}$ && "$phase" =~ ^(FIRST_PASS|COMPLETE)$ ]] ||
      fail ACCEPTANCE_STATE_INVALID
    state_kind=legacy
  else
    accepted_image=$(sed -n 's/^accepted_image=//p' "$STATE_FILE")
    accepted_counts=$(sed -n 's/^accepted_counts=//p' "$STATE_FILE")
    accepted_fingerprint=$(sed -n 's/^accepted_fingerprint=//p' "$STATE_FILE")
    [[ "$state_version" == 2 && "$phase" =~ ^(FIRST_PASS|COMPLETE)$ &&
      "$accepted_image" =~ ^ghcr\.io/fedrbodr/ksy-deals@sha256:[a-f0-9]{64}$ &&
      "$accepted_counts" =~ ^[0-9]+\|[0-9]+$ && "$accepted_fingerprint" =~ ^[a-f0-9]{64}$ ]] ||
      fail ACCEPTANCE_STATE_INVALID
    state_kind=v2
  fi
fi

pre_counts=$(read_counts) || fail DATABASE_EVIDENCE_FAILED
[[ "$pre_counts" =~ ^[0-9]+\|[0-9]+$ ]] || fail DATABASE_EVIDENCE_FAILED
pre_fingerprint=$(read_fingerprint) || fail DATABASE_EVIDENCE_FAILED
if [[ "$MODE" == routine ]]; then
  [[ "$state_kind" != none && "$phase" == COMPLETE ]] || fail ROUTINE_STATE_REQUIRED
  routine_counts=$pre_counts
  routine_fingerprint=$pre_fingerprint
elif [[ "$phase" == NEW ]]; then
  [[ "$pre_counts" == '0|0' ]] || fail INITIAL_DATABASE_NOT_EMPTY
elif [[ "$state_kind" == v2 && "$phase" == FIRST_PASS ]]; then
  [[ "$pre_counts" == "$accepted_counts" && "$pre_fingerprint" == "$accepted_fingerprint" ]] ||
    fail FIRST_EVIDENCE_CHANGED
else
  fail BOOTSTRAP_STATE_INVALID
fi

curl --fail --silent --show-error http://127.0.0.1:4300/health/live >/dev/null || fail LIVE_FAILED
curl --fail --silent --show-error http://127.0.0.1:4300/health/ready >/dev/null || fail READY_FAILED

[[ "$(telegram_request setWebhook)" == 200 ]] || fail TELEGRAM_SET_WEBHOOK_HTTP_FAILED
[[ "$(tr -d '[:space:]' < "$WORK_DIR/telegram-setWebhook.body")" == *'"ok":true'* &&
  "$(tr -d '[:space:]' < "$WORK_DIR/telegram-setWebhook.body")" == *'"result":true'* ]] || fail TELEGRAM_SET_WEBHOOK_FAILED
[[ "$(telegram_request getWebhookInfo)" == 200 ]] || fail TELEGRAM_GET_WEBHOOK_HTTP_FAILED
webhook_info=$(tr -d '[:space:]' < "$WORK_DIR/telegram-getWebhookInfo.body")
[[ "$webhook_info" == *'"ok":true'* && "$webhook_info" == *"\"url\":\"${TELEGRAM_WEBHOOK_URL}\""* ]] || fail TELEGRAM_WEBHOOK_MISMATCH

invalid_secret="invalid-${TELEGRAM_WEBHOOK_SECRET:0:16}"
[[ "$(webhook_probe "$invalid_secret" invalid)" == 403 ]] || fail INVALID_SECRET_NOT_REJECTED
[[ "$(webhook_probe "$TELEGRAM_WEBHOOK_SECRET" configured)" == 204 ]] || fail CONFIGURED_SECRET_NOT_ACCEPTED

proxy_probe no-auth http://185.158.249.84:3128 https://platprices.com/api/v2/account 0 >/dev/null 2>&1 || true
[[ "$(proxy_response_status "$WORK_DIR/proxy-no-auth.headers")" == 407 ]] ||
  fail PROXY_NO_AUTH_NOT_REJECTED
authenticated_proxy="http://${PROXY_USERNAME}:${PROXY_PASSWORD}@185.158.249.84:3128"
proxy_probe destination "$authenticated_proxy" https://example.com/ 0 >/dev/null 2>&1 || true
[[ "$(proxy_response_status "$WORK_DIR/proxy-destination.headers")" == 403 ]] ||
  fail PROXY_DESTINATION_NOT_REJECTED
[[ "$(proxy_probe provider "$authenticated_proxy" https://platprices.com/api/v2/account 1)" == 200 ]] ||
  fail PLATPRICES_PROXY_HTTP_FAILED
provider_headers="$WORK_DIR/proxy-provider.headers"
quota_limit=$(quota_header X-RateLimit-Limit "$provider_headers")
quota_used=$(quota_header X-RateLimit-Used "$provider_headers")
quota_remaining=$(quota_header X-RateLimit-Remaining "$provider_headers")
quota_reset=$(quota_header X-RateLimit-Reset "$provider_headers")
[[ "$quota_limit" =~ ^[0-9]+$ && "$quota_used" =~ ^[0-9]+$ && "$quota_remaining" =~ ^[0-9]+$ &&
  "$quota_reset" != "" && "$quota_remaining" -gt 0 &&
  $((quota_used + quota_remaining)) -eq "$quota_limit" ]] || fail PLATPRICES_QUOTA_UNHEALTHY
unset authenticated_proxy PROXY_USERNAME PROXY_PASSWORD PLATPRICES_PROXY_URL PLATPRICES_API_KEY

run_provision() {
  "${compose[@]}" run --rm --no-deps server node apps/server/dist/src/provision-approved-watchlist-cli.js
}

if [[ "$MODE" == bootstrap && "$phase" == NEW ]]; then
  first=$(run_provision) || fail FIRST_PROVISION_FAILED
  json_counts_match "$first" 2 0 1 || fail FIRST_PROVISION_COUNTS_UNEXPECTED
  accepted_counts=$(read_counts) || fail FIRST_EVIDENCE_FAILED
  [[ "$accepted_counts" == '2|2' ]] || fail FIRST_EVIDENCE_FAILED
  accepted_fingerprint=$(read_fingerprint) || fail FIRST_EVIDENCE_FAILED
  phase=FIRST_PASS
  write_state
fi

if [[ "$MODE" == bootstrap && "$phase" == FIRST_PASS ]]; then
  before_counts=$(read_counts) || fail FIRST_EVIDENCE_CHANGED
  before_fingerprint=$(read_fingerprint) || fail FIRST_EVIDENCE_CHANGED
  [[ "$before_counts" == "$accepted_counts" && "$before_fingerprint" == "$accepted_fingerprint" ]] ||
    fail FIRST_EVIDENCE_CHANGED
  second=$(run_provision) || fail SECOND_PROVISION_FAILED
  json_counts_match "$second" 0 2 1 || fail SECOND_PROVISION_COUNTS_UNEXPECTED
  after_counts=$(read_counts) || fail FINAL_EVIDENCE_FAILED
  after_fingerprint=$(read_fingerprint) || fail FINAL_EVIDENCE_FAILED
  [[ "$after_counts" == '2|2' ]] || fail FINAL_COUNTS_UNEXPECTED
  [[ "$after_counts" == "$before_counts" && "$after_fingerprint" == "$before_fingerprint" ]] ||
    fail OBSERVATION_IDENTITIES_CHANGED
  accepted_counts=$after_counts
  accepted_fingerprint=$after_fingerprint
  phase=COMPLETE
  write_state
  final_counts=$after_counts
  final_fingerprint=$after_fingerprint
else
  final_counts=$(read_counts) || fail FINAL_EVIDENCE_FAILED
  final_fingerprint=$(read_fingerprint) || fail FINAL_EVIDENCE_FAILED
fi

if [[ "$MODE" == routine ]]; then
  [[ "$final_counts" == "$routine_counts" && "$final_fingerprint" == "$routine_fingerprint" ]] ||
    fail ROUTINE_DATABASE_CHANGED
  accepted_counts=$final_counts
  accepted_fingerprint=$final_fingerprint
  phase=COMPLETE
  write_state
fi

server_id=$("${compose[@]}" ps -q server)
db_id=$("${compose[@]}" ps -q db)
[[ -n "$server_id" && -n "$db_id" ]] || fail CONTAINER_ID_MISSING
server_state=$(docker --host unix:///var/run/docker.sock inspect --format '{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.Health.Status}}|{{.HostConfig.Memory}}' "$server_id")
db_state=$(docker --host unix:///var/run/docker.sock inspect --format '{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.Health.Status}}|{{.HostConfig.Memory}}' "$db_id")
[[ "$server_state" == '0|false|healthy|1073741824' && "$db_state" == '0|false|healthy|536870912' ]] || fail CONTAINER_STATE_UNHEALTHY
server_memory=$(docker --host unix:///var/run/docker.sock stats --no-stream --format '{{.MemUsage}}' "$server_id" | cut -d/ -f1 | xargs)
db_memory=$(docker --host unix:///var/run/docker.sock stats --no-stream --format '{{.MemUsage}}' "$db_id" | cut -d/ -f1 | xargs)

unset TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET
final_editions=${final_counts%%|*}
final_observations=${final_counts##*|}
printf 'KSY_LIVE_ACCEPTED webhook=PASS invalid_secret=403 configured_secret=204\n'
printf 'KSY_PROXY_ACCEPTED noAuth=407 destinationDenied=true provider=200 quotaHealthy=true\n'
if [[ "$MODE" == bootstrap ]]; then
  printf 'KSY_PROVIDER_ACCEPTED mode=bootstrap first=2_confirmed+1_mapping_required second=2_existing+1_mapping_required editions=%s observations=%s fingerprints=STABLE\n' \
    "$final_editions" "$final_observations"
else
  printf 'KSY_PROVIDER_ACCEPTED mode=routine editions=%s observations=%s fingerprints=STABLE provisioning=SKIPPED\n' \
    "$final_editions" "$final_observations"
fi
printf 'KSY_RESOURCE_EVIDENCE server_restart=0 server_oom=false server_health=healthy server_limit=1g db_restart=0 db_oom=false db_health=healthy db_limit=512m server_memory=%s db_memory=%s disk_used_percent=%s\n' \
  "$server_memory" "$db_memory" "$used"
