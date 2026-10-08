#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/27-install-ksy-banner-scrape.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

make_stubs() {
  local bin_dir=$1
  mkdir -p "$bin_dir"
  cat > "$bin_dir/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_CALLS"
if [[ "$1 $2" == "image inspect" ]]; then
  [[ "${SCRAPER_IMAGE_PRESENT:-1}" == 1 ]]
  exit
fi
printf '%s\n' 'scrape output database-secret-free'
exit "${SCRAPE_STATUS:-0}"
STUB
  cat > "$bin_dir/flock" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
  chmod +x "$bin_dir/docker" "$bin_dir/flock"
}

write_env() {
  local case_dir=$1
  mkdir -p "$case_dir/opt/ksy-deals" "$case_dir/banners"
  cat > "$case_dir/opt/ksy-deals/.env" <<ENV
KSY_DEALS_BANNER_DIR=$case_dir/banners
DATABASE_URL=postgresql://ksy:database-secret@db:5432/ksy_deals
ENV
  chmod 600 "$case_dir/opt/ksy-deals/.env"
  printf '%s\n' 'services:' '  banner-scraper:' '    profiles: ["maintenance"]' \
    > "$case_dir/opt/ksy-deals/docker-compose.yml"
}

install_case() {
  local case_dir=$1
  local output=$2
  make_stubs "$case_dir/bin"
  : > "$case_dir/docker.calls"
  PATH="$case_dir/bin:$PATH" \
    DOCKER_CALLS="$case_dir/docker.calls" \
    KSY_BANNER_SCRAPE_TEST_MODE=1 \
    KSY_ROOT="$case_dir/opt/ksy-deals" \
    SCRAPE_PROGRAM="$case_dir/usr/local/sbin/ksy-deals-banner-scrape" \
    CRON_FILE="$case_dir/etc/cron.d/ksy-deals-banner-scrape" \
    LOG_FILE="$case_dir/var/log/ksy-deals-banner-scrape.log" \
    bash "$SCRIPT" > "$output" 2>&1
}

run_wrapper() {
  local case_dir=$1
  local output=$2
  PATH="$case_dir/bin:$PATH" \
    DOCKER_CALLS="$case_dir/docker.calls" \
    KSY_ROOT="$case_dir/opt/ksy-deals" \
    LOG_FILE="$case_dir/var/log/ksy-deals-banner-scrape.log" \
    LOCK_FILE="$case_dir/scrape.lock" \
    KSY_BANNER_SCRAPE_TEST_MODE=1 \
    bash "$case_dir/usr/local/sbin/ksy-deals-banner-scrape" > "$output" 2>&1
}

test_rejects_non_private_env_file() {
  local case_dir="$TMP_DIR/public-env"
  mkdir -p "$case_dir"
  write_env "$case_dir"
  chmod 644 "$case_dir/opt/ksy-deals/.env"
  if install_case "$case_dir" "$case_dir/output"; then
    fail 'publicly readable KSY env was accepted'
  fi
  [[ ! -e "$case_dir/usr/local/sbin/ksy-deals-banner-scrape" ]] ||
    fail 'wrapper was installed after env rejection'
}

test_rejects_missing_scraper_image() {
  local case_dir="$TMP_DIR/no-image"
  mkdir -p "$case_dir"
  write_env "$case_dir"
  if SCRAPER_IMAGE_PRESENT=0 install_case "$case_dir" "$case_dir/output"; then
    fail 'missing scraper image was accepted'
  fi
  grep -q 'SCRAPER_IMAGE_MISSING' "$case_dir/output" ||
    fail 'missing image was not reported'
}

test_rejects_missing_banner_dir() {
  local case_dir="$TMP_DIR/no-banner-dir"
  mkdir -p "$case_dir"
  write_env "$case_dir"
  rmdir "$case_dir/banners"
  if install_case "$case_dir" "$case_dir/output"; then
    fail 'missing banner directory was accepted'
  fi
  grep -q 'KSY_BANNER_DIR_MISSING' "$case_dir/output" ||
    fail 'missing banner directory was not reported'
}

test_installs_and_runs_scraper_idempotently() {
  local case_dir="$TMP_DIR/success"
  mkdir -p "$case_dir"
  write_env "$case_dir"
  install_case "$case_dir" "$case_dir/output"
  cp "$case_dir/usr/local/sbin/ksy-deals-banner-scrape" "$case_dir/wrapper.before"
  install_case "$case_dir" "$case_dir/output-second"
  cmp -s "$case_dir/wrapper.before" "$case_dir/usr/local/sbin/ksy-deals-banner-scrape" ||
    fail 'idempotent install changed the wrapper'

  [[ "$(file_mode "$case_dir/usr/local/sbin/ksy-deals-banner-scrape")" == 700 ]] ||
    fail 'wrapper mode must be 700'
  [[ "$(file_mode "$case_dir/etc/cron.d/ksy-deals-banner-scrape")" == 644 ]] ||
    fail 'cron mode must be 644'
  grep -q '^CRON_TZ=Europe/Moscow$' "$case_dir/etc/cron.d/ksy-deals-banner-scrape" ||
    fail 'cron timezone is missing'
  grep -q '^30 4 \* \* \* root ' "$case_dir/etc/cron.d/ksy-deals-banner-scrape" ||
    fail 'daily 04:30 schedule is missing'

  : > "$case_dir/docker.calls"
  run_wrapper "$case_dir" "$case_dir/wrapper.output"
  grep -q '^compose --project-name ksy-deals .* --profile maintenance run --rm banner-scraper$' \
    "$case_dir/docker.calls" || fail 'banner-scraper maintenance service was not invoked'
  ! grep -q -- '--build' "$case_dir/docker.calls" || fail 'wrapper must never build'
  grep -q 'PASS banner scrape completed' "$case_dir/var/log/ksy-deals-banner-scrape.log" ||
    fail 'successful scrape was not logged'
  ! grep -Fq 'database-secret@' "$case_dir/output" || fail 'secret leaked from installer'
  ! grep -Fq 'database-secret@' "$case_dir/var/log/ksy-deals-banner-scrape.log" ||
    fail 'secret leaked to scrape log'
}

test_wrapper_fails_without_image_and_on_scrape_failure() {
  local case_dir="$TMP_DIR/runtime-failures"
  mkdir -p "$case_dir"
  write_env "$case_dir"
  install_case "$case_dir" "$case_dir/output"

  : > "$case_dir/docker.calls"
  if SCRAPER_IMAGE_PRESENT=0 run_wrapper "$case_dir" "$case_dir/no-image.output"; then
    fail 'wrapper succeeded without the scraper image'
  fi
  ! grep -q '^compose ' "$case_dir/docker.calls" ||
    fail 'wrapper ran Compose without the scraper image'
  grep -q 'ERROR SCRAPER_IMAGE_MISSING' "$case_dir/var/log/ksy-deals-banner-scrape.log" ||
    fail 'missing image was not logged'

  if SCRAPE_STATUS=3 run_wrapper "$case_dir" "$case_dir/failed.output"; then
    fail 'wrapper hid a failed scrape'
  fi
  grep -q 'ERROR scrape exited with status 3' "$case_dir/var/log/ksy-deals-banner-scrape.log" ||
    fail 'failed scrape status was not logged'
}

test_rejects_non_private_env_file
test_rejects_missing_scraper_image
test_rejects_missing_banner_dir
test_installs_and_runs_scraper_idempotently
test_wrapper_fails_without_image_and_on_scrape_failure
echo 'KSY banner scrape installer tests passed'
