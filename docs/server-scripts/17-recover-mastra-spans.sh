#!/usr/bin/env bash
# Recover an empty Mastra spans table that exhausted PostgreSQL attribute slots.
#
# The original table is preserved in a timestamped schema and as a SQL dump.
# Only the PM2 backend process is stopped and started; containers are untouched.
set -euo pipefail

REPO_DIR=${REPO_DIR:-/root/postiz-app}
BACKUP_DIR="$REPO_DIR/backups"
POSTGRES_CONTAINER=${POSTGRES_CONTAINER:-postiz-postgres}
POSTIZ_CONTAINER=${POSTIZ_CONTAINER:-postiz}
DB_USER=${DB_USER:-postiz-user}
DB_NAME=${DB_NAME:-postiz-db-local}

[[ -d "$REPO_DIR" ]] || {
  echo "Postiz directory not found: $REPO_DIR" >&2
  exit 1
}

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_schema="vezdepost_recovery_$timestamp"
dump_file="$BACKUP_DIR/mastra_ai_spans-before-recovery-$timestamp.sql"
[[ "$backup_schema" =~ ^[A-Za-z0-9_]+$ ]]

stats=$(docker exec "$POSTGRES_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atqc \
  "select (select count(*) from public.mastra_ai_spans), max(attnum), count(*) filter (where attisdropped) from pg_attribute where attrelid='public.mastra_ai_spans'::regclass and attnum > 0;")
IFS='|' read -r row_count max_attnum dropped_count <<< "$stats"

for value in "$row_count" "$max_attnum" "$dropped_count"; do
  [[ "$value" =~ ^[0-9]+$ ]] || {
    echo 'Unable to validate mastra_ai_spans state' >&2
    exit 1
  }
done
[[ "$row_count" -eq 0 ]] || {
  echo 'Refusing recovery because mastra_ai_spans is not empty' >&2
  exit 2
}
[[ "$max_attnum" -ge 1600 && "$dropped_count" -gt 0 ]] || {
  echo 'Refusing recovery because PostgreSQL attribute exhaustion was not confirmed' >&2
  exit 2
}

umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
docker exec "$POSTGRES_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" \
  --table=public.mastra_ai_spans --no-owner --no-privileges > "$dump_file"
chmod 600 "$dump_file"
[[ -s "$dump_file" ]] || {
  echo 'Mastra spans SQL backup was not created' >&2
  exit 1
}

backend_stopped=0
restart_backend_on_failure() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 && "$backend_stopped" -eq 1 ]]; then
    docker exec "$POSTIZ_CONTAINER" pm2 start backend >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap restart_backend_on_failure EXIT

docker exec "$POSTIZ_CONTAINER" pm2 stop backend
backend_stopped=1

row_count_after_stop=$(docker exec "$POSTGRES_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atqc \
  'select count(*) from public.mastra_ai_spans;')
[[ "$row_count_after_stop" == 0 ]] || {
  echo 'Refusing recovery because mastra_ai_spans changed before the schema move' >&2
  exit 2
}

docker exec "$POSTGRES_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -qc \
  "begin; create schema \"$backup_schema\" authorization \"$DB_USER\"; alter table public.mastra_ai_spans set schema \"$backup_schema\"; commit;"

docker exec "$POSTIZ_CONTAINER" pm2 start backend
backend_stopped=0

ready=0
attempts=60
[[ "${SKIP_RECOVERY_WAIT:-0}" == 1 ]] && attempts=1
for _ in $(seq 1 "$attempts"); do
  backend_pid=$(docker exec "$POSTIZ_CONTAINER" pm2 pid backend 2>/dev/null | tr -d '[:space:]')
  public_table=$(docker exec "$POSTGRES_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atqc \
    "select coalesce(to_regclass('public.mastra_ai_spans')::text, '');")
  http_code=$(curl -sS -o /dev/null -w '%{http_code}' https://app.vezdepost.ru/api/user/self || true)

  if [[ "$backend_pid" =~ ^[1-9][0-9]*$ ]] &&
     [[ "$public_table" == mastra_ai_spans ]] &&
     docker exec "$POSTIZ_CONTAINER" sh -c \
       '(ss -ltn 2>/dev/null || netstat -ltn) | grep -q :3000' &&
     [[ "$http_code" != 502 && "$http_code" != 000 && -n "$http_code" ]]; then
    ready=1
    break
  fi
  [[ "${SKIP_RECOVERY_WAIT:-0}" == 1 ]] || sleep 2
done

[[ "$ready" -eq 1 ]] || {
  echo 'Backend readiness failed after preserving the exhausted table' >&2
  exit 1
}

backup_table=$(docker exec "$POSTGRES_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atqc \
  "select coalesce(to_regclass('$backup_schema.mastra_ai_spans')::text, '');")
[[ -n "$backup_table" ]] || {
  echo 'Backup schema verification failed' >&2
  exit 1
}

trap - EXIT
echo "Mastra spans recovery completed; backup schema: $backup_schema; SQL dump: $(basename "$dump_file")"
