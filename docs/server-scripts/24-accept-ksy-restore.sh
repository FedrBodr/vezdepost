#!/usr/bin/env bash
# Restore the newest encrypted KSY backup into one fixed disposable database.
set -euo pipefail
umask 077

KSY_ROOT=${KSY_ROOT:-/opt/ksy-deals}
ENV_FILE="$KSY_ROOT/.env"
COMPOSE_FILE="$KSY_ROOT/docker-compose.yml"
TEST_MODE=${KSY_RESTORE_TEST_MODE:-0}
restore_created=0

fail() { printf 'KSY_RESTORE_ACCEPT_FAILED %s\n' "$1" >&2; exit 1; }
file_mode() { stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"; }
mtime() { stat -f '%m' "$1" 2>/dev/null || stat -c '%Y' "$1"; }
fingerprint() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
  else LC_ALL=C shasum -a 256 | awk '{print $1}'; fi
}

cleanup_restore() {
  [[ "$restore_created" == 1 ]] || return 0
  "${compose[@]}" exec -T db psql --username "$POSTGRES_USER" --dbname postgres \
    --no-psqlrc --set ON_ERROR_STOP=1 --command 'DROP DATABASE ksy_deals_restore WITH (FORCE)' >/dev/null || return 1
  restore_created=0
}
on_exit() {
  local status=$?
  trap - EXIT
  if ! cleanup_restore; then
    printf 'KSY_RESTORE_ACCEPT_FAILED CLEANUP_FAILED\n' >&2
    status=1
  fi
  exit "$status"
}
trap on_exit EXIT

