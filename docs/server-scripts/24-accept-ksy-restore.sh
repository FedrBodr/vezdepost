#!/usr/bin/env bash
# Restore the newest encrypted KSY backup into one fixed disposable database.
set -euo pipefail
umask 077

KSY_ROOT=${KSY_ROOT:-/opt/ksy-deals}
ENV_FILE="$KSY_ROOT/.env"
COMPOSE_FILE="$KSY_ROOT/docker-compose.yml"
TEST_MODE=${KSY_RESTORE_TEST_MODE:-0}
restore_created=0
failure=RESTORE_TOOL_FAILED
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/ksy-restore-accept.XXXXXX")
chmod 700 "$WORK_DIR"
restore_diagnostic="$WORK_DIR/restore.stderr"
: > "$restore_diagnostic"
chmod 600 "$restore_diagnostic"

fail() { failure=$1; exit 1; }
file_mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }
mtime() { stat -c '%Y' "$1" 2>/dev/null || stat -f '%m' "$1"; }
fingerprint() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
  else LC_ALL=C shasum -a 256 | awk '{print $1}'; fi
}

restore_class_for_status() {
  case "$1" in
    41) printf '%s\n' DECRYPTION_FAILED ;;
    42) printf '%s\n' ARCHIVE_TOC_FAILED ;;
    43) printf '%s\n' DATABASE_CONNECTION_FAILED ;;
    44) printf '%s\n' PG_RESTORE_FAILED ;;
    *) printf '%s\n' RESTORE_TOOL_FAILED ;;
  esac
}

cleanup_restore() {
  [[ "$restore_created" == 1 ]] || return 0
  "${compose[@]}" exec -T db psql --username "$POSTGRES_USER" --dbname postgres \
    --no-psqlrc --set ON_ERROR_STOP=1 \
    --command 'DROP DATABASE ksy_deals_restore WITH (FORCE)' >/dev/null 2>"$WORK_DIR/cleanup.stderr" ||
    return 1
  restore_created=0
}

on_exit() {
  local status=$? cleanup_failed=0
  trap - EXIT HUP INT TERM
  cleanup_restore || cleanup_failed=1
  rm -rf "$WORK_DIR"
  if [[ "$cleanup_failed" == 1 ]]; then
    failure=CLEANUP_FAILED
    status=1
  fi
  if [[ "$status" != 0 ]]; then
    printf 'KSY_RESTORE_ACCEPT_FAILED %s\n' "$failure" >&2
  fi
  exit "$status"
}
trap on_exit EXIT
trap 'failure=RESTORE_TOOL_FAILED; exit 1' HUP INT TERM

