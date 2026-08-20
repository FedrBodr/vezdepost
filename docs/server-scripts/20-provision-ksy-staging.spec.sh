#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/20-provision-ksy-staging.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

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
  env | grep -E '^(VITE_TELEGRAM_BOT_USERNAME|GHCR_USERNAME|GHCR_READ_TOKEN|TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|ORDER_TELEGRAM_URL|ADMIN_TELEGRAM_IDS|PLATPRICES_API_KEY|PLATPRICES_PROXY_URL|POSTGRES_PASSWORD|SESSION_COOKIE_KEY|BACKUP_ENCRYPTION_PASSPHRASE)=' >> "$CHILD_ENV_CAPTURE" || true
fi
printf '%s\n' "$*" >> "$DOCKER_CALLS"
if [[ "$1 $2" == 'network inspect' ]]; then
  [[ -f "$NETWORK_MARKER" ]]
elif [[ "$1 $2" == 'network create' ]]; then
  : > "$NETWORK_MARKER"
fi
STUB
  cat > "$bin_dir/curl" <<'STUB'
#!/usr/bin/env bash
if [[ -n "${CHILD_ENV_CAPTURE:-}" ]]; then
  env | grep -E '^(VITE_TELEGRAM_BOT_USERNAME|GHCR_USERNAME|GHCR_READ_TOKEN|TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|ORDER_TELEGRAM_URL|ADMIN_TELEGRAM_IDS|PLATPRICES_API_KEY|PLATPRICES_PROXY_URL|POSTGRES_PASSWORD|SESSION_COOKIE_KEY|BACKUP_ENCRYPTION_PASSPHRASE)=' >> "$CHILD_ENV_CAPTURE" || true
fi
printf '%s\n' "$*" >> "$CURL_CALLS"
[[ "${CURL_FAIL:-0}" != 1 ]]
STUB
  cat > "$bin_dir/mktemp" <<'STUB'
#!/usr/bin/env bash
if [[ -n "${CHILD_ENV_CAPTURE:-}" ]]; then
  env | grep -E '^(VITE_TELEGRAM_BOT_USERNAME|GHCR_USERNAME|GHCR_READ_TOKEN|TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|ORDER_TELEGRAM_URL|ADMIN_TELEGRAM_IDS|PLATPRICES_API_KEY|PLATPRICES_PROXY_URL|POSTGRES_PASSWORD|SESSION_COOKIE_KEY|BACKUP_ENCRYPTION_PASSPHRASE)=' >> "$CHILD_ENV_CAPTURE" || true
fi
exec /usr/bin/mktemp "$@"
STUB
  cat > "$bin_dir/node" <<'STUB'
#!/usr/bin/env bash
echo 'host Node must not be required by the provisioner' >&2
exit 97
STUB
  chmod +x "$bin_dir/docker" "$bin_dir/curl" "$bin_dir/mktemp" "$bin_dir/node"
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
  GHCR_USERNAME='FedrBodr'
  GHCR_READ_TOKEN='github-read-token-secret'
  VITE_TELEGRAM_BOT_USERNAME='ksy_staging_bot'
  POSTGRES_PASSWORD='1111111111111111111111111111111111111111111111111111111111111111'
  SESSION_COOKIE_KEY='2222222222222222222222222222222222222222222222222222222222222222'
  TELEGRAM_BOT_TOKEN='123456:test_bot-token'
  TELEGRAM_WEBHOOK_SECRET='3333333333333333333333333333333333333333333333333333333333333333'
  ORDER_TELEGRAM_URL='https://t.me/ksy_orders'
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
  export ORDER_TELEGRAM_URL='https://t.me/ksy_orders'
  export ADMIN_TELEGRAM_IDS='101,202'
  export PLATPRICES_API_KEY='platprices_test-key'
  export PLATPRICES_PROXY_URL='http://inherited1:abcdefghijklmnopqrstuvwxyzABCDEFGH123456789@185.158.249.84:3128'
  export BACKUP_ENCRYPTION_PASSPHRASE='4444444444444444444444444444444444444444444444444444444444444444'
}

valid_batch() {
  cat <<'BATCH'
SESSION_COOKIE_KEY = 2222222222222222222222222222222222222222222222222222222222222222
GHCR_USERNAME = FedrBodr
ORDER_TELEGRAM_URL = https://t.me/ksy_orders
VITE_TELEGRAM_BOT_USERNAME = ksy_staging_bot
GHCR_READ_TOKEN = github-read-token-secret
POSTGRES_PASSWORD = 1111111111111111111111111111111111111111111111111111111111111111
TELEGRAM_BOT_TOKEN = 123456:test_bot-token
TELEGRAM_WEBHOOK_SECRET = 3333333333333333333333333333333333333333333333333333333333333333
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
POSTGRES_PASSWORD=1111111111111111111111111111111111111111111111111111111111111111
GHCR_READ_TOKEN = github-read-token-secret
VITE_TELEGRAM_BOT_USERNAME=ksy_staging_bot
ORDER_TELEGRAM_URL    = https://t.me/ksy_orders
GHCR_USERNAME=FedrBodr
SESSION_COOKIE_KEY = 2222222222222222222222222222222222222222222222222222222222222222
KSY_SECRETS_END
BATCH
}