[[ "$TEST_MODE" == 1 || $EUID -eq 0 ]] || fail ROOT_REQUIRED
[[ -f "$ENV_FILE" && -f "$COMPOSE_FILE" ]] || fail KSY_INSTALLATION_MISSING
[[ "$(file_mode "$ENV_FILE")" == 600 ]] || fail KSY_ENV_MODE_INVALID
if [[ "$TEST_MODE" != 1 ]]; then
  [[ "$(stat -c '%U:%G' "$ENV_FILE")" == root:root ]] || fail KSY_ENV_OWNER_INVALID
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
[[ "${POSTGRES_DB:-}" == ksy_deals && "${POSTGRES_USER:-}" == ksy_deals ]] || fail POSTGRES_IDENTITY_INVALID
[[ "${POSTGRES_PASSWORD:-}" =~ ^[a-f0-9]{64}$ ]] || fail POSTGRES_PASSWORD_INVALID
[[ "${BACKUP_ENCRYPTION_PASSPHRASE:-}" =~ ^[a-f0-9]{64}$ ]] || fail BACKUP_PASSPHRASE_INVALID
[[ "${KSY_DEALS_BACKUP_DIR:-}" == /* && -d "$KSY_DEALS_BACKUP_DIR" ]] || fail BACKUP_DIR_INVALID
[[ "${KSY_DEALS_IMAGE:-}" =~ ^ghcr\.io/fedrbodr/ksy-deals@sha256:[a-f0-9]{64}$ ]] || fail KSY_DEALS_IMAGE_INVALID

shopt -s nullglob
candidates=("$KSY_DEALS_BACKUP_DIR"/ksy-deals-*.dump.gpg)
shopt -u nullglob
[[ ${#candidates[@]} -gt 0 ]] || fail BACKUP_MISSING
newest=''
newest_mtime=-1
newest_ties=0
for candidate in "${candidates[@]}"; do
  [[ -f "$candidate" && ! -L "$candidate" && -s "$candidate" ]] || fail BACKUP_INVALID
  basename "$candidate" | grep -Eq '^ksy-deals-[0-9]{8}T[0-9]{6}Z\.dump\.gpg$' || fail BACKUP_NAME_INVALID
  candidate_mtime=$(mtime "$candidate")
  [[ "$candidate_mtime" =~ ^[0-9]+$ ]] || fail BACKUP_MTIME_INVALID
  if (( candidate_mtime > newest_mtime )); then
    newest=$candidate
    newest_mtime=$candidate_mtime
    newest_ties=1
  elif (( candidate_mtime == newest_mtime )); then
    newest_ties=$((newest_ties + 1))
  fi
done
[[ "$newest_ties" == 1 ]] || fail BACKUP_NEWEST_AMBIGUOUS
backup_name=$(basename "$newest")
backup_bytes=$(wc -c < "$newest" | tr -d ' ')

compose=(docker compose --project-name ksy-deals --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
existing=$("${compose[@]}" exec -T db psql --username "$POSTGRES_USER" --dbname postgres \
  --no-psqlrc --tuples-only --no-align --command "SELECT 1 FROM pg_database WHERE datname='ksy_deals_restore'") || fail RESTORE_DATABASE_PREFLIGHT_FAILED
[[ -z "$existing" ]] || fail RESTORE_DATABASE_ALREADY_EXISTS
"${compose[@]}" exec -T db psql --username "$POSTGRES_USER" --dbname postgres \
  --no-psqlrc --set ON_ERROR_STOP=1 --command 'CREATE DATABASE ksy_deals_restore' >/dev/null || fail RESTORE_DATABASE_CREATE_FAILED
restore_created=1

RESTORE_DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/ksy_deals_restore"
BACKUP_FILE="/backups/${backup_name}"
RESTORE_CONFIRM=RESTORE_KSY_DEALS_DISPOSABLE
export RESTORE_DATABASE_URL BACKUP_FILE RESTORE_CONFIRM
if ! "${compose[@]}" --profile maintenance run --rm --no-deps \
  -e RESTORE_DATABASE_URL -e BACKUP_FILE -e RESTORE_CONFIRM \
  backup /bin/sh infra/scripts/restore.sh >/dev/null 2>&1; then
  fail RESTORE_FAILED
fi
unset RESTORE_DATABASE_URL BACKUP_FILE RESTORE_CONFIRM POSTGRES_PASSWORD BACKUP_ENCRYPTION_PASSPHRASE

read_ids() {
  local database=$1
  "${compose[@]}" exec -T db psql --username "$POSTGRES_USER" --dbname "$database" \
    --no-psqlrc --tuples-only --no-align \
    --command "SELECT o.id FROM price_observations o JOIN game_editions e ON e.id=o.edition_id WHERE o.source_status='CONFIRMED' ORDER BY o.id"
}
read_counts() {
  local database=$1
  "${compose[@]}" exec -T db psql --username "$POSTGRES_USER" --dbname "$database" \
    --no-psqlrc --tuples-only --no-align \
    --command "SELECT (SELECT COUNT(*) FROM game_editions),(SELECT COUNT(*) FROM price_observations)"
}
live_counts=$(read_counts ksy_deals) || fail LIVE_EVIDENCE_FAILED
restore_counts=$(read_counts ksy_deals_restore) || fail RESTORE_EVIDENCE_FAILED
[[ "$live_counts" == '2|2' && "$restore_counts" == '2|2' ]] || fail RESTORE_COUNTS_UNEXPECTED
live_ids=$(read_ids ksy_deals) || fail LIVE_IDENTITIES_FAILED
restore_ids=$(read_ids ksy_deals_restore) || fail RESTORE_IDENTITIES_FAILED
[[ "$(printf '%s\n' "$live_ids" | sed '/^$/d' | wc -l | tr -d ' ')" == 2 &&
  "$(printf '%s\n' "$restore_ids" | sed '/^$/d' | wc -l | tr -d ' ')" == 2 ]] || fail RESTORE_IDENTITIES_COUNT_UNEXPECTED
live_fingerprint=$(printf '%s' "$live_ids" | fingerprint)
restore_fingerprint=$(printf '%s' "$restore_ids" | fingerprint)
[[ "$live_fingerprint" == "$restore_fingerprint" ]] || fail RESTORE_IDENTITIES_MISMATCH

cleanup_restore || fail CLEANUP_FAILED
printf 'KSY_RESTORE_ACCEPTED file=%s bytes=%s editions=2 observations=2 identities=MATCH drop=PASS\n' \
  "$backup_name" "$backup_bytes"