[[ $# -eq 0 ]] || fail ARGUMENTS_INVALID
[[ "$TEST_MODE" == 1 || $EUID -eq 0 ]] || fail ROOT_REQUIRED
[[ -f "$ENV_FILE" && ! -L "$ENV_FILE" && -f "$COMPOSE_FILE" && ! -L "$COMPOSE_FILE" ]] ||
  fail KSY_INSTALLATION_MISSING
[[ "$(file_mode "$ENV_FILE")" == 600 ]] || fail KSY_ENV_MODE_INVALID
if [[ "$TEST_MODE" != 1 ]]; then
  [[ "$(stat -c '%U:%G' "$ENV_FILE")" == root:root ]] || fail KSY_ENV_OWNER_INVALID
fi

unset POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL \
  BACKUP_ENCRYPTION_PASSPHRASE KSY_DEALS_BACKUP_DIR KSY_DEALS_IMAGE \
  TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET ADMIN_TELEGRAM_IDS \
  PLATPRICES_API_KEY PLATPRICES_PROXY_URL
# shellcheck disable=SC1090
. "$ENV_FILE"
[[ "${POSTGRES_DB:-}" == ksy_deals && "${POSTGRES_USER:-}" == ksy_deals ]] ||
  fail POSTGRES_IDENTITY_INVALID
[[ "${POSTGRES_PASSWORD:-}" =~ ^[a-f0-9]{64}$ ]] || fail POSTGRES_PASSWORD_INVALID
[[ "${BACKUP_ENCRYPTION_PASSPHRASE:-}" =~ ^[a-f0-9]{64}$ ]] || fail BACKUP_PASSPHRASE_INVALID
[[ "${KSY_DEALS_BACKUP_DIR:-}" == /* && -d "$KSY_DEALS_BACKUP_DIR" ]] || fail BACKUP_DIR_INVALID

compose_project=ksy-deals
if [[ "$TEST_MODE" == 1 ]]; then
  [[ "${KSY_RESTORE_COMPOSE_PROJECT:-ksy-deals}" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] ||
    fail TEST_COMPOSE_PROJECT_INVALID
  compose_project=${KSY_RESTORE_COMPOSE_PROJECT:-ksy-deals}
  if [[ -n "${KSY_RESTORE_TEST_IMAGE:-}" ]]; then
    [[ "$KSY_DEALS_IMAGE" == "$KSY_RESTORE_TEST_IMAGE" ]] || fail TEST_IMAGE_MISMATCH
  else
    [[ "$KSY_DEALS_IMAGE" =~ ^ghcr\.io/fedrbodr/ksy-deals@sha256:[a-f0-9]{64}$ ]] ||
      fail KSY_DEALS_IMAGE_INVALID
  fi
else
  [[ "$KSY_DEALS_IMAGE" =~ ^ghcr\.io/fedrbodr/ksy-deals@sha256:[a-f0-9]{64}$ ]] ||
    fail KSY_DEALS_IMAGE_INVALID
fi

shopt -s nullglob
candidates=("$KSY_DEALS_BACKUP_DIR"/ksy-deals-*.dump.gpg)
shopt -u nullglob
[[ ${#candidates[@]} -gt 0 ]] || fail BACKUP_MISSING
newest=''
newest_mtime=-1
newest_ties=0
for candidate in "${candidates[@]}"; do
  [[ -f "$candidate" && ! -L "$candidate" && -s "$candidate" ]] || fail BACKUP_INVALID
  basename "$candidate" | grep -Eq '^ksy-deals-[0-9]{8}T[0-9]{6}Z\.dump\.gpg$' ||
    fail BACKUP_NAME_INVALID
  candidate_mtime=$(mtime "$candidate")
  [[ "$candidate_mtime" =~ ^[0-9]+$ ]] || fail BACKUP_MTIME_INVALID
  if ((candidate_mtime > newest_mtime)); then
    newest=$candidate
    newest_mtime=$candidate_mtime
    newest_ties=1
  elif ((candidate_mtime == newest_mtime)); then
    newest_ties=$((newest_ties + 1))
  fi
done
[[ "$newest_ties" == 1 ]] || fail BACKUP_NEWEST_AMBIGUOUS
backup_name=$(basename "$newest")
backup_bytes=$(wc -c < "$newest" | tr -d ' ')

compose=(docker --host unix:///var/run/docker.sock compose --project-name "$compose_project" \
  --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

read_counts() {
  local database=$1
  "${compose[@]}" exec -T db psql --username "$POSTGRES_USER" --dbname "$database" \
    --no-psqlrc --tuples-only --no-align \
    --command "SELECT (SELECT COUNT(*) FROM game_editions),(SELECT COUNT(*) FROM price_observations)"
}

read_game_editions() {
  local database=$1
  "${compose[@]}" exec -T db psql --username "$POSTGRES_USER" --dbname "$database" \
    --no-psqlrc --tuples-only --no-align --command "-- KSY_FULL_GAME_EDITIONS_V1
SELECT encode(convert_to(row_to_json(row_data)::text,'UTF8'),'hex')
FROM (SELECT * FROM game_editions ORDER BY id) AS row_data"
}

read_price_observations() {
  local database=$1
  "${compose[@]}" exec -T db psql --username "$POSTGRES_USER" --dbname "$database" \
    --no-psqlrc --tuples-only --no-align --command "-- KSY_FULL_PRICE_OBSERVATIONS_V1
SELECT encode(convert_to(row_to_json(row_data)::text,'UTF8'),'hex')
FROM (SELECT * FROM price_observations ORDER BY id) AS row_data"
}

read_migrations() {
  local database=$1
  "${compose[@]}" exec -T db psql --username "$POSTGRES_USER" --dbname "$database" \
    --no-psqlrc --tuples-only --no-align --command "-- KSY_SCHEMA_MIGRATIONS_V1
SELECT encode(convert_to(name,'UTF8'),'hex') FROM schema_migrations ORDER BY name"
}

read_post_format_count() {
  local database=$1
  "${compose[@]}" exec -T db psql --username "$POSTGRES_USER" --dbname "$database" \
    --no-psqlrc --tuples-only --no-align --command "-- KSY_DEAL_POST_FORMAT_COUNT_V1
SELECT CASE WHEN COUNT(*)=1 AND bool_and(singleton AND format IN ('ONE_LINE','TWO_LINES','THREE_LINES')) THEN 1 ELSE 0 END
FROM deal_post_format_settings"
}

read_post_format() {
  local database=$1
  "${compose[@]}" exec -T db psql --username "$POSTGRES_USER" --dbname "$database" \
    --no-psqlrc --tuples-only --no-align --command "-- KSY_DEAL_POST_FORMAT_V1
SELECT encode(convert_to(row_to_json(row_data)::text,'UTF8'),'hex')
FROM (SELECT * FROM deal_post_format_settings ORDER BY singleton) AS row_data"
}

read_snapshot() {
  local database=$1 target=$2 counts editions observations migrations post_format format_rows
  counts=$(read_counts "$database") || return 1
  [[ "$counts" =~ ^[0-9]+\|[0-9]+$ ]] || return 1
  editions=$(read_game_editions "$database" | fingerprint) || return 1
  observations=$(read_price_observations "$database" | fingerprint) || return 1
  migrations=$(read_migrations "$database" | fingerprint) || return 1
  post_format=$(read_post_format "$database" | fingerprint) || return 1
  format_rows=$(read_post_format_count "$database") || return 1
  [[ "$format_rows" == 1 ]] || return 1
  printf 'edition_count=%s\nobservation_count=%s\nedition_sha256=%s\nobservation_sha256=%s\nmigrations_sha256=%s\npost_format_sha256=%s\npost_format_rows=1\n' \
    "${counts%%|*}" "${counts##*|}" "$editions" "$observations" "$migrations" "$post_format" > "$target"
  chmod 600 "$target"
}

live_before="$WORK_DIR/live-before.snapshot"
restore_snapshot="$WORK_DIR/restore.snapshot"
live_after="$WORK_DIR/live-after.snapshot"
read_snapshot ksy_deals "$live_before" || fail LIVE_EVIDENCE_FAILED

existing=$("${compose[@]}" exec -T db psql --username "$POSTGRES_USER" --dbname postgres \
  --no-psqlrc --tuples-only --no-align \
  --command "SELECT 1 FROM pg_database WHERE datname='ksy_deals_restore'") ||
  fail RESTORE_DATABASE_PREFLIGHT_FAILED
[[ -z "$existing" ]] || fail RESTORE_DATABASE_ALREADY_EXISTS
"${compose[@]}" exec -T db psql --username "$POSTGRES_USER" --dbname postgres \
  --no-psqlrc --set ON_ERROR_STOP=1 --command 'CREATE DATABASE ksy_deals_restore' \
  >/dev/null 2>"$WORK_DIR/create.stderr" || fail RESTORE_DATABASE_CREATE_FAILED
restore_created=1

RESTORE_DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/ksy_deals_restore"
BACKUP_FILE="/backups/${backup_name}"
RESTORE_CONFIRM=RESTORE_KSY_DEALS_DISPOSABLE
export RESTORE_DATABASE_URL BACKUP_FILE RESTORE_CONFIRM
restore_runner=''
IFS= read -r -d '' restore_runner <<'RUNNER' || true
# KSY_RESTORE_RUNNER_V3
set -eu
umask 077
: "${RESTORE_DATABASE_URL:?}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?}"
: "${BACKUP_FILE:?}"
: "${RESTORE_CONFIRM:?}"
[ "$RESTORE_CONFIRM" = RESTORE_KSY_DEALS_DISPOSABLE ] || exit 43
case "$BACKUP_FILE" in /backups/ksy-deals-*.dump.gpg) ;; *) exit 43 ;; esac
[ -f "$BACKUP_FILE" ] || exit 43
archive=$(mktemp /tmp/ksy-restore-archive.XXXXXX)
trap 'rm -f "$archive"' EXIT HUP INT TERM
if ! printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE" |
  gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
    --output "$archive" --decrypt "$BACKUP_FILE"; then exit 41; fi
if ! pg_restore --list "$archive" >/dev/null; then exit 42; fi
database_name=$(psql "$RESTORE_DATABASE_URL" --no-psqlrc --tuples-only \
  --no-align --command 'SELECT current_database()') || exit 43
[ "$database_name" = ksy_deals_restore ] || exit 43
if ! pg_restore --clean --if-exists --exit-on-error --no-owner --no-privileges \
  --dbname "$RESTORE_DATABASE_URL" "$archive"; then exit 44; fi
RUNNER

set +e
"${compose[@]}" --profile maintenance run --rm --no-deps \
  -e RESTORE_DATABASE_URL -e BACKUP_FILE -e RESTORE_CONFIRM \
  backup /bin/sh -c "$restore_runner" >/dev/null 2>"$restore_diagnostic"
restore_status=$?
set -e
if [[ "$restore_status" != 0 ]]; then
  failure=$(restore_class_for_status "$restore_status")
  : > "$restore_diagnostic"
  exit 1
fi
: > "$restore_diagnostic"
unset RESTORE_DATABASE_URL BACKUP_FILE RESTORE_CONFIRM POSTGRES_PASSWORD BACKUP_ENCRYPTION_PASSPHRASE

read_snapshot ksy_deals_restore "$restore_snapshot" || fail VERIFICATION_FAILED
cmp -s "$live_before" "$restore_snapshot" || fail VERIFICATION_FAILED
read_snapshot ksy_deals "$live_after" || fail LIVE_EVIDENCE_FAILED
cmp -s "$live_before" "$live_after" || fail LIVE_CHANGED_DURING_RESTORE
editions=$(sed -n 's/^edition_count=//p' "$live_before")
observations=$(sed -n 's/^observation_count=//p' "$live_before")

cleanup_restore || fail CLEANUP_FAILED
printf 'KSY_RESTORE_ACCEPTED file=%s bytes=%s editions=%s observations=%s fingerprints=MATCH migrations=MATCH postFormat=MATCH liveStable=PASS drop=PASS\n' \
  "$backup_name" "$backup_bytes" "$editions" "$observations"