duplicate_order_batch() {
  valid_batch | awk '{ if ($0 == "KSY_SECRETS_END") print "ORDER_TELEGRAM_URL = https://t.me/ksy_orders"; print }'
}

duplicate_proxy_batch() {
  valid_batch | awk '{ if ($0 == "KSY_SECRETS_END") print "PLATPRICES_PROXY_URL = http://ksy_user_01:abcdefghijklmnopqrstuvwxyzABCDEFGH123456789@185.158.249.84:3128"; print }'
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

invalid_proxy_batch() {
  valid_batch | awk '{ if ($0 ~ /^PLATPRICES_PROXY_URL/) print "PLATPRICES_PROXY_URL = http://user:short@185.158.249.84:3128"; else print }'
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
      CADDY_SITES_DIR="$case_dir/etc/caddy/sites" \
      STAGED_COMPOSE="$case_dir/tmp/release/docker-compose.yml" \
      bash "$SCRIPT" --image "$image" > "$output" 2>&1
  fi
}

assert_synthetic_secrets_absent() {
  local output=$1
  for secret in "$GHCR_READ_TOKEN" "$POSTGRES_PASSWORD" "$SESSION_COOKIE_KEY" \
    "$TELEGRAM_BOT_TOKEN" "$TELEGRAM_WEBHOOK_SECRET" \
    "$PLATPRICES_API_KEY" "$PLATPRICES_PROXY_URL" "$BACKUP_ENCRYPTION_PASSPHRASE"; do
    ! grep -Fq "$secret" "$output" || fail 'synthetic secret leaked to output'
  done
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
  grep -Fxq "PLATPRICES_PROXY_URL=$PLATPRICES_PROXY_URL" "$case_dir/opt/ksy-deals/.env" ||
    fail 'PlatPrices proxy URL was not materialized exactly'
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
    "$PLATPRICES_API_KEY" "$PLATPRICES_PROXY_URL" "$BACKUP_ENCRYPTION_PASSPHRASE"; do
    ! grep -Fq "$secret" "$output" || fail 'secret leaked to output'
    ! grep -Fq "$secret" "$case_dir/opt/ksy-deals/deployment-evidence.json" ||
      fail 'secret leaked to deployment evidence'
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
  assert_rejection malformed-line 'BATCH_MALFORMED_LINE line=13' malformed_line_batch
  assert_rejection missing-key BATCH_MISSING_KEY missing_admin_batch
  assert_rejection empty-value BATCH_EMPTY_VALUE empty_platprices_batch
  assert_rejection invalid-proxy PLATPRICES_PROXY_URL_INVALID invalid_proxy_batch
}

test_rejects_missing_batch_key_despite_inherited_environment() {
  valid_environment
  inherited_application_environment
  assert_rejection missing-key-inherited-environment BATCH_MISSING_KEY missing_proxy_batch
  unset GHCR_USERNAME GHCR_READ_TOKEN VITE_TELEGRAM_BOT_USERNAME POSTGRES_PASSWORD \
    SESSION_COOKIE_KEY TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET ORDER_TELEGRAM_URL \
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
    CADDY_SITES_DIR="$case_dir/etc/caddy/sites" \
    STAGED_COMPOSE="$case_dir/tmp/release/docker-compose.yml" \
  expect > "$output" 2>&1 <<'EXPECT' && return 0
log_user 1
set timeout 10
spawn -noecho bash $env(PTY_SCRIPT) --image $env(PTY_IMAGE)
expect {
  -exact "Paste the twelve KSY secret assignments, then KSY_SECRETS_END:" {}
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
  rg -n 'ECHO_OFF|Paste the twelve|KSY_PROVISION_(FAILED|PROVISIONED)|ROOT_REQUIRED|TTY_REQUIRED' \
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
  if [[ "$transcript" != *'[ECHO_OFF]'*'Paste the twelve KSY secret assignments, then KSY_SECRETS_END:'* ]]; then
    rg -n 'ECHO_OFF|Paste the twelve|KSY_PROVISION_(FAILED|PROVISIONED)' "$output" >&2 || true
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
      CADDY_SITES_DIR="$case_dir/etc/caddy/sites" \
      STAGED_COMPOSE="$case_dir/tmp/release/docker-compose.yml" \
      expect > "$output" 2>&1 <<'EXPECT'
log_user 1
set timeout 5
spawn -noecho bash $env(PTY_SCRIPT) --image $env(PTY_IMAGE)
expect -exact "Paste the twelve KSY secret assignments, then KSY_SECRETS_END:"
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

test_rejects_full_disk_before_mutation
test_rejects_mutable_image_before_mutation
test_provisions_idempotently_without_secret_leaks
test_restores_previous_installation_after_failed_readiness
test_rejects_batch_safety_failures_before_mutation
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
