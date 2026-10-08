#!/usr/bin/env bash
# Install the daily KSY promo banner scrape wrapper and cron entry.
#
# The banner-scraper image is not part of KSY_DEALS_IMAGE and the host has no
# KSY source checkout, so the image must already be loaded as
# ksy-deals-banner-scraper:latest. The wrapper never builds it.
set -euo pipefail
umask 077

KSY_ROOT=${KSY_ROOT:-/opt/ksy-deals}
SCRAPE_PROGRAM=${SCRAPE_PROGRAM:-/usr/local/sbin/ksy-deals-banner-scrape}
CRON_FILE=${CRON_FILE:-/etc/cron.d/ksy-deals-banner-scrape}
LOG_FILE=${LOG_FILE:-/var/log/ksy-deals-banner-scrape.log}
SCRAPER_IMAGE=${SCRAPER_IMAGE:-ksy-deals-banner-scraper:latest}
TEST_MODE=${KSY_BANNER_SCRAPE_TEST_MODE:-0}
KSY_ENV_FILE="$KSY_ROOT/.env"
COMPOSE_FILE="$KSY_ROOT/docker-compose.yml"
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

fail() {
  printf 'KSY_BANNER_SCRAPE_INSTALL_FAILED %s\n' "$1" >&2
  exit 1
}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

install_file() {
  local source=$1
  local target=$2
  local mode=$3
  if [[ "$TEST_MODE" == 1 ]]; then
    mkdir -p "$(dirname "$target")"
    cp "$source" "$target"
    chmod "$mode" "$target"
  else
    install -o root -g root -m "$mode" "$source" "$target"
  fi
}

[[ "$TEST_MODE" == 1 || $EUID -eq 0 ]] || fail ROOT_REQUIRED
[[ -f "$KSY_ENV_FILE" && -f "$COMPOSE_FILE" ]] || fail KSY_INSTALLATION_MISSING
[[ "$(file_mode "$KSY_ENV_FILE")" == 600 ]] || fail KSY_ENV_MODE_INVALID
if [[ "$TEST_MODE" != 1 ]]; then
  [[ "$(stat -c '%U:%G' "$KSY_ENV_FILE")" == root:root ]] || fail KSY_ENV_OWNER_INVALID
fi
grep -q '^  banner-scraper:$' "$COMPOSE_FILE" || fail SCRAPER_SERVICE_MISSING
docker image inspect "$SCRAPER_IMAGE" >/dev/null 2>&1 || fail SCRAPER_IMAGE_MISSING

banner_dir=$(sed -n 's/^KSY_DEALS_BANNER_DIR=//p' "$KSY_ENV_FILE" | tail -n 1)
[[ "$banner_dir" == /* ]] || fail KSY_BANNER_DIR_INVALID
[[ -d "$banner_dir" ]] || fail KSY_BANNER_DIR_MISSING

wrapper="$WORK_DIR/ksy-deals-banner-scrape"
cat > "$wrapper" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
umask 077

KSY_ROOT=${KSY_ROOT:-/opt/ksy-deals}
LOG_FILE=${LOG_FILE:-/var/log/ksy-deals-banner-scrape.log}
SCRAPER_IMAGE=${SCRAPER_IMAGE:-ksy-deals-banner-scraper:latest}
LOCK_FILE=${LOCK_FILE:-/run/ksy-deals-banner-scrape.lock}
KSY_ENV_FILE="$KSY_ROOT/.env"
COMPOSE_FILE="$KSY_ROOT/docker-compose.yml"
TEST_MODE=${KSY_BANNER_SCRAPE_TEST_MODE:-0}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

file_owner() {
  stat -c '%U:%G' "$1" 2>/dev/null || stat -f '%Su:%Sg' "$1"
}

log() {
  printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG_FILE"
}

exec 9> "$LOCK_FILE"
flock -n 9 || {
  log 'SKIP previous scrape still running'
  exit 0
}

[[ -f "$KSY_ENV_FILE" && -f "$COMPOSE_FILE" ]] || {
  log 'ERROR configuration file missing'
  exit 1
}
[[ "$(file_mode "$KSY_ENV_FILE")" == 600 ]] || {
  log 'ERROR configuration file mode invalid'
  exit 1
}
if [[ "$TEST_MODE" != 1 ]]; then
  [[ "$(file_owner "$KSY_ENV_FILE")" == root:root ]] || {
    log 'ERROR KSY_BANNER_SCRAPE_ENV_OWNER_INVALID'
    exit 1
  }
fi
# Without a loaded image Compose would try to build from a source tree that
# does not exist on this host.
docker image inspect "$SCRAPER_IMAGE" >/dev/null 2>&1 || {
  log 'ERROR SCRAPER_IMAGE_MISSING'
  exit 1
}

status=0
docker compose --project-name ksy-deals \
  --env-file "$KSY_ENV_FILE" -f "$COMPOSE_FILE" \
  --profile maintenance run --rm banner-scraper >> "$LOG_FILE" 2>&1 || status=$?
if [[ "$status" != 0 ]]; then
  log "ERROR scrape exited with status $status"
  exit "$status"
fi
log 'PASS banner scrape completed'
WRAPPER
chmod 700 "$wrapper"

cron="$WORK_DIR/ksy-deals-banner-scrape.cron"
cat > "$cron" <<CRON
# KSY Deals daily PS Store promo banner scrape
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
CRON_TZ=Europe/Moscow
30 4 * * * root $SCRAPE_PROGRAM
CRON
chmod 644 "$cron"

mkdir -p "$(dirname "$SCRAPE_PROGRAM")" "$(dirname "$CRON_FILE")" "$(dirname "$LOG_FILE")"
install_file "$wrapper" "$SCRAPE_PROGRAM" 700
install_file "$cron" "$CRON_FILE" 644
touch "$LOG_FILE"
chmod 640 "$LOG_FILE"
if [[ "$TEST_MODE" != 1 ]]; then
  chown root:root "$LOG_FILE"
fi

printf 'KSY_BANNER_SCRAPE_INSTALLED program=%s cron=%s schedule=04:30-Europe/Moscow\n' \
  "$SCRAPE_PROGRAM" "$CRON_FILE"
