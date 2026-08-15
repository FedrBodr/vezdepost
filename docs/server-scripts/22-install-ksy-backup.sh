#!/usr/bin/env bash
# Install the isolated encrypted KSY backup wrapper and daily cron entry.
set -euo pipefail
umask 077

KSY_ROOT=${KSY_ROOT:-/opt/ksy-deals}
B2_ENV_FILE=${B2_ENV_FILE:-/root/vezdepost-backup.env}
BACKUP_PROGRAM=${BACKUP_PROGRAM:-/usr/local/sbin/ksy-deals-backup}
CRON_FILE=${CRON_FILE:-/etc/cron.d/ksy-deals-backup}
LOG_FILE=${LOG_FILE:-/var/log/ksy-deals-backup.log}
TEST_MODE=${KSY_BACKUP_TEST_MODE:-0}
KSY_ENV_FILE="$KSY_ROOT/.env"
COMPOSE_FILE="$KSY_ROOT/docker-compose.yml"
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

fail() {
  printf 'KSY_BACKUP_INSTALL_FAILED %s\n' "$1" >&2
  exit 1
}

file_mode() {
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"
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
[[ -f "$B2_ENV_FILE" ]] || fail B2_ENV_MISSING
[[ "$(file_mode "$KSY_ENV_FILE")" == 600 ]] || fail KSY_ENV_MODE_INVALID
[[ "$(file_mode "$B2_ENV_FILE")" == 600 ]] || fail B2_ENV_MODE_INVALID
if [[ "$TEST_MODE" != 1 ]]; then
  [[ "$(stat -c '%U:%G' "$KSY_ENV_FILE")" == root:root ]] || fail KSY_ENV_OWNER_INVALID
  [[ "$(stat -c '%U:%G' "$B2_ENV_FILE")" == root:root ]] || fail B2_ENV_OWNER_INVALID
fi

set -a
# shellcheck disable=SC1090
. "$KSY_ENV_FILE"
# shellcheck disable=SC1090
. "$B2_ENV_FILE"
set +a

[[ "${KSY_DEALS_BACKUP_DIR:-}" == /* ]] || fail KSY_BACKUP_DIR_INVALID
[[ -d "$KSY_DEALS_BACKUP_DIR" ]] || fail KSY_BACKUP_DIR_MISSING
[[ -n "${B2_ACCOUNT_ID:-}" && "$B2_ACCOUNT_ID" != REPLACE_WITH_KEY_ID ]] ||
  fail B2_ACCOUNT_ID_INVALID
[[ -n "${B2_APP_KEY:-}" && "$B2_APP_KEY" != REPLACE_WITH_APP_KEY ]] ||
  fail B2_APP_KEY_INVALID
[[ "${B2_BUCKET:-}" =~ ^[A-Za-z0-9.-]+$ ]] || fail B2_BUCKET_INVALID

wrapper="$WORK_DIR/ksy-deals-backup"
cat > "$wrapper" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
umask 077

KSY_ROOT=${KSY_ROOT:-/opt/ksy-deals}
B2_ENV_FILE=${B2_ENV_FILE:-/root/vezdepost-backup.env}
LOG_FILE=${LOG_FILE:-/var/log/ksy-deals-backup.log}
KSY_ENV_FILE="$KSY_ROOT/.env"
COMPOSE_FILE="$KSY_ROOT/docker-compose.yml"
REMOTE_KEEP_DAYS=90
TEST_MODE=${KSY_BACKUP_TEST_MODE:-0}

file_mode() {
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"
}

file_owner() {
  stat -f '%Su:%Sg' "$1" 2>/dev/null || stat -c '%U:%G' "$1"
}

log() {
  printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG_FILE"
}

[[ -f "$KSY_ENV_FILE" && -f "$COMPOSE_FILE" && -f "$B2_ENV_FILE" ]] || {
  log 'ERROR configuration file missing'
  exit 1
}
[[ "$(file_mode "$KSY_ENV_FILE")" == 600 && "$(file_mode "$B2_ENV_FILE")" == 600 ]] || {
  log 'ERROR configuration file mode invalid'
  exit 1
}
if [[ "$TEST_MODE" != 1 ]]; then
  [[ "$(file_owner "$KSY_ENV_FILE")" == root:root ]] || {
    log 'ERROR KSY_BACKUP_ENV_OWNER_INVALID'
    exit 1
  }
  [[ "$(file_owner "$B2_ENV_FILE")" == root:root ]] || {
    log 'ERROR B2_ENV_OWNER_INVALID'
    exit 1
  }
fi

set -a
# shellcheck disable=SC1090
. "$KSY_ENV_FILE"
# shellcheck disable=SC1090
. "$B2_ENV_FILE"
set +a
[[ "${KSY_DEALS_BACKUP_DIR:-}" == /* && -d "$KSY_DEALS_BACKUP_DIR" ]] || {
  log 'ERROR backup directory invalid'
  exit 1
}
[[ -n "${B2_ACCOUNT_ID:-}" && -n "${B2_APP_KEY:-}" &&
  "$B2_ACCOUNT_ID" != REPLACE_WITH_KEY_ID && "$B2_APP_KEY" != REPLACE_WITH_APP_KEY &&
  "${B2_BUCKET:-}" =~ ^[A-Za-z0-9.-]+$ ]] || {
  log 'ERROR B2 configuration invalid'
  exit 1
}

marker=$(mktemp "$KSY_DEALS_BACKUP_DIR/.offsite-marker.XXXXXX")
trap 'rm -f "$marker"' EXIT
docker compose --project-name ksy-deals \
  --env-file "$KSY_ENV_FILE" -f "$COMPOSE_FILE" \
  --profile maintenance run --rm backup >/dev/null

new_files=$(find "$KSY_DEALS_BACKUP_DIR" -maxdepth 1 -type f \
  -name 'ksy-deals-*.dump.gpg' -newer "$marker" -print)
[[ -n "$new_files" && "$new_files" != *$'\n'* ]] || {
  log 'ERROR expected exactly one new encrypted backup'
  exit 1
}
[[ -s "$new_files" ]] || {
  log 'ERROR encrypted backup is empty'
  exit 1
}

export RCLONE_CONFIG_B2_TYPE=b2
export RCLONE_CONFIG_B2_ACCOUNT="$B2_ACCOUNT_ID"
export RCLONE_CONFIG_B2_KEY="$B2_APP_KEY"
rclone copy "$new_files" "B2:$B2_BUCKET/ksy-deals/" --no-traverse \
  >> "$LOG_FILE" 2>&1
rclone delete "B2:$B2_BUCKET/ksy-deals/" --min-age "${REMOTE_KEEP_DAYS}d" \
  >> "$LOG_FILE" 2>&1
log "PASS file=$(basename "$new_files") bytes=$(wc -c < "$new_files" | tr -d ' ') offsite=ksy-deals/"
printf 'KSY_BACKUP_COMPLETE file=%s offsite=ksy-deals/\n' "$(basename "$new_files")"
WRAPPER
chmod 700 "$wrapper"

cron="$WORK_DIR/ksy-deals-backup.cron"
cat > "$cron" <<CRON
# KSY Deals encrypted PostgreSQL backup -> separate B2 prefix
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
CRON_TZ=Europe/Moscow
37 3 * * * root $BACKUP_PROGRAM
CRON
chmod 644 "$cron"

mkdir -p "$(dirname "$BACKUP_PROGRAM")" "$(dirname "$CRON_FILE")" "$(dirname "$LOG_FILE")"
install_file "$wrapper" "$BACKUP_PROGRAM" 700
install_file "$cron" "$CRON_FILE" 644
touch "$LOG_FILE"
chmod 640 "$LOG_FILE"
if [[ "$TEST_MODE" != 1 ]]; then
  chown root:root "$LOG_FILE"
fi

unset DATABASE_URL BACKUP_ENCRYPTION_PASSPHRASE B2_ACCOUNT_ID B2_APP_KEY
printf 'KSY_BACKUP_INSTALLED program=%s cron=%s schedule=03:37-Europe/Moscow\n' \
  "$BACKUP_PROGRAM" "$CRON_FILE"
