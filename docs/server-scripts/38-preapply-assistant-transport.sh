#!/usr/bin/env bash
# Pre-apply docs/server-scripts/36-preapply-assistant-transport.sql before
# deploying the assistant transports build (TelegramAssistantLink.transport +
# composite unique index). Startup `prisma db push` runs without
# --accept-data-loss, so a unique index it must create would stop the app.
#
# 1. Dumps the prod DB into a throwaway copy and applies the SQL there.
# 2. Verifies the column and index on the copy, drops the copy.
# 3. Applies the same SQL to prod (idempotent) and verifies again.
# Containers and PM2 are untouched; the SQL is additive, no rows change.
# Run from the operator machine:
#   scp -q -o BatchMode=yes docs/server-scripts/36-preapply-assistant-transport.sql vezdepost:/tmp/vezdepost-36.sql
#   scp -q -o BatchMode=yes docs/server-scripts/38-preapply-assistant-transport.sh vezdepost:/tmp/vezdepost-38.sh
#   ssh -o BatchMode=yes vezdepost 'status=0; bash /tmp/vezdepost-38.sh /tmp/vezdepost-36.sql || status=$?; rm -f /tmp/vezdepost-38.sh /tmp/vezdepost-36.sql; exit "$status"'
set -euo pipefail

SQL_FILE=${1:?usage: $0 <path to 36-preapply-assistant-transport.sql>}
POSTGRES_CONTAINER=${POSTGRES_CONTAINER:-postiz-postgres}
DB_USER=${DB_USER:-postiz-user}
DB_NAME=${DB_NAME:-postiz-db-local}
COPY_DB="vezdepost_pushtest"

[[ -s "$SQL_FILE" ]] || { echo "SQL file not found: $SQL_FILE" >&2; exit 1; }

psql_db() {
  local db=$1
  shift
  docker exec -i "$POSTGRES_CONTAINER" psql -q -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$db" "$@"
}

verify() {
  local db=$1
  local result
  result=$(psql_db "$db" -At <<'SQL'
select
  (select count(*) from information_schema.columns
     where table_name='TelegramAssistantLink' and column_name='transport'),
  (select count(*) from pg_indexes
     where tablename='TelegramAssistantLink'
       and indexname='TelegramAssistantLink_transport_telegramUserId_key'),
  (select count(*) from pg_indexes
     where tablename='TelegramAssistantLink'
       and indexname='TelegramAssistantLink_telegramUserId_key'),
  (select count(*) from "TelegramAssistantLink");
SQL
)
  [[ "$result" == 1\|1\|0\|* ]] || {
    echo "verification failed on $db: $result" >&2
    return 1
  }
  echo "$db ok: transport column, composite index present, old index gone, rows=${result##*|}"
}

echo "--- dry run on copy $COPY_DB"
psql_db postgres <<SQL
DROP DATABASE IF EXISTS "$COPY_DB";
CREATE DATABASE "$COPY_DB";
SQL
docker exec "$POSTGRES_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner \
  | psql_db "$COPY_DB" >/dev/null
psql_db "$COPY_DB" < "$SQL_FILE"
verify "$COPY_DB"
psql_db postgres -c "DROP DATABASE \"$COPY_DB\";"

echo "--- applying to $DB_NAME"
psql_db "$DB_NAME" < "$SQL_FILE"
verify "$DB_NAME"
echo 'pre-apply finished'
