#!/usr/bin/env bash
# Backfill confirmed publication timestamps for trusted legacy posts.
#
# Idempotent: reruns only consider rows whose publishedAt is still NULL.
# Database credentials stay inside the existing PostgreSQL container.
set -euo pipefail

POSTGRES_CONTAINER=${POSTGRES_CONTAINER:-postiz-postgres}

echo "Trusted legacy publication rows before backfill:"
docker exec -i "$POSTGRES_CONTAINER" sh -c \
  'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT COUNT(*) AS rows_without_published_at
FROM "Post"
WHERE "publishedAt" IS NULL
  AND state = 'PUBLISHED'
  AND "releaseId" IS NOT NULL
  AND BTRIM("releaseId") <> ''
  AND "releaseId" <> 'undefined'
  AND COALESCE("releaseURL", '') NOT LIKE '%undefined%';
SQL

echo "Applying publishedAt backfill:"
docker exec -i "$POSTGRES_CONTAINER" sh -c \
  'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
UPDATE "Post"
SET "publishedAt" = "updatedAt"
WHERE "publishedAt" IS NULL
  AND state = 'PUBLISHED'
  AND "releaseId" IS NOT NULL
  AND BTRIM("releaseId") <> ''
  AND "releaseId" <> 'undefined'
  AND COALESCE("releaseURL", '') NOT LIKE '%undefined%';
SQL

echo "Trusted legacy publication rows after backfill:"
docker exec -i "$POSTGRES_CONTAINER" sh -c \
  'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT COUNT(*) AS rows_without_published_at
FROM "Post"
WHERE "publishedAt" IS NULL
  AND state = 'PUBLISHED'
  AND "releaseId" IS NOT NULL
  AND BTRIM("releaseId") <> ''
  AND "releaseId" <> 'undefined'
  AND COALESCE("releaseURL", '') NOT LIKE '%undefined%';
SQL
