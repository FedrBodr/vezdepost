#!/usr/bin/env bash
# Deploy the Tumblr multipart fix at one exact production revision.
#
# The script holds the existing autodeploy lock, preserves the current postiz
# image, recreates only the postiz service, and rolls back checkout and image
# state if a post-mutation verification fails.
set -euo pipefail

EXPECTED_REV=${1:-}
REPO_DIR=${REPO_DIR:-/root/postiz-app}
DEPLOYED_REV_FILE=${DEPLOYED_REV_FILE:-/var/lib/vezdepost-deployed-rev}
AUTODEPLOY_LOCK=${AUTODEPLOY_LOCK:-/var/lock/vezdepost-autodeploy.lock}
POSTIZ_IMAGE=${POSTIZ_IMAGE:-postiz-max:local}
POSTIZ_CONTAINER=${POSTIZ_CONTAINER:-postiz}
POSTGRES_CONTAINER=${POSTGRES_CONTAINER:-postiz-postgres}
POSTGRES_USER=${POSTGRES_USER:-postiz-user}
POSTGRES_DB=${POSTGRES_DB:-postiz-db-local}

[[ "$EXPECTED_REV" =~ ^[0-9a-f]{40}$ ]] || {
  echo 'Expected one lowercase 40-character production commit SHA' >&2
  exit 2
}

[[ -d "$REPO_DIR" ]] || {
  echo "Postiz directory not found: $REPO_DIR" >&2
  exit 1
}

exec 9> "$AUTODEPLOY_LOCK"
flock -n 9 || {
  echo 'Another Vezdepost deployment is already running' >&2
  exit 3
}

cd "$REPO_DIR"
CURRENT_REV=$(git rev-parse HEAD)
[[ "$CURRENT_REV" =~ ^[0-9a-f]{40}$ ]] || {
  echo 'Unable to validate the current server revision' >&2
  exit 1
}

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_IMAGE="postiz-max:tumblr-multipart-backup-$TIMESTAMP"
MUTATION_STARTED=0
BACKUP_CREATED=0

rollback_on_failure() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 && "$MUTATION_STARTED" -eq 1 ]]; then
    echo 'Deployment verification failed; restoring previous postiz revision and image' >&2
    git reset --hard "$CURRENT_REV" >/dev/null 2>&1 || true
    if [[ "$BACKUP_CREATED" -eq 1 ]]; then
      docker tag "$BACKUP_IMAGE" "$POSTIZ_IMAGE" >/dev/null 2>&1 || true
    fi
    docker compose up -d --no-deps --force-recreate postiz >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap rollback_on_failure EXIT

docker tag "$POSTIZ_IMAGE" "$BACKUP_IMAGE"
BACKUP_CREATED=1

FETCH_ATTEMPTS=60
[[ "${SKIP_DEPLOY_WAIT:-0}" == 1 ]] && FETCH_ATTEMPTS=1
REVISION_AVAILABLE=0
for _ in $(seq 1 "$FETCH_ATTEMPTS"); do
  git fetch --no-recurse-submodules origin prod
  REMOTE_REV=$(git rev-parse refs/remotes/origin/prod)
  if [[ "$REMOTE_REV" == "$EXPECTED_REV" ]]; then
    REVISION_AVAILABLE=1
    break
  fi
  [[ "${SKIP_DEPLOY_WAIT:-0}" == 1 ]] || sleep 2
done

[[ "$REVISION_AVAILABLE" -eq 1 ]] || {
  echo 'Expected production revision did not appear before timeout' >&2
  exit 4
}

MUTATION_STARTED=1
git reset --hard "$EXPECTED_REV"
docker compose build postiz
docker compose up -d --no-deps --force-recreate postiz

docker exec "$POSTIZ_CONTAINER" sh -lc \
  'test -n "${TUMBLR_CLIENT_ID:-}" && test -n "${TUMBLR_CLIENT_SECRET:-}"'

READINESS_ATTEMPTS=60
[[ "${SKIP_DEPLOY_WAIT:-0}" == 1 ]] && READINESS_ATTEMPTS=1
READY=0
for _ in $(seq 1 "$READINESS_ATTEMPTS"); do
  HTTP_CODE=$(curl -sS -o /dev/null -w '%{http_code}' \
    https://app.vezdepost.ru/api/user/self || true)
  if docker exec "$POSTIZ_CONTAINER" sh -c \
       '(ss -ltn 2>/dev/null || netstat -ltn) | grep -q :3000' &&
     docker exec "$POSTIZ_CONTAINER" sh -c \
       '(ss -ltn 2>/dev/null || netstat -ltn) | grep -q :4200' &&
     docker exec "$POSTIZ_CONTAINER" sh -c \
       '(ss -ltn 2>/dev/null || netstat -ltn) | grep -q :5000' &&
     [[ -n "$HTTP_CODE" && "$HTTP_CODE" != 000 && "$HTTP_CODE" != 502 ]]; then
    READY=1
    break
  fi
  [[ "${SKIP_DEPLOY_WAIT:-0}" == 1 ]] || sleep 2
done

[[ "$READY" -eq 1 ]] || {
  echo 'postiz readiness checks did not pass before timeout' >&2
  exit 1
}

docker exec temporal-admin-tools temporal task-queue describe \
  --task-queue main --task-queue-type workflow --address temporal:7233 |
  grep -Eq 'Identity|@'

MASTRA_STATS=$(docker exec "$POSTGRES_CONTAINER" \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc \
  "select count(*) filter (where not attisdropped), count(*) filter (where attisdropped), coalesce(max(attnum), 0) from pg_attribute where attrelid='public.mastra_ai_spans'::regclass and attnum > 0;")
IFS='|' read -r MASTRA_ACTIVE MASTRA_DROPPED MASTRA_MAX <<< "$MASTRA_STATS"

for VALUE in "$MASTRA_ACTIVE" "$MASTRA_DROPPED" "$MASTRA_MAX"; do
  [[ "$VALUE" =~ ^[0-9]+$ ]] || {
    echo 'Unable to validate mastra_ai_spans attribute counts' >&2
    exit 1
  }
done
[[ "$MASTRA_MAX" -lt 1600 ]] || {
  echo 'mastra_ai_spans is at the PostgreSQL attribute limit' >&2
  exit 1
}

printf '%s\n' "$EXPECTED_REV" > "$DEPLOYED_REV_FILE"
trap - EXIT
echo "Tumblr multipart deployment completed; backup image: $BACKUP_IMAGE"
echo "mastra_ai_spans attributes: active=$MASTRA_ACTIVE dropped=$MASTRA_DROPPED max=$MASTRA_MAX"
