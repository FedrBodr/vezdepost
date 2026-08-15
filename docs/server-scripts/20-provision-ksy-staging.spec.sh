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
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"
}

make_stubs() {
  local bin_dir=$1
  mkdir -p "$bin_dir"
  cat > "$bin_dir/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_CALLS"
if [[ "$1 $2" == 'network inspect' ]]; then
  [[ -f "$NETWORK_MARKER" ]]
elif [[ "$1 $2" == 'network create' ]]; then
  : > "$NETWORK_MARKER"
fi
STUB
  cat > "$bin_dir/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CURL_CALLS"
[[ "${CURL_FAIL:-0}" != 1 ]]
STUB
  chmod +x "$bin_dir/docker" "$bin_dir/curl"
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
  export KSY_DEALS_IMAGE='ghcr.io/fedrbodr/ksy-deals@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  export VITE_TELEGRAM_BOT_USERNAME='ksy_staging_bot'
  export POSTGRES_PASSWORD='1111111111111111111111111111111111111111111111111111111111111111'
  export SESSION_COOKIE_KEY='2222222222222222222222222222222222222222222222222222222222222222'
  export TELEGRAM_BOT_TOKEN='123456:test_bot-token'
  export TELEGRAM_WEBHOOK_SECRET='3333333333333333333333333333333333333333333333333333333333333333'
  export ORDER_TELEGRAM_URL='https://t.me/ksy_orders'
  export ADMIN_TELEGRAM_IDS='101,202'
  export PLATPRICES_API_KEY='platprices_test-key'
  export BACKUP_ENCRYPTION_PASSPHRASE='4444444444444444444444444444444444444444444444444444444444444444'
}

run_case() {
  local case_dir=$1
  local output=$2
  local curl_fail=${3:-0}
  local bin_dir="$case_dir/bin"
  mkdir -p "$case_dir"
  make_stubs "$bin_dir"
  : > "$case_dir/docker.calls"
  : > "$case_dir/curl.calls"
  PATH="$bin_dir:$PATH" \
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
  unset KSY_PROVISION_TEST_DISK_USED_PERCENT
}

test_rejects_mutable_image_before_mutation() {
  local case_dir="$TMP_DIR/mutable-image"
  local output="$case_dir/output"
  mkdir -p "$case_dir"
  valid_environment
  export KSY_DEALS_IMAGE='ghcr.io/fedrbodr/ksy-deals:latest'
  write_staged_compose "$case_dir/tmp/release/docker-compose.yml"

  if run_case "$case_dir" "$output"; then
    fail 'mutable image tag was accepted'
  fi
  [[ ! -e "$case_dir/opt/ksy-deals/.env" ]] ||
    fail 'target env was created after image rejection'
  [[ ! -s "$case_dir/docker.calls" ]] ||
    fail 'Docker ran after image rejection'
}

test_provisions_idempotently_without_secret_leaks() {
  local case_dir="$TMP_DIR/success"
  local output="$case_dir/output"
  mkdir -p "$case_dir"
  valid_environment
  write_staged_compose "$case_dir/tmp/release/docker-compose.yml"

  run_case "$case_dir" "$output"
  run_case "$case_dir" "$case_dir/output-second"

  assert_eq 600 "$(file_mode "$case_dir/opt/ksy-deals/.env")" \
    'staging env must be owner-readable only'
  assert_eq 600 "$(file_mode "$case_dir/opt/ksy-deals/deployment-evidence.json")" \
    'deployment evidence must be owner-readable only'
  assert_eq 1 "$(grep -c '^KSY_DEALS_IMAGE=' "$case_dir/opt/ksy-deals/.env")" \
    'image digest must have one definition'
  assert_eq 1 "$(grep -c '^DATABASE_URL=' "$case_dir/opt/ksy-deals/.env")" \
    'database URL must have one definition'
  [[ -f "$case_dir/etc/caddy/sites/00-empty.caddy" ]] ||
    fail 'empty Caddy import placeholder was not created'
  [[ -f "$case_dir/network.created" ]] || fail 'caddy-edge was not created'
  grep -q 'compose --project-name ksy-deals .* config --quiet' "$case_dir/docker.calls" ||
    fail 'Compose config was not validated'
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

  for secret in "$POSTGRES_PASSWORD" "$SESSION_COOKIE_KEY" \
    "$TELEGRAM_BOT_TOKEN" "$TELEGRAM_WEBHOOK_SECRET" \
    "$PLATPRICES_API_KEY" "$BACKUP_ENCRYPTION_PASSPHRASE"; do
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
}

test_rejects_full_disk_before_mutation
test_rejects_mutable_image_before_mutation
test_provisions_idempotently_without_secret_leaks
test_restores_previous_installation_after_failed_readiness
echo 'KSY staging provisioner tests passed'
