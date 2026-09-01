#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/20-provision-ksy-staging.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
APPROVED_ORDER_URL='https://t.me/ksybuybot'
APPROVED_SITE_BOT_URL='https://t.me/ksy_deals_store_bot'

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_eq() {
  local expected=$1
  local actual=$2
  local message=$3
  [[ "$actual" == "$expected" ]] ||
    fail "$message (expected '$expected', got '$actual')"
}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

make_stubs() {
  local bin_dir=$1
  mkdir -p "$bin_dir"
  cat > "$bin_dir/docker" <<'STUB'
#!/usr/bin/env bash
if [[ -n "${CHILD_ENV_CAPTURE:-}" ]]; then
  env | grep -E '^(KSY_DEALS_IMAGE|KSY_DEALS_BACKUP_DIR|DATABASE_URL|BACKUP_RETENTION_DAYS|FEED_TOKEN|SITE_BASE_URL|SITE_TELEGRAM_BOT_URL|VITE_TELEGRAM_BOT_USERNAME|GHCR_USERNAME|GHCR_READ_TOKEN|TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|ORDER_BOT_TOKEN|ORDER_BOT_WEBHOOK_SECRET|ORDER_BOT_WEBHOOK_URL|ORDER_OPERATOR_CHAT_ID|ORDER_TELEGRAM_URL|ADMIN_TELEGRAM_IDS|PLATPRICES_API_KEY|PLATPRICES_PROXY_URL|POSTGRES_PASSWORD|SESSION_COOKIE_KEY|BACKUP_ENCRYPTION_PASSPHRASE)=' >> "$CHILD_ENV_CAPTURE" || true
fi
printf '%s\n' "$*" >> "$DOCKER_CALLS"
if [[ "$1" == pull && "${DOCKER_PULL_FAIL:-0}" == 1 ]]; then
  exit 1
fi
if [[ "$1 $2" == 'network inspect' ]]; then
  [[ -f "$NETWORK_MARKER" ]]
elif [[ "$1 $2" == 'network create' ]]; then
  : > "$NETWORK_MARKER"
fi
STUB
  cat > "$bin_dir/curl" <<'STUB'
#!/usr/bin/env bash
if [[ -n "${CHILD_ENV_CAPTURE:-}" ]]; then
  env | grep -E '^(KSY_DEALS_IMAGE|KSY_DEALS_BACKUP_DIR|DATABASE_URL|BACKUP_RETENTION_DAYS|FEED_TOKEN|SITE_BASE_URL|SITE_TELEGRAM_BOT_URL|VITE_TELEGRAM_BOT_USERNAME|GHCR_USERNAME|GHCR_READ_TOKEN|TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|ORDER_BOT_TOKEN|ORDER_BOT_WEBHOOK_SECRET|ORDER_BOT_WEBHOOK_URL|ORDER_OPERATOR_CHAT_ID|ORDER_TELEGRAM_URL|ADMIN_TELEGRAM_IDS|PLATPRICES_API_KEY|PLATPRICES_PROXY_URL|POSTGRES_PASSWORD|SESSION_COOKIE_KEY|BACKUP_ENCRYPTION_PASSPHRASE)=' >> "$CHILD_ENV_CAPTURE" || true
fi
printf '%s\n' "$*" >> "$CURL_CALLS"
[[ "${CURL_FAIL:-0}" != 1 ]]
STUB
  cat > "$bin_dir/mktemp" <<'STUB'
#!/usr/bin/env bash
if [[ -n "${CHILD_ENV_CAPTURE:-}" ]]; then
  env | grep -E '^(KSY_DEALS_IMAGE|KSY_DEALS_BACKUP_DIR|DATABASE_URL|BACKUP_RETENTION_DAYS|FEED_TOKEN|SITE_BASE_URL|SITE_TELEGRAM_BOT_URL|VITE_TELEGRAM_BOT_USERNAME|GHCR_USERNAME|GHCR_READ_TOKEN|TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|ORDER_BOT_TOKEN|ORDER_BOT_WEBHOOK_SECRET|ORDER_BOT_WEBHOOK_URL|ORDER_OPERATOR_CHAT_ID|ORDER_TELEGRAM_URL|ADMIN_TELEGRAM_IDS|PLATPRICES_API_KEY|PLATPRICES_PROXY_URL|POSTGRES_PASSWORD|SESSION_COOKIE_KEY|BACKUP_ENCRYPTION_PASSPHRASE)=' >> "$CHILD_ENV_CAPTURE" || true
fi
exec /usr/bin/mktemp "$@"
STUB
  cat > "$bin_dir/node" <<'STUB'
#!/usr/bin/env bash
echo 'host Node must not be required by the provisioner' >&2
exit 97
STUB
  cat > "$bin_dir/cp" <<'STUB'
#!/usr/bin/env bash
if [[ "${CP_FAIL_INSTALL:-none}" == env && $# == 2 && "$1" == */ksy.env && "$2" == */.env ]]; then
  exit 98
fi
if [[ "${CP_FAIL_INSTALL:-none}" == evidence && $# == 2 && "$1" == */deployment-evidence.json && "$2" == */deployment-evidence.json ]]; then
  exit 99
fi
exec /bin/cp "$@"
STUB
  cat > "$bin_dir/stat" <<'STUB'
#!/usr/bin/env bash
target=${!#}
if [[ "${STAT_FORCE_UID_MISMATCH:-0}" == 1 && "$*" == *%u* && "$target" == */.env ]]; then
  current_uid=$(/usr/bin/id -u)
  printf '%s\n' "$((current_uid + 1))"
  exit 0
fi
exec /usr/bin/stat "$@"
STUB
  chmod +x "$bin_dir/docker" "$bin_dir/curl" "$bin_dir/mktemp" "$bin_dir/node" \
    "$bin_dir/cp" "$bin_dir/stat"
}

write_staged_compose() {
  local path=$1
  mkdir -p "$(dirname "$path")"
  cat > "$path" <<'YAML'
services:
  db:
    image: postgres:17.5-alpine
  migrate:
    image: ${KSY_DEALS_IMAGE}
  server:
    image: ${KSY_DEALS_IMAGE}
YAML
}

valid_environment() {
  VALID_IMAGE='ghcr.io/fedrbodr/ksy-deals@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  REUSE_IMAGE='ghcr.io/fedrbodr/ksy-deals@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  GHCR_USERNAME='FedrBodr'
  GHCR_READ_TOKEN='github-read-token-secret'
  VITE_TELEGRAM_BOT_USERNAME='ksy_staging_bot'
  POSTGRES_PASSWORD='1111111111111111111111111111111111111111111111111111111111111111'
  SESSION_COOKIE_KEY='2222222222222222222222222222222222222222222222222222222222222222'
  TELEGRAM_BOT_TOKEN='123456:test_bot-token'
  TELEGRAM_WEBHOOK_SECRET='3333333333333333333333333333333333333333333333333333333333333333'
  ORDER_BOT_TOKEN='654321:order_bot-token'
  ORDER_BOT_WEBHOOK_SECRET='5555555555555555555555555555555555555555555555555555555555555555'
  ORDER_BOT_WEBHOOK_URL='https://ksy-deals.fedrbodr.com/telegram/order-webhook'
  ORDER_OPERATOR_CHAT_ID='-1001234567890'
  ORDER_TELEGRAM_URL="$APPROVED_ORDER_URL"
  ADMIN_TELEGRAM_IDS='101,202'
  PLATPRICES_API_KEY='platprices_test-key'
  PLATPRICES_PROXY_URL='http://ksy_user_01:abcdefghijklmnopqrstuvwxyzABCDEFGH123456789@185.158.249.84:3128'
  BACKUP_ENCRYPTION_PASSPHRASE='4444444444444444444444444444444444444444444444444444444444444444'
}

inherited_application_environment() {
  export GHCR_USERNAME='FedrBodr'
  export GHCR_READ_TOKEN='github-read-token-secret'
  export VITE_TELEGRAM_BOT_USERNAME='ksy_staging_bot'
  export POSTGRES_PASSWORD='1111111111111111111111111111111111111111111111111111111111111111'
  export SESSION_COOKIE_KEY='2222222222222222222222222222222222222222222222222222222222222222'
  export TELEGRAM_BOT_TOKEN='123456:test_bot-token'
  export TELEGRAM_WEBHOOK_SECRET='3333333333333333333333333333333333333333333333333333333333333333'
  export ORDER_BOT_TOKEN='654321:order_bot-token'
  export ORDER_BOT_WEBHOOK_SECRET='5555555555555555555555555555555555555555555555555555555555555555'
  export ORDER_BOT_WEBHOOK_URL='https://ksy-deals.fedrbodr.com/telegram/order-webhook'
  export ORDER_OPERATOR_CHAT_ID='-1001234567890'
  export ORDER_TELEGRAM_URL="$APPROVED_ORDER_URL"
  export ADMIN_TELEGRAM_IDS='101,202'
  export PLATPRICES_API_KEY='platprices_test-key'
  export PLATPRICES_PROXY_URL='http://inherited1:abcdefghijklmnopqrstuvwxyzABCDEFGH123456789@185.158.249.84:3128'
  export BACKUP_ENCRYPTION_PASSPHRASE='4444444444444444444444444444444444444444444444444444444444444444'
}

inherited_runtime_environment() {
  export KSY_DEALS_IMAGE='ghcr.io/fedrbodr/ksy-deals@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  export KSY_DEALS_BACKUP_DIR='/tmp/attacker-controlled-backups'
  export DATABASE_URL='postgresql://attacker:attacker@attacker.invalid:5432/attacker'
  export BACKUP_RETENTION_DAYS='999'
  export FEED_TOKEN='inherited-feed-token-sentinel'
  export SITE_BASE_URL='https://inherited-site.invalid'
}

valid_batch() {
  cat <<'BATCH'
SESSION_COOKIE_KEY = 2222222222222222222222222222222222222222222222222222222222222222
GHCR_USERNAME = FedrBodr
ORDER_TELEGRAM_URL = https://t.me/ksu_fifa
VITE_TELEGRAM_BOT_USERNAME = ksy_staging_bot
GHCR_READ_TOKEN = github-read-token-secret
POSTGRES_PASSWORD = 1111111111111111111111111111111111111111111111111111111111111111
TELEGRAM_BOT_TOKEN = 123456:test_bot-token
TELEGRAM_WEBHOOK_SECRET = 3333333333333333333333333333333333333333333333333333333333333333
ORDER_BOT_TOKEN = 654321:order_bot-token
ORDER_BOT_WEBHOOK_SECRET = 5555555555555555555555555555555555555555555555555555555555555555
ORDER_BOT_WEBHOOK_URL = https://ksy-deals.fedrbodr.com/telegram/order-webhook
ORDER_OPERATOR_CHAT_ID = -1001234567890
ADMIN_TELEGRAM_IDS = 101,202
PLATPRICES_API_KEY = platprices_test-key
PLATPRICES_PROXY_URL = http://ksy_user_01:abcdefghijklmnopqrstuvwxyzABCDEFGH123456789@185.158.249.84:3128
BACKUP_ENCRYPTION_PASSPHRASE = 4444444444444444444444444444444444444444444444444444444444444444
KSY_SECRETS_END
BATCH
}

out_of_order_batch() {
  cat <<'BATCH'
BACKUP_ENCRYPTION_PASSPHRASE    =    4444444444444444444444444444444444444444444444444444444444444444
PLATPRICES_API_KEY=platprices_test-key
PLATPRICES_PROXY_URL=http://ksy_user_01:abcdefghijklmnopqrstuvwxyzABCDEFGH123456789@185.158.249.84:3128
ADMIN_TELEGRAM_IDS = 101,202
TELEGRAM_WEBHOOK_SECRET=3333333333333333333333333333333333333333333333333333333333333333
TELEGRAM_BOT_TOKEN = 123456:test_bot-token
ORDER_OPERATOR_CHAT_ID = -1001234567890
ORDER_BOT_WEBHOOK_URL = https://ksy-deals.fedrbodr.com/telegram/order-webhook
ORDER_BOT_WEBHOOK_SECRET = 5555555555555555555555555555555555555555555555555555555555555555
ORDER_BOT_TOKEN = 654321:order_bot-token
POSTGRES_PASSWORD=1111111111111111111111111111111111111111111111111111111111111111
GHCR_READ_TOKEN = github-read-token-secret
VITE_TELEGRAM_BOT_USERNAME=ksy_staging_bot
ORDER_TELEGRAM_URL    = https://t.me/ksu_fifa
GHCR_USERNAME=FedrBodr
SESSION_COOKIE_KEY = 2222222222222222222222222222222222222222222222222222222222222222
KSY_SECRETS_END
BATCH
}

duplicate_order_batch() {
  valid_batch | awk '{ if ($0 == "KSY_SECRETS_END") print "ORDER_TELEGRAM_URL = https://t.me/ksu_fifa"; print }'
}

duplicate_proxy_batch() {
  valid_batch | awk '{ if ($0 == "KSY_SECRETS_END") print "PLATPRICES_PROXY_URL = http://ksy_user_01:abcdefghijklmnopqrstuvwxyzABCDEFGH123456789@185.158.249.84:3128"; print }'
}

duplicate_order_bot_batch() {
  valid_batch | awk '{ if ($0 == "KSY_SECRETS_END") print "ORDER_BOT_TOKEN = 654321:order_bot-token"; print }'
}

unknown_key_batch() {
  valid_batch | awk '{ if ($0 == "KSY_SECRETS_END") print "EXTRA_KEY = should-not-be-accepted"; print }'
}

malformed_line_batch() {
  valid_batch | awk '{ if ($0 == "KSY_SECRETS_END") print "this line has no assignment separator"; print }'
}

missing_admin_batch() {
  valid_batch | awk '$0 !~ /^ADMIN_TELEGRAM_IDS/'
}

missing_proxy_batch() {
  valid_batch | awk '$0 !~ /^PLATPRICES_PROXY_URL/'
}

legacy_twelve_field_batch() {
  valid_batch | awk '$0 !~ /^ORDER_BOT_TOKEN/ && $0 !~ /^ORDER_BOT_WEBHOOK_SECRET/ && $0 !~ /^ORDER_BOT_WEBHOOK_URL/ && $0 !~ /^ORDER_OPERATOR_CHAT_ID/'
}

missing_order_bot_token_batch() {
  valid_batch | awk '$0 !~ /^ORDER_BOT_TOKEN/'
}

duplicate_bot_tokens_batch() {
  valid_batch | awk '{ if ($0 ~ /^ORDER_BOT_TOKEN/) print "ORDER_BOT_TOKEN = 123456:test_bot-token"; else print }'
}

duplicate_webhook_secrets_batch() {
  valid_batch | awk '{ if ($0 ~ /^ORDER_BOT_WEBHOOK_SECRET/) print "ORDER_BOT_WEBHOOK_SECRET = 3333333333333333333333333333333333333333333333333333333333333333"; else print }'
}

invalid_order_webhook_url_batch() {
  valid_batch | awk '{ if ($0 ~ /^ORDER_BOT_WEBHOOK_URL/) print "ORDER_BOT_WEBHOOK_URL = https://ksy-deals.fedrbodr.com/telegram/webhook"; else print }'
}

empty_order_webhook_secret_batch() {
  valid_batch | awk '{ if ($0 ~ /^ORDER_BOT_WEBHOOK_SECRET/) print "ORDER_BOT_WEBHOOK_SECRET ="; else print }'
}

invalid_order_operator_chat_id_batch() {
  valid_batch | awk '{ if ($0 ~ /^ORDER_OPERATOR_CHAT_ID/) print "ORDER_OPERATOR_CHAT_ID = -9991234567890"; else print }'
}

invalid_proxy_batch() {
  valid_batch | awk '{ if ($0 ~ /^PLATPRICES_PROXY_URL/) print "PLATPRICES_PROXY_URL = http://user:short@185.158.249.84:3128"; else print }'
}

alternate_order_batch() {
  valid_batch | awk '{ if ($0 ~ /^ORDER_TELEGRAM_URL/) print "ORDER_TELEGRAM_URL = https://t.me/yar_neo"; else print }'
}

invite_order_batch() {
  valid_batch | awk '{ if ($0 ~ /^ORDER_TELEGRAM_URL/) print "ORDER_TELEGRAM_URL = https://t.me/+invite_token"; else print }'
}

empty_platprices_batch() {
  valid_batch | awk '{ if ($0 ~ /^PLATPRICES_API_KEY/) print "PLATPRICES_API_KEY =   "; else print }'
}

run_case() {
  local case_dir=$1
  local output=$2
  local curl_fail=${3:-0}
  local batch_fn=${4:-valid_batch}
  local image=${5:-$VALID_IMAGE}
  local bin_dir="$case_dir/bin"
  mkdir -p "$case_dir"
  make_stubs "$bin_dir"
  : > "$case_dir/docker.calls"
  : > "$case_dir/curl.calls"
  if [[ "$image" == __ABSENT__ ]]; then
    "$batch_fn" | PATH="$bin_dir:$PATH" \
      DOCKER_CALLS="$case_dir/docker.calls" \
      CURL_CALLS="$case_dir/curl.calls" \
      CURL_FAIL="$curl_fail" \
      NETWORK_MARKER="$case_dir/network.created" \
      KSY_PROVISION_TEST_MODE=1 \
      KSY_PROVISION_TEST_DISK_USED_PERCENT="${KSY_PROVISION_TEST_DISK_USED_PERCENT:-20}" \
      KSY_ROOT="$case_dir/opt/ksy-deals" \
      KSY_BACKUP_DIR="$case_dir/var/backups/ksy-deals" \
      KSY_COVER_DIR="$case_dir/var/covers/ksy-deals" \
      CADDY_SITES_DIR="$case_dir/etc/caddy/sites" \
      STAGED_COMPOSE="$case_dir/tmp/release/docker-compose.yml" \
      bash "$SCRIPT" > "$output" 2>&1
  else
    "$batch_fn" | PATH="$bin_dir:$PATH" \
      DOCKER_CALLS="$case_dir/docker.calls" \
      CURL_CALLS="$case_dir/curl.calls" \
      CURL_FAIL="$curl_fail" \
      NETWORK_MARKER="$case_dir/network.created" \
      KSY_PROVISION_TEST_MODE=1 \
      KSY_PROVISION_TEST_DISK_USED_PERCENT="${KSY_PROVISION_TEST_DISK_USED_PERCENT:-20}" \
      KSY_ROOT="$case_dir/opt/ksy-deals" \
      KSY_BACKUP_DIR="$case_dir/var/backups/ksy-deals" \
      KSY_COVER_DIR="$case_dir/var/covers/ksy-deals" \
      CADDY_SITES_DIR="$case_dir/etc/caddy/sites" \
      STAGED_COMPOSE="$case_dir/tmp/release/docker-compose.yml" \
      bash "$SCRIPT" --image "$image" > "$output" 2>&1
  fi
}

file_sha256() {
  local path=$1
  if [[ ! -e "$path" && ! -L "$path" ]]; then
    printf 'ABSENT\n'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}'
  else
    shasum -a 256 "$path" | awk '{print $1}'
  fi
}

write_existing_installation() {
  local case_dir=$1
  mkdir -p "$case_dir"
  valid_environment
  write_staged_compose "$case_dir/tmp/release/docker-compose.yml"
  run_case "$case_dir" "$case_dir/bootstrap.output"
  awk '!/^KSY_DEALS_IMAGE=/' "$case_dir/opt/ksy-deals/.env" > \
    "$case_dir/env-without-image.before"
  : > "$case_dir/docker.calls"
  : > "$case_dir/curl.calls"
}

run_reuse_case() {
  local case_dir=$1
  local output=$2
  local curl_fail=${3:-0}
  local docker_pull_fail=${4:-0}
  local image=${5:-$REUSE_IMAGE}
  local cp_fail_install=${6:-none}
  local stat_force_uid_mismatch=${7:-0}
  local order_url_override=${8:-$APPROVED_ORDER_URL}
  local bin_dir="$case_dir/bin"
  local arguments=(--reuse-existing-secrets)
  mkdir -p "$case_dir"
  make_stubs "$bin_dir"
  : > "$case_dir/docker.calls"
  : > "$case_dir/curl.calls"

  if [[ -n "$order_url_override" ]]; then
    arguments+=(--order-telegram-url "$order_url_override")
  fi
  arguments+=(--image "$image")

  PATH="$bin_dir:$PATH" \
    DOCKER_CALLS="$case_dir/docker.calls" \
    DOCKER_PULL_FAIL="$docker_pull_fail" \
    CURL_CALLS="$case_dir/curl.calls" \
    CURL_FAIL="$curl_fail" \
    CP_FAIL_INSTALL="$cp_fail_install" \
    STAT_FORCE_UID_MISMATCH="$stat_force_uid_mismatch" \
    NETWORK_MARKER="$case_dir/network.created" \
    KSY_PROVISION_TEST_MODE=1 \
    KSY_PROVISION_TEST_DISK_USED_PERCENT="${KSY_PROVISION_TEST_DISK_USED_PERCENT:-20}" \
    KSY_ROOT="$case_dir/opt/ksy-deals" \
    KSY_BACKUP_DIR="$case_dir/var/backups/ksy-deals" \
    KSY_COVER_DIR="$case_dir/var/covers/ksy-deals" \
    CADDY_SITES_DIR="$case_dir/etc/caddy/sites" \
    STAGED_COMPOSE="$case_dir/tmp/release/docker-compose.yml" \
    bash "$SCRIPT" "${arguments[@]}" </dev/null > "$output" 2>&1
}

run_reuse_arguments_case() {
  local case_dir=$1
  local output=$2
  shift 2
  local bin_dir="$case_dir/bin"
  mkdir -p "$case_dir"
  make_stubs "$bin_dir"
  : > "$case_dir/docker.calls"
  : > "$case_dir/curl.calls"

  PATH="$bin_dir:$PATH" \
    DOCKER_CALLS="$case_dir/docker.calls" \
    CURL_CALLS="$case_dir/curl.calls" \
    NETWORK_MARKER="$case_dir/network.created" \
    KSY_PROVISION_TEST_MODE=1 \
    KSY_PROVISION_TEST_DISK_USED_PERCENT=20 \
    KSY_ROOT="$case_dir/opt/ksy-deals" \
    KSY_BACKUP_DIR="$case_dir/var/backups/ksy-deals" \
    KSY_COVER_DIR="$case_dir/var/covers/ksy-deals" \
    CADDY_SITES_DIR="$case_dir/etc/caddy/sites" \
    STAGED_COMPOSE="$case_dir/tmp/release/docker-compose.yml" \
    bash "$SCRIPT" "$@" </dev/null > "$output" 2>&1
}

assert_reuse_rejection_unchanged() {
  local case_dir=$1
  local expected=$2
  local docker_pull_fail=${3:-0}
  local cp_fail_install=${4:-none}
  local stat_force_uid_mismatch=${5:-0}
  local output="$case_dir/reuse.output"
  local root="$case_dir/opt/ksy-deals"
  local env_before compose_before
  env_before=$(file_sha256 "$root/.env")
  compose_before=$(file_sha256 "$root/docker-compose.yml")

  if run_reuse_case "$case_dir" "$output" 0 "$docker_pull_fail" "$REUSE_IMAGE" \
    "$cp_fail_install" "$stat_force_uid_mismatch"; then
    fail "$(basename "$case_dir") reuse rejection was accepted"
  fi
  grep -q "^KSY_PROVISION_FAILED $expected$" "$output" ||
    fail "$(basename "$case_dir") did not report $expected"
  assert_eq "$env_before" "$(file_sha256 "$root/.env")" \
    "$(basename "$case_dir") changed the previous env"
  assert_eq "$compose_before" "$(file_sha256 "$root/docker-compose.yml")" \
    "$(basename "$case_dir") changed the previous Compose file"
  assert_synthetic_secrets_absent "$output"
}

assert_value_absent() {
  local value=$1
  local file=$2
  local leak_message=$3
  local grep_status

  if grep -Fq "$value" "$file"; then
    fail "$leak_message"
  else
    grep_status=$?
    [[ "$grep_status" == 1 ]] ||
      fail "$leak_message (grep failed with status $grep_status)"
  fi
}

assert_synthetic_secrets_absent() {
  local output=$1
  for secret in "$GHCR_READ_TOKEN" "$POSTGRES_PASSWORD" "$SESSION_COOKIE_KEY" \
    "$TELEGRAM_BOT_TOKEN" "$TELEGRAM_WEBHOOK_SECRET" \
    "$ORDER_BOT_TOKEN" "$ORDER_BOT_WEBHOOK_SECRET" "$ORDER_BOT_WEBHOOK_URL" \
    "$ORDER_OPERATOR_CHAT_ID" \
    "$PLATPRICES_API_KEY" "$PLATPRICES_PROXY_URL" "$BACKUP_ENCRYPTION_PASSPHRASE"; do
    assert_value_absent "$secret" "$output" 'synthetic secret leaked to output'
  done
}

test_synthetic_leak_assertion_rejects_grep_errors() {
  local directory="$TMP_DIR/leak-assertion-directory"
  valid_environment
  mkdir -p "$directory"
  if ( assert_synthetic_secrets_absent "$directory" ); then
    fail 'leak assertion accepted a grep execution error as absence'
  fi
}

test_value_absence_assertion_distinguishes_grep_statuses() {
  local absent_file="$TMP_DIR/leak-assertion-absent"
  local present_file="$TMP_DIR/leak-assertion-present"
  local directory="$TMP_DIR/leak-assertion-error"
  local assertion_status assertion_output
  : > "$absent_file"
  printf 'sentinel\n' > "$present_file"
  mkdir -p "$directory"

  set +e
  assertion_output=$( ( assert_value_absent sentinel "$absent_file" 'leak detected' ) 2>&1 )
  assertion_status=$?
  set -e
  assert_eq 0 "$assertion_status" 'grep status 1 must count as absence'
  assert_eq '' "$assertion_output" 'absence must not produce a failure message'

  set +e
  assertion_output=$( ( assert_value_absent sentinel "$present_file" 'leak detected' ) 2>&1 )
  assertion_status=$?
  set -e
  assert_eq 1 "$assertion_status" 'grep status 0 must fail as a leak'
  [[ "$assertion_output" == *'FAIL: leak detected'* ]] ||
    fail 'grep status 0 did not report a leak'

  set +e
  assertion_output=$( ( assert_value_absent sentinel "$directory" 'leak detected' ) 2>&1 )
  assertion_status=$?
  set -e
  assert_eq 1 "$assertion_status" 'grep execution errors must fail the test'
  [[ "$assertion_output" == *'grep failed with status 2'* ]] ||
    fail 'grep execution errors did not report their status'
}

assert_progress_contract() {
  local output=$1
  local phases
  phases=$(sed -n 's/^KSY_PROGRESS step=[0-9]\/9 phase=\([^ ]*\).*/\1/p' "$output" |
    awk '!seen[$0]++')
  assert_eq $'preflight\nsecrets\ninstall\npull\ndatabase\nmigrations\nserver\nhealth\nevidence' \
    "$phases" 'progress phases must be complete and ordered'
  grep -q '^KSY_PROGRESS step=8/9 phase=health .*endpoint=live attempt=1/30 result=PASS$' "$output" ||
    fail 'successful live health progress is missing'
  grep -q '^KSY_PROGRESS step=8/9 phase=health .*endpoint=ready attempt=1/30 result=PASS$' "$output" ||
    fail 'successful ready health progress is missing'
}

assert_rejection() {
  local case_name=$1
  local expected=$2
  local batch_fn=$3
  local image=${4:-$VALID_IMAGE}
  local case_dir="$TMP_DIR/$case_name"
  local output="$case_dir/output"
  mkdir -p "$case_dir"
  write_staged_compose "$case_dir/tmp/release/docker-compose.yml"

  if run_case "$case_dir" "$output" 0 "$batch_fn" "$image"; then
    fail "$case_name was accepted"
  fi
  grep -q "KSY_PROVISION_FAILED $expected" "$output" ||
    fail "$case_name did not report $expected"
  [[ ! -e "$case_dir/opt/ksy-deals/.env" ]] ||
    fail "$case_name created .env after rejection"
  [[ ! -s "$case_dir/docker.calls" ]] ||
    fail "$case_name ran Docker after rejection"
  assert_synthetic_secrets_absent "$output"
}

test_rejects_full_disk_before_mutation() {
  local case_dir="$TMP_DIR/full-disk"
  local output="$case_dir/output"
  mkdir -p "$case_dir"
  valid_environment
  write_staged_compose "$case_dir/tmp/release/docker-compose.yml"
  export KSY_PROVISION_TEST_DISK_USED_PERCENT=85

  if run_case "$case_dir" "$output"; then
    fail '85 percent disk utilization was accepted'
  fi
  [[ ! -e "$case_dir/opt/ksy-deals/.env" ]] ||
    fail 'target env was created after disk rejection'
  [[ ! -s "$case_dir/docker.calls" ]] ||
    fail 'Docker ran after disk rejection'
  assert_synthetic_secrets_absent "$output"
  unset KSY_PROVISION_TEST_DISK_USED_PERCENT
}

test_rejects_mutable_image_before_mutation() {
  local case_dir="$TMP_DIR/mutable-image"
  local output="$case_dir/output"
  mkdir -p "$case_dir"
  valid_environment
  VALID_IMAGE='ghcr.io/fedrbodr/ksy-deals:latest'
  write_staged_compose "$case_dir/tmp/release/docker-compose.yml"

  if run_case "$case_dir" "$output"; then
    fail 'mutable image tag was accepted'
  fi
  [[ ! -e "$case_dir/opt/ksy-deals/.env" ]] ||
    fail 'target env was created after image rejection'
  [[ ! -s "$case_dir/docker.calls" ]] ||
    fail 'Docker ran after image rejection'
  assert_synthetic_secrets_absent "$output"
}

test_provisions_idempotently_without_secret_leaks() {
  local case_dir="$TMP_DIR/success"
  local output="$case_dir/output"
  mkdir -p "$case_dir"
  valid_environment
  write_staged_compose "$case_dir/tmp/release/docker-compose.yml"

  run_case "$case_dir" "$output" 0 out_of_order_batch
  run_case "$case_dir" "$case_dir/output-second" 0 out_of_order_batch

  assert_progress_contract "$output"
  assert_progress_contract "$case_dir/output-second"

  assert_eq 600 "$(file_mode "$case_dir/opt/ksy-deals/.env")" \
    'staging env must be owner-readable only'
  assert_eq 600 "$(file_mode "$case_dir/opt/ksy-deals/deployment-evidence.json")" \
    'deployment evidence must be owner-readable only'
  assert_eq 1 "$(grep -c '^KSY_DEALS_IMAGE=' "$case_dir/opt/ksy-deals/.env")" \
    'image digest must have one definition'
  assert_eq 1 "$(grep -c '^DATABASE_URL=' "$case_dir/opt/ksy-deals/.env")" \
    'database URL must have one definition'
  assert_eq 1 "$(grep -c '^PLATPRICES_PROXY_URL=' "$case_dir/opt/ksy-deals/.env")" \
    'PlatPrices proxy URL must have one definition'
  assert_eq 1 "$(grep -c '^SITE_TELEGRAM_BOT_URL=' "$case_dir/opt/ksy-deals/.env")" \
    'site Telegram bot URL must have one definition'
  grep -Fxq "ORDER_TELEGRAM_URL=$APPROVED_ORDER_URL" "$case_dir/opt/ksy-deals/.env" ||
    fail 'approved order Telegram URL was not materialized exactly'
  grep -Fxq "SITE_TELEGRAM_BOT_URL=$APPROVED_SITE_BOT_URL" "$case_dir/opt/ksy-deals/.env" ||
    fail 'approved site Telegram bot URL was not materialized exactly'
  grep -Fxq "PLATPRICES_PROXY_URL=$PLATPRICES_PROXY_URL" "$case_dir/opt/ksy-deals/.env" ||
    fail 'PlatPrices proxy URL was not materialized exactly'
  grep -Fxq "ORDER_BOT_TOKEN=$ORDER_BOT_TOKEN" "$case_dir/opt/ksy-deals/.env" ||
    fail 'order bot token was not materialized exactly'
  grep -Fxq "ORDER_BOT_WEBHOOK_SECRET=$ORDER_BOT_WEBHOOK_SECRET" "$case_dir/opt/ksy-deals/.env" ||
    fail 'order bot webhook secret was not materialized exactly'
  grep -Fxq "ORDER_BOT_WEBHOOK_URL=$ORDER_BOT_WEBHOOK_URL" "$case_dir/opt/ksy-deals/.env" ||
    fail 'order bot webhook URL was not materialized exactly'
  grep -Fxq "ORDER_OPERATOR_CHAT_ID=$ORDER_OPERATOR_CHAT_ID" "$case_dir/opt/ksy-deals/.env" ||
    fail 'order operator chat ID was not materialized exactly'
  grep -Fxq 'ORDER_TELEGRAM_URL=https://t.me/ksybuybot' "$case_dir/opt/ksy-deals/.env" ||
    fail 'order Telegram URL was not fixed in the candidate runtime environment'
  grep -Fxq 'SITE_TELEGRAM_BOT_URL=https://t.me/ksy_deals_store_bot' "$case_dir/opt/ksy-deals/.env" ||
    fail 'site Telegram bot URL was not fixed in the candidate runtime environment'
  grep -Fxq "KSY_DEALS_COVER_HOST_DIR=$case_dir/var/covers/ksy-deals" "$case_dir/opt/ksy-deals/.env" ||
    fail 'cover host directory was not materialized exactly'
  grep -Fxq 'COVER_PUBLIC_BASE_URL=https://ksy-deals.fedrbodr.com/covers/' "$case_dir/opt/ksy-deals/.env" ||
    fail 'cover public base URL was not materialized exactly'
  [[ -d "$case_dir/var/covers/ksy-deals" ]] || fail 'cover host directory was not created'
  assert_eq 755 "$(file_mode "$case_dir/var/covers/ksy-deals")" \
    'cover host directory must be traversable by the non-root server'
  [[ -f "$case_dir/etc/caddy/sites/00-empty.caddy" ]] ||
    fail 'empty Caddy import placeholder was not created'
  [[ -f "$case_dir/network.created" ]] || fail 'caddy-edge was not created'
  grep -q 'compose --project-name ksy-deals .* config --quiet' "$case_dir/docker.calls" ||
    fail 'Compose config was not validated'
  grep -q 'compose --project-name ksy-deals --progress plain ' "$case_dir/docker.calls" ||
    fail 'Compose plain progress was not configured'
  grep -q '^login ghcr.io --username FedrBodr --password-stdin$' "$case_dir/docker.calls" ||
    fail 'private GHCR login did not use password stdin'
  grep -q 'compose --project-name ksy-deals .* up -d db' "$case_dir/docker.calls" ||
    fail 'database was not started'
  grep -q 'compose --project-name ksy-deals .* run --rm migrate' "$case_dir/docker.calls" ||
    fail 'migration was not run'
  grep -q 'compose --project-name ksy-deals .* up -d server' "$case_dir/docker.calls" ||
    fail 'server was not started'
  grep -q 'http://127.0.0.1:4300/health/live' "$case_dir/curl.calls" ||
    fail 'liveness was not checked'
  grep -q 'http://127.0.0.1:4300/health/ready' "$case_dir/curl.calls" ||
    fail 'readiness was not checked'

  for secret in "$GHCR_READ_TOKEN" "$POSTGRES_PASSWORD" "$SESSION_COOKIE_KEY" \
    "$TELEGRAM_BOT_TOKEN" "$TELEGRAM_WEBHOOK_SECRET" \
    "$ORDER_BOT_TOKEN" "$ORDER_BOT_WEBHOOK_SECRET" "$ORDER_BOT_WEBHOOK_URL" \
    "$ORDER_OPERATOR_CHAT_ID" \
    "$PLATPRICES_API_KEY" "$PLATPRICES_PROXY_URL" "$BACKUP_ENCRYPTION_PASSPHRASE"; do
    assert_value_absent "$secret" "$output" 'secret leaked to output'
    assert_value_absent "$secret" "$case_dir/opt/ksy-deals/deployment-evidence.json" \
      'secret leaked to deployment evidence'
  done
  grep -q '"loopbackLive":true' "$case_dir/opt/ksy-deals/deployment-evidence.json" ||
    fail 'safe liveness evidence is missing'
  grep -q '"loopbackReady":true' "$case_dir/opt/ksy-deals/deployment-evidence.json" ||
    fail 'safe readiness evidence is missing'
  grep -q '"rollbackImage":null' "$case_dir/opt/ksy-deals/deployment-evidence.json" ||
    fail 'idempotent rerun replaced the original rollback candidate'
}

test_rejects_batch_safety_failures_before_mutation() {
  valid_environment
  assert_rejection duplicate-key BATCH_DUPLICATE_KEY duplicate_order_batch
  assert_rejection duplicate-proxy BATCH_DUPLICATE_KEY duplicate_proxy_batch
  assert_rejection unknown-key BATCH_UNKNOWN_KEY unknown_key_batch
  assert_rejection malformed-line 'BATCH_MALFORMED_LINE line=17' malformed_line_batch
  assert_rejection missing-key BATCH_MISSING_KEY missing_admin_batch
  assert_rejection empty-value BATCH_EMPTY_VALUE empty_platprices_batch
  assert_rejection invalid-proxy PLATPRICES_PROXY_URL_INVALID invalid_proxy_batch
  assert_rejection alternate-order ORDER_TELEGRAM_URL_INVALID alternate_order_batch
  assert_rejection invite-order ORDER_TELEGRAM_URL_INVALID invite_order_batch
}

test_rejects_invalid_order_runtime_batch_before_mutation() {
  valid_environment
  assert_rejection legacy-twelve-field BATCH_MISSING_KEY legacy_twelve_field_batch
  assert_rejection duplicate-order-bot BATCH_DUPLICATE_KEY duplicate_order_bot_batch
  assert_rejection duplicate-bot-tokens TELEGRAM_BOT_TOKENS_DUPLICATE duplicate_bot_tokens_batch
  assert_rejection duplicate-webhook-secrets TELEGRAM_WEBHOOK_SECRETS_DUPLICATE \
    duplicate_webhook_secrets_batch
  assert_rejection empty-order-webhook-secret BATCH_EMPTY_VALUE empty_order_webhook_secret_batch
  assert_rejection invalid-order-webhook-url ORDER_BOT_WEBHOOK_URL_INVALID \
    invalid_order_webhook_url_batch
  assert_rejection invalid-order-operator-chat-id ORDER_OPERATOR_CHAT_ID_INVALID \
    invalid_order_operator_chat_id_batch
}

test_rejects_missing_batch_key_despite_inherited_environment() {
  valid_environment
  inherited_application_environment
  assert_rejection missing-key-inherited-environment BATCH_MISSING_KEY missing_proxy_batch
  assert_rejection missing-order-bot-key-inherited-environment BATCH_MISSING_KEY \
    missing_order_bot_token_batch
  unset GHCR_USERNAME GHCR_READ_TOKEN VITE_TELEGRAM_BOT_USERNAME POSTGRES_PASSWORD \
    SESSION_COOKIE_KEY TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET ORDER_TELEGRAM_URL \
    ORDER_BOT_TOKEN ORDER_BOT_WEBHOOK_SECRET ORDER_BOT_WEBHOOK_URL ORDER_OPERATOR_CHAT_ID \
    ADMIN_TELEGRAM_IDS PLATPRICES_API_KEY PLATPRICES_PROXY_URL BACKUP_ENCRYPTION_PASSPHRASE
}

test_clears_inherited_application_secrets_before_any_child_process() {
  local case_dir="$TMP_DIR/inherited-environment-sanitized"
  local output="$case_dir/output"
  mkdir -p "$case_dir"
  valid_environment
  inherited_application_environment
  write_staged_compose "$case_dir/tmp/release/docker-compose.yml"
  : > "$case_dir/child.env"

  CHILD_ENV_CAPTURE="$case_dir/child.env" \
    run_case "$case_dir" "$output"

  [[ ! -s "$case_dir/child.env" ]] ||
    fail 'a child process inherited an application secret'
  assert_synthetic_secrets_absent "$output"
  unset GHCR_USERNAME GHCR_READ_TOKEN VITE_TELEGRAM_BOT_USERNAME POSTGRES_PASSWORD \
    SESSION_COOKIE_KEY TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET ORDER_TELEGRAM_URL \
    ORDER_BOT_TOKEN ORDER_BOT_WEBHOOK_SECRET ORDER_BOT_WEBHOOK_URL ORDER_OPERATOR_CHAT_ID \
    ADMIN_TELEGRAM_IDS PLATPRICES_API_KEY PLATPRICES_PROXY_URL BACKUP_ENCRYPTION_PASSPHRASE
}

make_pty_stty_stub() {
  local bin_dir=$1
  local restore_mode=$2
  cat > "$bin_dir/stty" <<'STUB'
#!/usr/bin/env bash
if [[ "$1" == -echo ]]; then
  /bin/stty "$@" || exit $?
  printf '[ECHO_OFF]\n'
  exit 0
fi
if [[ "$1" == echo ]]; then
  count_file="${PTY_STTY_COUNT:?}"
  count=0
  [[ -f "$count_file" ]] && count=$(cat "$count_file")
  count=$((count + 1))
  printf '%s' "$count" > "$count_file"
  if [[ "${PTY_RESTORE_MODE:-normal}" == retry && "$count" == 1 ]]; then
    printf 'echo-failed\n' >> "${PTY_STTY_EVENTS:?}"
    exit 1
  fi
  /bin/stty "$@" || exit $?
  printf 'echo-restored\n' >> "${PTY_STTY_EVENTS:?}"
  exit 0
fi
exec /bin/stty "$@"
STUB
  chmod +x "$bin_dir/stty"
  : > "$bin_dir/stty-events"
  : > "$bin_dir/stty-count"
  export PTY_RESTORE_MODE=$restore_mode
  export PTY_STTY_EVENTS="$bin_dir/stty-events"
  export PTY_STTY_COUNT="$bin_dir/stty-count"
}

make_unprivileged_pty_script() {
  local case_dir=$1
  local pty_script="$case_dir/provisioner-pty.sh"
  sed \
    -e 's/\[\[ "$TEST_MODE" == 1 || $EUID -eq 0 \]\] || fail ROOT_REQUIRED/true/' \
    -e 's/install -o root -g root -m /install -m /' \
    -e 's/chown 1000:1000 "$KSY_COVER_DIR"/true/' \
    "$SCRIPT" > "$pty_script"
  chmod +x "$pty_script"
  printf '%s\n' "$pty_script"
}

run_pty_case() {
  local case_dir=$1
  local output=$2
  local batch_fn=${3:-valid_batch}
  local restore_mode=${4:-normal}
  local pty_script bin_dir
  bin_dir="$case_dir/bin"
  mkdir -p "$case_dir"
  make_stubs "$bin_dir"
  make_pty_stty_stub "$bin_dir" "$restore_mode"
  pty_script=$(make_unprivileged_pty_script "$case_dir")
  : > "$case_dir/docker.calls"
  : > "$case_dir/curl.calls"
  write_staged_compose "$case_dir/tmp/release/docker-compose.yml"

  PTY_SCRIPT="$pty_script" \
    PTY_BATCH="$("$batch_fn")"$'\n' \
    PTY_IMAGE="$VALID_IMAGE" \
    PATH="$bin_dir:$PATH" \
    DOCKER_CALLS="$case_dir/docker.calls" \
    CURL_CALLS="$case_dir/curl.calls" \
    NETWORK_MARKER="$case_dir/network.created" \
    KSY_ROOT="$case_dir/opt/ksy-deals" \
    KSY_BACKUP_DIR="$case_dir/var/backups/ksy-deals" \
    KSY_COVER_DIR="$case_dir/var/covers/ksy-deals" \
    CADDY_SITES_DIR="$case_dir/etc/caddy/sites" \
    STAGED_COMPOSE="$case_dir/tmp/release/docker-compose.yml" \
  expect > "$output" 2>&1 <<'EXPECT' && return 0
log_user 1
set timeout 10
spawn -noecho bash $env(PTY_SCRIPT) --image $env(PTY_IMAGE)
expect {
  -exact "Paste the sixteen KSY secret assignments, then KSY_SECRETS_END:" {}
  timeout { exit 124 }
  eof { exit 125 }
}
send -- $env(PTY_BATCH)
expect {
  eof {}
  timeout { exit 126 }
}
lassign [wait] pid spawnid os_error status
if {$os_error != 0} { exit 127 }
exit $status
EXPECT
  local status=$?
  printf 'PTY harness exited %s; transcript markers follow:\n' "$status" >&2
  rg -n 'ECHO_OFF|Paste the sixteen|KSY_PROVISION_(FAILED|PROVISIONED)|ROOT_REQUIRED|TTY_REQUIRED|Operation not permitted|Permission denied' \
    "$output" >&2 || true
  return "$status"
}

test_pty_prompt_follows_echo_off_and_normal_path_restores_echo() {
  local case_dir="$TMP_DIR/pty-normal"
  local output="$case_dir/output"
  valid_environment
  run_pty_case "$case_dir" "$output"

  local transcript
  transcript=$(<"$output")
  if [[ "$transcript" != *'[ECHO_OFF]'*'Paste the sixteen KSY secret assignments, then KSY_SECRETS_END:'* ]]; then
    rg -n 'ECHO_OFF|Paste the sixteen|KSY_PROVISION_(FAILED|PROVISIONED)' "$output" >&2 || true
    fail 'batch readiness prompt did not follow successful echo disable'
  fi
  grep -qx 'echo-restored' "$case_dir/bin/stty-events" ||
    fail 'normal PTY path did not restore echo'
  assert_synthetic_secrets_absent "$output"
}

test_pty_parse_failure_restores_echo() {
  local case_dir="$TMP_DIR/pty-parse-failure"
  local output="$case_dir/output"
  valid_environment
  if run_pty_case "$case_dir" "$output" malformed_line_batch 2>/dev/null; then
    fail 'malformed PTY batch was accepted'
  fi
  grep -qx 'echo-restored' "$case_dir/bin/stty-events" ||
    fail 'parse failure did not restore echo'
}

test_pty_failed_first_echo_restore_is_retried_by_exit_cleanup() {
  local case_dir="$TMP_DIR/pty-restore-retry"
  local output="$case_dir/output"
  valid_environment
  run_pty_case "$case_dir" "$output" valid_batch retry

  grep -qx 'echo-failed' "$case_dir/bin/stty-events" ||
    fail 'test did not force the first normal echo restoration failure'
  grep -qx 'echo-restored' "$case_dir/bin/stty-events" ||
    fail 'EXIT cleanup did not retry terminal echo restoration'
  assert_eq 2 "$(<"$case_dir/bin/stty-count")" \
    'failed normal echo restoration must be retried once during EXIT cleanup'
}

test_pty_signals_terminate_before_mutation() {
  local signal_name case_dir output pty_script bin_dir status
  for signal_name in INT TERM; do
    case_dir="$TMP_DIR/pty-signal-$signal_name"
    output="$case_dir/output"
    bin_dir="$case_dir/bin"
    mkdir -p "$case_dir"
    valid_environment
    make_stubs "$bin_dir"
    make_pty_stty_stub "$bin_dir" normal
    pty_script=$(make_unprivileged_pty_script "$case_dir")
    : > "$case_dir/docker.calls"
    : > "$case_dir/curl.calls"
    write_staged_compose "$case_dir/tmp/release/docker-compose.yml"

    set +e
    PTY_SCRIPT="$pty_script" \
      PTY_IMAGE="$VALID_IMAGE" \
      PTY_SIGNAL="$signal_name" \
      PATH="$bin_dir:$PATH" \
      DOCKER_CALLS="$case_dir/docker.calls" \
      CURL_CALLS="$case_dir/curl.calls" \
      NETWORK_MARKER="$case_dir/network.created" \
      KSY_ROOT="$case_dir/opt/ksy-deals" \
      KSY_BACKUP_DIR="$case_dir/var/backups/ksy-deals" \
      KSY_COVER_DIR="$case_dir/var/covers/ksy-deals" \
      CADDY_SITES_DIR="$case_dir/etc/caddy/sites" \
      STAGED_COMPOSE="$case_dir/tmp/release/docker-compose.yml" \
      expect > "$output" 2>&1 <<'EXPECT'
log_user 1
set timeout 5
spawn -noecho bash $env(PTY_SCRIPT) --image $env(PTY_IMAGE)
  expect -exact "Paste the sixteen KSY secret assignments, then KSY_SECRETS_END:"
if {$env(PTY_SIGNAL) == "INT"} {
  send -- "\003"
} else {
  exec kill -TERM [exp_pid]
}
expect {
  eof {}
  timeout { exit 124 }
}
lassign [wait] pid spawnid os_error status
if {$os_error != 0} { exit 127 }
exit $status
EXPECT
    status=$?
    set -e
    assert_eq "$([[ "$signal_name" == INT ]] && printf 130 || printf 143)" "$status" \
      "$signal_name must terminate with its signal-appropriate status"
    [[ ! -e "$case_dir/opt/ksy-deals/.env" ]] ||
      fail "$signal_name created .env after interruption"
    [[ ! -s "$case_dir/docker.calls" ]] ||
      fail "$signal_name ran Docker after interruption"
  done
}

test_rejects_missing_image_argument_before_mutation() {
  valid_environment
  assert_rejection image-required IMAGE_ARGUMENT_REQUIRED valid_batch __ABSENT__
}

test_rejects_mutable_image_argument_before_mutation() {
  valid_environment
  assert_rejection mutable-image-argument KSY_DEALS_IMAGE_INVALID valid_batch \
    'ghcr.io/fedrbodr/ksy-deals:latest'
}

test_has_hidden_batch_terminal_safety() {
  local exec_line cleanup_line disable_line read_loop_line cleanup_body
  grep -Fq 'exec 3</dev/tty' "$SCRIPT" ||
    fail 'production path does not open /dev/tty on descriptor 3'
  grep -Fq 'stty -echo' "$SCRIPT" ||
    fail 'production path does not disable terminal echo'
  grep -Fq 'while IFS=' "$SCRIPT" ||
    fail 'production path does not use a batch read loop'
  grep -Fq 'trap cleanup_batch' "$SCRIPT" ||
    fail 'production path does not install batch cleanup'
  cleanup_body=$(awk '/^cleanup_batch\(\)/,/^}/' "$SCRIPT")
  grep -Fq 'exec 3>&-' <<<"$cleanup_body" ||
    fail 'batch cleanup does not close the terminal descriptor'
  grep -Fq 'rm -rf "$WORK_DIR"' <<<"$cleanup_body" ||
    fail 'composed batch cleanup does not remove WORK_DIR'
  exec_line=$(grep -nF 'exec 3</dev/tty' "$SCRIPT" | head -1 | cut -d: -f1)
  cleanup_line=$(grep -nF 'trap cleanup_batch' "$SCRIPT" | head -1 | cut -d: -f1)
  disable_line=$(grep -nF 'stty -echo' "$SCRIPT" | head -1 | cut -d: -f1)
  read_loop_line=$(grep -nF 'while IFS=' "$SCRIPT" | head -1 | cut -d: -f1)
  (( cleanup_line < disable_line )) ||
    fail 'batch cleanup must be installed before echo is disabled'
  (( disable_line < read_loop_line )) ||
    fail 'terminal echo must be disabled before the batch read loop'
  (( exec_line < disable_line )) ||
    fail 'terminal descriptor must be opened before echo is disabled'
}

test_restores_previous_installation_after_failed_readiness() {
  local case_dir="$TMP_DIR/rollback"
  local output="$case_dir/output"
  local root="$case_dir/opt/ksy-deals"
  mkdir -p "$root"
  valid_environment
  write_staged_compose "$case_dir/tmp/release/docker-compose.yml"
  printf '%s\n' \
    'KSY_DEALS_IMAGE=ghcr.io/fedrbodr/ksy-deals@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' \
    'KSY_DEALS_PORT=4300' > "$root/.env"
  printf '%s\n' 'services: {}' > "$root/docker-compose.yml"
  cp "$root/.env" "$case_dir/env.before"
  cp "$root/docker-compose.yml" "$case_dir/compose.before"

  if run_case "$case_dir" "$output" 1; then
    fail 'failed readiness was accepted'
  fi
  cmp -s "$case_dir/env.before" "$root/.env" ||
    fail 'previous env was not restored'
  cmp -s "$case_dir/compose.before" "$root/docker-compose.yml" ||
    fail 'previous Compose file was not restored'
  [[ "$(grep -c 'compose --project-name ksy-deals .* up -d server' "$case_dir/docker.calls")" -ge 2 ]] ||
    fail 'previous server was not restarted after failure'
  grep -q '^KSY_PROGRESS step=8/9 phase=health .*endpoint=live attempt=30/30 result=WAIT$' "$output" ||
    fail 'failed health progress did not reach its visible bound'
  grep -q '^KSY_PROVISION_FAILED READINESS_FAILED$' "$output" ||
    fail 'failed readiness lost its compatible failure record'
  assert_synthetic_secrets_absent "$output"
}

test_reuses_existing_secrets_without_prompting() {
  local case_dir="$TMP_DIR/reuse-success"
  local output="$case_dir/reuse.output"
  local root="$case_dir/opt/ksy-deals"
  local pull_line compose_line
  write_existing_installation "$case_dir"
  awk '!/^SITE_TELEGRAM_BOT_URL=/' "$root/.env" > "$case_dir/legacy.env"
  mv "$case_dir/legacy.env" "$root/.env"
  chmod 600 "$root/.env"
  awk '!/^KSY_DEALS_IMAGE=/ && !/^SITE_TELEGRAM_BOT_URL=/' "$root/.env" > \
    "$case_dir/env-without-public-runtime.before"

  if ! run_reuse_case "$case_dir" "$output"; then
    if grep -q '^KSY_PROVISION_FAILED IMAGE_ARGUMENT_REQUIRED$' "$output"; then
      fail 'routine reuse was rejected by the bootstrap-only argument parser'
    fi
    fail 'routine reuse unexpectedly failed'
  fi

  ! grep -Fq 'Paste the sixteen KSY secret assignments' "$output" ||
    fail 'routine reuse emitted the hidden bootstrap prompt'
  grep -q 'phase=secrets message="Reusing existing secret configuration"' "$output" ||
    fail 'routine reuse did not report its secret phase'
  pull_line=$(grep -nFx "pull $REUSE_IMAGE" "$case_dir/docker.calls" | head -1 | cut -d: -f1)
  compose_line=$(grep -n 'compose --project-name ksy-deals ' "$case_dir/docker.calls" | head -1 | cut -d: -f1)
  [[ -n "$pull_line" && -n "$compose_line" && "$pull_line" -lt "$compose_line" ]] ||
    fail 'routine reuse did not pull the exact digest before Compose accessed installed files'
  ! grep -q '^login ' "$case_dir/docker.calls" ||
    fail 'routine reuse unexpectedly replaced existing Docker authentication'
  awk '!/^KSY_DEALS_IMAGE=/ && !/^SITE_TELEGRAM_BOT_URL=/' "$root/.env" > \
    "$case_dir/env-without-public-runtime.after"
  cmp -s "$case_dir/env-without-public-runtime.before" \
    "$case_dir/env-without-public-runtime.after" ||
    fail 'routine reuse changed a non-public env byte'
  assert_eq 1 "$(grep -c "^KSY_DEALS_IMAGE=$REUSE_IMAGE$" "$root/.env")" \
    'routine reuse did not install exactly one requested image digest'
  grep -Fxq "PLATPRICES_PROXY_URL=$PLATPRICES_PROXY_URL" "$root/.env" ||
    fail 'routine reuse did not preserve the PlatPrices proxy URL'
  grep -Fxq "SITE_TELEGRAM_BOT_URL=$APPROVED_SITE_BOT_URL" "$root/.env" ||
    fail 'routine reuse did not migrate the approved site Telegram bot URL'
  assert_eq 1 "$(grep -c '^SITE_TELEGRAM_BOT_URL=' "$root/.env")" \
    'routine reuse did not install exactly one site Telegram bot URL'
  assert_synthetic_secrets_absent "$output"
}

test_reuse_upgrades_legacy_installation_with_cover_storage() {
  local case_dir="$TMP_DIR/reuse-legacy-cover-upgrade"
  local output="$case_dir/reuse.output"
  local root="$case_dir/opt/ksy-deals"
  write_existing_installation "$case_dir"
  awk '!/^KSY_DEALS_COVER_HOST_DIR=/ && !/^COVER_PUBLIC_BASE_URL=/' "$root/.env" > \
    "$case_dir/legacy.env"
  cp "$case_dir/legacy.env" "$root/.env"
  chmod 600 "$root/.env"

  run_reuse_case "$case_dir" "$output" || fail 'legacy cover configuration was not upgraded'

  assert_eq 1 "$(grep -c '^KSY_DEALS_COVER_HOST_DIR=' "$root/.env")" \
    'cover host directory must have one definition after upgrade'
  assert_eq 1 "$(grep -c '^COVER_PUBLIC_BASE_URL=' "$root/.env")" \
    'cover public base URL must have one definition after upgrade'
  grep -Fxq "KSY_DEALS_COVER_HOST_DIR=$case_dir/var/covers/ksy-deals" "$root/.env" ||
    fail 'legacy upgrade installed the wrong cover host directory'
  grep -Fxq 'COVER_PUBLIC_BASE_URL=https://ksy-deals.fedrbodr.com/covers/' "$root/.env" ||
    fail 'legacy upgrade installed the wrong cover public URL'
  [[ -d "$case_dir/var/covers/ksy-deals" ]] || fail 'legacy upgrade did not create cover storage'
  assert_synthetic_secrets_absent "$output"
}

test_routine_override_changes_only_image_and_order_url() {
  local case_dir="$TMP_DIR/reuse-order-url-success"
  local output="$case_dir/reuse.output"
  local root="$case_dir/opt/ksy-deals"
  write_existing_installation "$case_dir"
  awk '!/^KSY_DEALS_IMAGE=/ && !/^ORDER_TELEGRAM_URL=/ && !/^SITE_TELEGRAM_BOT_URL=/' "$root/.env" > \
    "$case_dir/env-without-public-runtime.before"

  run_reuse_case "$case_dir" "$output" 0 0 "$REUSE_IMAGE" none 0 "$APPROVED_ORDER_URL" ||
    fail 'routine order URL override unexpectedly failed'

  awk '!/^KSY_DEALS_IMAGE=/ && !/^ORDER_TELEGRAM_URL=/ && !/^SITE_TELEGRAM_BOT_URL=/' "$root/.env" > \
    "$case_dir/env-without-public-runtime.after"
  cmp -s "$case_dir/env-without-public-runtime.before" \
    "$case_dir/env-without-public-runtime.after" ||
    fail 'routine order URL override changed an unrelated env byte'
  grep -Fxq "KSY_DEALS_IMAGE=$REUSE_IMAGE" "$root/.env" ||
    fail 'routine order URL override did not install the requested image'
  grep -Fxq "ORDER_TELEGRAM_URL=$APPROVED_ORDER_URL" "$root/.env" ||
    fail 'routine order URL override did not install the approved URL'
  grep -Fxq "SITE_TELEGRAM_BOT_URL=$APPROVED_SITE_BOT_URL" "$root/.env" ||
    fail 'routine order URL override did not install the approved site bot URL'
  ! grep -Fq 'Paste the sixteen KSY secret assignments' "$output" ||
    fail 'routine order URL override emitted the hidden bootstrap prompt'
  ! grep -q '^login ' "$case_dir/docker.calls" ||
    fail 'routine order URL override replaced existing Docker authentication'
  assert_synthetic_secrets_absent "$output"
}

assert_order_override_rejected_before_mutation() {
  local case_name=$1
  shift
  local case_dir="$TMP_DIR/$case_name"
  local output="$case_dir/reuse.output"
  local root="$case_dir/opt/ksy-deals"
  local env_before compose_before
  write_existing_installation "$case_dir"
  env_before=$(file_sha256 "$root/.env")
  compose_before=$(file_sha256 "$root/docker-compose.yml")

  if run_reuse_arguments_case "$case_dir" "$output" "$@"; then
    fail "$case_name accepted an invalid order URL override invocation"
  fi
  grep -q '^KSY_PROVISION_FAILED ORDER_TELEGRAM_URL_ARGUMENT_INVALID$' "$output" ||
    fail "$case_name lost the fail-closed order URL argument error"
  assert_eq "$env_before" "$(file_sha256 "$root/.env")" \
    "$case_name changed the previous env"
  assert_eq "$compose_before" "$(file_sha256 "$root/docker-compose.yml")" \
    "$case_name changed the previous Compose file"
  [[ ! -s "$case_dir/docker.calls" ]] || fail "$case_name invoked Docker"
  assert_synthetic_secrets_absent "$output"
}

test_rejects_invalid_order_url_override_arguments_before_mutation() {
  assert_order_override_rejected_before_mutation reuse-order-omitted \
    --reuse-existing-secrets --image "$REUSE_IMAGE"
  assert_order_override_rejected_before_mutation reuse-order-bootstrap \
    --image "$REUSE_IMAGE" --order-telegram-url "$APPROVED_ORDER_URL"
  assert_order_override_rejected_before_mutation reuse-order-missing-value \
    --reuse-existing-secrets --order-telegram-url
  assert_order_override_rejected_before_mutation reuse-order-duplicate \
    --reuse-existing-secrets --order-telegram-url "$APPROVED_ORDER_URL" \
    --order-telegram-url "$APPROVED_ORDER_URL" --image "$REUSE_IMAGE"
  assert_order_override_rejected_before_mutation reuse-order-malformed \
    --reuse-existing-secrets --order-telegram-url http://ksy_deals_store_bot \
    --image "$REUSE_IMAGE"
  assert_order_override_rejected_before_mutation reuse-order-alternate \
    --reuse-existing-secrets --order-telegram-url https://t.me/yar_neo \
    --image "$REUSE_IMAGE"
}

test_clears_inherited_runtime_values_before_compose() {
  local case_dir="$TMP_DIR/reuse-inherited-runtime-sanitized"
  local output="$case_dir/reuse.output"
  local root="$case_dir/opt/ksy-deals"
  local expected_database_url expected_backup_dir expected_retention
  write_existing_installation "$case_dir"
  expected_database_url=$(grep '^DATABASE_URL=' "$root/.env")
  expected_backup_dir=$(grep '^KSY_DEALS_BACKUP_DIR=' "$root/.env")
  expected_retention=$(grep '^BACKUP_RETENTION_DAYS=' "$root/.env")
  : > "$case_dir/child.env"
  inherited_runtime_environment

  CHILD_ENV_CAPTURE="$case_dir/child.env" \
    run_reuse_case "$case_dir" "$output"

  [[ ! -s "$case_dir/child.env" ]] ||
    fail 'a Compose child inherited a runtime value that can override the verified env file'
  grep -Fxq "KSY_DEALS_IMAGE=$REUSE_IMAGE" "$root/.env" ||
    fail 'inherited image replaced the requested image in the installed env'
  grep -Fxq "$expected_database_url" "$root/.env" ||
    fail 'inherited DATABASE_URL replaced the verified live value'
  grep -Fxq "$expected_backup_dir" "$root/.env" ||
    fail 'inherited backup directory replaced the verified live value'
  grep -Fxq "$expected_retention" "$root/.env" ||
    fail 'inherited backup retention replaced the verified live value'
  unset KSY_DEALS_IMAGE KSY_DEALS_BACKUP_DIR DATABASE_URL BACKUP_RETENTION_DAYS \
    FEED_TOKEN SITE_BASE_URL
}

test_rejects_unsafe_or_incomplete_existing_installations_without_mutation() {
  local case_dir root

  case_dir="$TMP_DIR/reuse-no-installation"
  valid_environment
  write_staged_compose "$case_dir/tmp/release/docker-compose.yml"
  assert_reuse_rejection_unchanged "$case_dir" PREVIOUS_INSTALLATION_REQUIRED
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'missing installation invoked Docker'

  case_dir="$TMP_DIR/reuse-incomplete-pair"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  rm "$root/docker-compose.yml"
  assert_reuse_rejection_unchanged "$case_dir" PREVIOUS_INSTALLATION_INCOMPLETE
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'incomplete installation invoked Docker'

  case_dir="$TMP_DIR/reuse-symlink-env"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  mv "$root/.env" "$case_dir/linked.env"
  ln -s "$case_dir/linked.env" "$root/.env"
  assert_reuse_rejection_unchanged "$case_dir" PREVIOUS_ENV_UNSAFE
  [[ -L "$root/.env" ]] || fail 'symlink env was replaced during rejection'
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'symlink env rejection invoked Docker'

  case_dir="$TMP_DIR/reuse-wrong-env-mode"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  chmod 640 "$root/.env"
  assert_reuse_rejection_unchanged "$case_dir" PREVIOUS_ENV_UNSAFE
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'wrong env mode rejection invoked Docker'

  case_dir="$TMP_DIR/reuse-wrong-env-owner"
  write_existing_installation "$case_dir"
  assert_reuse_rejection_unchanged "$case_dir" PREVIOUS_ENV_UNSAFE 0 none 1
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'wrong env owner rejection invoked Docker'
}

test_rejects_invalid_existing_env_without_mutation() {
  local case_dir root env_contents
  local alternate_image='ghcr.io/fedrbodr/ksy-deals@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

  case_dir="$TMP_DIR/reuse-legacy-twelve-field"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  awk '!/^ORDER_BOT_TOKEN=/ && !/^ORDER_BOT_WEBHOOK_SECRET=/ && !/^ORDER_BOT_WEBHOOK_URL=/ && !/^ORDER_OPERATOR_CHAT_ID=/' \
    "$root/.env" > "$case_dir/invalid.env"
  mv "$case_dir/invalid.env" "$root/.env"
  chmod 600 "$root/.env"
  assert_reuse_rejection_unchanged "$case_dir" EXISTING_ENV_INVALID
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'legacy twelve-field environment invoked Docker'

  case_dir="$TMP_DIR/reuse-missing-proxy"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  awk '!/^PLATPRICES_PROXY_URL=/' "$root/.env" > "$case_dir/invalid.env"
  mv "$case_dir/invalid.env" "$root/.env"
  chmod 600 "$root/.env"
  assert_reuse_rejection_unchanged "$case_dir" EXISTING_ENV_INVALID
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'missing runtime key invoked Docker'

  case_dir="$TMP_DIR/reuse-duplicate-session"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  printf '%s\n' "SESSION_COOKIE_KEY=$SESSION_COOKIE_KEY" >> "$root/.env"
  assert_reuse_rejection_unchanged "$case_dir" EXISTING_ENV_INVALID
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'duplicate runtime key invoked Docker'

  case_dir="$TMP_DIR/reuse-empty-value"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  awk '{ if (/^ORDER_TELEGRAM_URL=/) print "ORDER_TELEGRAM_URL="; else print }' \
    "$root/.env" > "$case_dir/invalid.env"
  mv "$case_dir/invalid.env" "$root/.env"
  chmod 600 "$root/.env"
  assert_reuse_rejection_unchanged "$case_dir" EXISTING_ENV_INVALID
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'empty runtime value invoked Docker'

  case_dir="$TMP_DIR/reuse-export-image-alias"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  printf 'export KSY_DEALS_IMAGE=%s\n' "$alternate_image" >> "$root/.env"
  assert_reuse_rejection_unchanged "$case_dir" EXISTING_ENV_INVALID
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'export image alias invoked Docker'

  case_dir="$TMP_DIR/reuse-spaced-image-alias"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  printf 'KSY_DEALS_IMAGE = %s\n' "$alternate_image" >> "$root/.env"
  assert_reuse_rejection_unchanged "$case_dir" EXISTING_ENV_INVALID
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'spaced image alias invoked Docker'

  case_dir="$TMP_DIR/reuse-colon-image-alias"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  printf 'KSY_DEALS_IMAGE: %s\n' "$alternate_image" >> "$root/.env"
  assert_reuse_rejection_unchanged "$case_dir" EXISTING_ENV_INVALID
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'colon image alias invoked Docker'

  case_dir="$TMP_DIR/reuse-spaced-colon-image-alias"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  printf 'KSY_DEALS_IMAGE : %s\n' "$alternate_image" >> "$root/.env"
  assert_reuse_rejection_unchanged "$case_dir" EXISTING_ENV_INVALID
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'spaced colon image alias invoked Docker'

  case_dir="$TMP_DIR/reuse-nbsp-prefixed-image-alias"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  printf '\302\240KSY_DEALS_IMAGE=%s\n' "$alternate_image" >> "$root/.env"
  LC_ALL=C grep -q $'^\302\240KSY_DEALS_IMAGE=' "$root/.env" ||
    fail 'NBSP-prefixed alias fixture did not preserve its UTF-8 bytes'
  assert_reuse_rejection_unchanged "$case_dir" EXISTING_ENV_INVALID
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'NBSP-prefixed image alias invoked Docker'

  case_dir="$TMP_DIR/reuse-bare-image-alias"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  printf 'KSY_DEALS_IMAGE\n' >> "$root/.env"
  assert_reuse_rejection_unchanged "$case_dir" EXISTING_ENV_INVALID
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'bare image alias invoked Docker'

  case_dir="$TMP_DIR/reuse-whitespace-only-value"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  awk '{ if (/^ORDER_TELEGRAM_URL=/) print "ORDER_TELEGRAM_URL=   "; else print }' \
    "$root/.env" > "$case_dir/invalid.env"
  mv "$case_dir/invalid.env" "$root/.env"
  chmod 600 "$root/.env"
  assert_reuse_rejection_unchanged "$case_dir" EXISTING_ENV_INVALID
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'whitespace-only runtime value invoked Docker'

  case_dir="$TMP_DIR/reuse-cr-only-value"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  while IFS= read -r line; do
    if [[ "$line" == ORDER_TELEGRAM_URL=* ]]; then
      printf 'ORDER_TELEGRAM_URL=\r\n'
    else
      printf '%s\n' "$line"
    fi
  done < "$root/.env" > "$case_dir/invalid.env"
  mv "$case_dir/invalid.env" "$root/.env"
  chmod 600 "$root/.env"
  LC_ALL=C grep -q $'^ORDER_TELEGRAM_URL=\r$' "$root/.env" ||
    fail 'CR-only fixture did not preserve its mixed line ending'
  assert_reuse_rejection_unchanged "$case_dir" EXISTING_ENV_INVALID
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'CR-only runtime value invoked Docker'

  case_dir="$TMP_DIR/reuse-nbsp-only-value"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  while IFS= read -r line; do
    if [[ "$line" == ORDER_TELEGRAM_URL=* ]]; then
      printf 'ORDER_TELEGRAM_URL=\302\240\n'
    else
      printf '%s\n' "$line"
    fi
  done < "$root/.env" > "$case_dir/invalid.env"
  mv "$case_dir/invalid.env" "$root/.env"
  chmod 600 "$root/.env"
  LC_ALL=C grep -q $'^ORDER_TELEGRAM_URL=\302\240$' "$root/.env" ||
    fail 'NBSP-only fixture did not preserve its UTF-8 bytes'
  assert_reuse_rejection_unchanged "$case_dir" EXISTING_ENV_INVALID
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'NBSP-only runtime value invoked Docker'

  case_dir="$TMP_DIR/reuse-quoted-empty-value"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  awk '{ if (/^ORDER_TELEGRAM_URL=/) print "ORDER_TELEGRAM_URL=\"\""; else print }' \
    "$root/.env" > "$case_dir/invalid.env"
  mv "$case_dir/invalid.env" "$root/.env"
  chmod 600 "$root/.env"
  assert_reuse_rejection_unchanged "$case_dir" EXISTING_ENV_INVALID
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'quoted-empty runtime value invoked Docker'

  case_dir="$TMP_DIR/reuse-quoted-empty-comment-value"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  awk '{ if (/^ORDER_TELEGRAM_URL=/) print "ORDER_TELEGRAM_URL=\"\" # comment"; else print }' \
    "$root/.env" > "$case_dir/invalid.env"
  mv "$case_dir/invalid.env" "$root/.env"
  chmod 600 "$root/.env"
  assert_reuse_rejection_unchanged "$case_dir" EXISTING_ENV_INVALID
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'quoted-empty comment value invoked Docker'

  case_dir="$TMP_DIR/reuse-interpolated-empty-value"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  awk '{ if (/^ORDER_TELEGRAM_URL=/) print "ORDER_TELEGRAM_URL=${KSY_UNSET_VALUE}"; else print }' \
    "$root/.env" > "$case_dir/invalid.env"
  mv "$case_dir/invalid.env" "$root/.env"
  chmod 600 "$root/.env"
  assert_reuse_rejection_unchanged "$case_dir" EXISTING_ENV_INVALID
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'interpolated-empty runtime value invoked Docker'

  case_dir="$TMP_DIR/reuse-missing-final-newline"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  env_contents=$(<"$root/.env")
  printf '%s' "$env_contents" > "$root/.env"
  assert_eq 0 "$(tail -c 1 "$root/.env" | wc -l | awk '{print $1}')" \
    'test fixture unexpectedly retained its final newline'
  assert_reuse_rejection_unchanged "$case_dir" EXISTING_ENV_INVALID
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'unsupported env framing invoked Docker'
}

test_rejects_missing_order_runtime_keys_in_existing_env_without_mutation() {
  local runtime_key case_dir root
  for runtime_key in ORDER_BOT_TOKEN ORDER_BOT_WEBHOOK_SECRET ORDER_BOT_WEBHOOK_URL \
    ORDER_OPERATOR_CHAT_ID; do
    case_dir="$TMP_DIR/reuse-missing-$runtime_key"
    write_existing_installation "$case_dir"
    root="$case_dir/opt/ksy-deals"
    awk -v key="$runtime_key" '$0 !~ ("^" key "=")' "$root/.env" > "$case_dir/invalid.env"
    mv "$case_dir/invalid.env" "$root/.env"
    chmod 600 "$root/.env"
    assert_reuse_rejection_unchanged "$case_dir" EXISTING_ENV_INVALID
    [[ ! -s "$case_dir/docker.calls" ]] || fail "missing $runtime_key invoked Docker"
  done
}

test_rejects_noncanonical_existing_order_urls_without_mutation() {
  local case_dir root

  case_dir="$TMP_DIR/reuse-alternate-order-url"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  awk '{ if (/^ORDER_TELEGRAM_URL=/) print "ORDER_TELEGRAM_URL=https://t.me/ksy_orders"; else print }' \
    "$root/.env" > "$case_dir/invalid.env"
  mv "$case_dir/invalid.env" "$root/.env"
  chmod 600 "$root/.env"
  assert_reuse_rejection_unchanged "$case_dir" EXISTING_ENV_INVALID
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'alternate order URL invoked Docker'

  case_dir="$TMP_DIR/reuse-alternate-site-bot-url"
  write_existing_installation "$case_dir"
  root="$case_dir/opt/ksy-deals"
  awk '{ if (/^SITE_TELEGRAM_BOT_URL=/) print "SITE_TELEGRAM_BOT_URL=https://t.me/ksybuybot"; else print }' \
    "$root/.env" > "$case_dir/invalid.env"
  mv "$case_dir/invalid.env" "$root/.env"
  chmod 600 "$root/.env"
  assert_reuse_rejection_unchanged "$case_dir" EXISTING_ENV_INVALID
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'alternate site bot URL invoked Docker'
}

test_rejects_failed_existing_docker_auth_without_mutation() {
  local case_dir="$TMP_DIR/reuse-pull-failure"
  write_existing_installation "$case_dir"

  assert_reuse_rejection_unchanged "$case_dir" EXISTING_DOCKER_AUTH_REQUIRED 1
  assert_eq "pull $REUSE_IMAGE" "$(<"$case_dir/docker.calls")" \
    'failed existing Docker auth must stop after the exact image pull'
}

test_reuse_restores_previous_installation_after_failed_readiness() {
  local case_dir="$TMP_DIR/reuse-rollback"
  local output="$case_dir/reuse.output"
  local root="$case_dir/opt/ksy-deals"
  local previous_image
  write_existing_installation "$case_dir"
  cp "$root/.env" "$case_dir/env.before"
  cp "$root/docker-compose.yml" "$case_dir/compose.before"
  previous_image=$(sed -n 's/^KSY_DEALS_IMAGE=//p' "$root/.env")

  if run_reuse_case "$case_dir" "$output" 1 0 "$REUSE_IMAGE" none 0 \
    "$APPROVED_ORDER_URL"; then
    fail 'routine reuse accepted failed readiness'
  fi
  cmp -s "$case_dir/env.before" "$root/.env" ||
    fail 'routine reuse did not restore the previous env'
  cmp -s "$case_dir/compose.before" "$root/docker-compose.yml" ||
    fail 'routine reuse did not restore the previous Compose file'
  grep -Fxq "KSY_DEALS_IMAGE=$previous_image" "$root/.env" ||
    fail 'routine reuse did not restore the previous image digest'
  [[ "$(grep -c 'compose --project-name ksy-deals .* up -d server' "$case_dir/docker.calls")" -ge 2 ]] ||
    fail 'routine reuse did not restart the previous server after rollback'
  grep -q '^KSY_PROVISION_FAILED READINESS_FAILED$' "$output" ||
    fail 'routine reuse health failure lost its compatible failure record'
  assert_synthetic_secrets_absent "$output"
}

assert_routine_transaction_failure_restores_previous_installation() {
  local case_name=$1
  local failure_point=$2
  local minimum_server_starts=$3
  local case_dir="$TMP_DIR/$case_name"
  local output="$case_dir/reuse.output"
  local root="$case_dir/opt/ksy-deals"
  local previous_image
  write_existing_installation "$case_dir"
  cp "$root/.env" "$case_dir/env.before"
  cp "$root/docker-compose.yml" "$case_dir/compose.before"
  previous_image=$(sed -n 's/^KSY_DEALS_IMAGE=//p' "$root/.env")

  if run_reuse_case "$case_dir" "$output" 0 0 "$REUSE_IMAGE" "$failure_point"; then
    fail "$case_name accepted an injected installation failure"
  fi
  cmp -s "$case_dir/env.before" "$root/.env" ||
    fail "$case_name did not exactly restore the previous env"
  cmp -s "$case_dir/compose.before" "$root/docker-compose.yml" ||
    fail "$case_name did not exactly restore the previous Compose file"
  grep -Fxq "KSY_DEALS_IMAGE=$previous_image" "$root/.env" ||
    fail "$case_name did not restore the previous image digest"
  [[ "$(grep -c 'compose --project-name ksy-deals .* up -d server' "$case_dir/docker.calls")" -ge "$minimum_server_starts" ]] ||
    fail "$case_name did not restart the previous server"
  assert_synthetic_secrets_absent "$output"
}

test_reuse_rolls_back_failure_between_compose_and_env_install() {
  assert_routine_transaction_failure_restores_previous_installation \
    reuse-env-install-failure env 1
}

test_reuse_rolls_back_evidence_install_failure() {
  assert_routine_transaction_failure_restores_previous_installation \
    reuse-evidence-install-failure evidence 2
}

test_bootstrap_contract_names_sixteen_hidden_fields() {
  valid_environment
  assert_eq 16 "$(valid_batch | awk -F= '/^[A-Z0-9_]+[[:space:]]*=/ { count++ } END { print count }')" \
    'bootstrap fixture must provide sixteen hidden assignments'
  grep -Fq 'Paste the sixteen KSY secret assignments, then KSY_SECRETS_END:' "$SCRIPT" ||
    fail 'bootstrap prompt no longer names the sixteen-field hidden batch'
}

test_rejects_full_disk_before_mutation
test_synthetic_leak_assertion_rejects_grep_errors
test_value_absence_assertion_distinguishes_grep_statuses
test_rejects_mutable_image_before_mutation
test_provisions_idempotently_without_secret_leaks
test_restores_previous_installation_after_failed_readiness
test_reuses_existing_secrets_without_prompting
test_reuse_upgrades_legacy_installation_with_cover_storage
test_routine_override_changes_only_image_and_order_url
test_rejects_invalid_order_url_override_arguments_before_mutation
test_clears_inherited_runtime_values_before_compose
test_rejects_unsafe_or_incomplete_existing_installations_without_mutation
test_rejects_invalid_existing_env_without_mutation
test_rejects_missing_order_runtime_keys_in_existing_env_without_mutation
test_rejects_noncanonical_existing_order_urls_without_mutation
test_rejects_failed_existing_docker_auth_without_mutation
test_reuse_restores_previous_installation_after_failed_readiness
test_reuse_rolls_back_failure_between_compose_and_env_install
test_reuse_rolls_back_evidence_install_failure
test_bootstrap_contract_names_sixteen_hidden_fields
test_rejects_batch_safety_failures_before_mutation
test_rejects_invalid_order_runtime_batch_before_mutation
test_rejects_missing_batch_key_despite_inherited_environment
test_clears_inherited_application_secrets_before_any_child_process
test_rejects_missing_image_argument_before_mutation
test_rejects_mutable_image_argument_before_mutation
test_has_hidden_batch_terminal_safety
test_pty_prompt_follows_echo_off_and_normal_path_restores_echo
test_pty_parse_failure_restores_echo
test_pty_failed_first_echo_restore_is_retried_by_exit_cleanup
test_pty_signals_terminate_before_mutation
echo 'KSY staging provisioner tests passed'
