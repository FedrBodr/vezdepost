#!/usr/bin/env bash
# Configure Pinterest Trial OAuth and deploy one exact production revision.
#
# Credentials are read from hidden prompts, stored only in the untracked .env,
# and never printed. The script holds the autodeploy lock, recreates only
# postiz, and restores configuration, revision, and image on failure.
set -euo pipefail

EXPECTED_REV=${1:-}
REPO_DIR=${REPO_DIR:-/root/postiz-app}
ENV_FILE=${ENV_FILE:-$REPO_DIR/.env}
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
[[ -f "$ENV_FILE" ]] || {
  echo 'Production .env file not found' >&2
  exit 1
}

exec 9> "$AUTODEPLOY_LOCK"
flock -n 9 || {
  echo 'Another Vezdepost deployment is already running' >&2
  exit 3
}

read_secret() {
  local prompt=$1
  local value
  if [[ -t 0 ]]; then
    IFS= read -r -s -p "$prompt" value
    printf '\n' >&2
  else
    IFS= read -r value
  fi
  [[ -n "$value" ]] || return 1
  [[ "$value" != *$'\r'* && "$value" != *$'\n'* ]] || return 1
  printf '%s' "$value"
}

PINTEREST_CLIENT_ID_VALUE=$(read_secret 'Pinterest App ID: ') || {
  echo 'Pinterest App ID is required' >&2
  exit 2
}
PINTEREST_CLIENT_SECRET_VALUE=$(read_secret 'Pinterest App secret: ') || {
  echo 'Pinterest App secret is required' >&2
  exit 2
}

cd "$REPO_DIR"
CURRENT_REV=$(git rev-parse HEAD)
[[ "$CURRENT_REV" =~ ^[0-9a-f]{40}$ ]] || {
  echo 'Unable to validate the current server revision' >&2
  exit 1
}

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
ENV_BACKUP="$ENV_FILE.backup-$TIMESTAMP"
BACKUP_IMAGE="postiz-max:pinterest-trial-backup-$TIMESTAMP"
ENV_TEMP=''
MUTATION_STARTED=0
BACKUP_IMAGE_CREATED=0

rollback_on_failure() {
  local status=$?
  trap - EXIT
  [[ -z "$ENV_TEMP" ]] || rm -f "$ENV_TEMP"
  if [[ "$status" -ne 0 && "$MUTATION_STARTED" -eq 1 ]]; then
    echo 'Pinterest deployment verification failed; restoring previous configuration, revision, and image' >&2
    cp -p "$ENV_BACKUP" "$ENV_FILE" >/dev/null 2>&1 || true
    chmod 600 "$ENV_FILE" >/dev/null 2>&1 || true
    git reset --hard "$CURRENT_REV" >/dev/null 2>&1 || true
    if [[ "$BACKUP_IMAGE_CREATED" -eq 1 ]]; then
      docker tag "$BACKUP_IMAGE" "$POSTIZ_IMAGE" >/dev/null 2>&1 || true
    fi
    docker compose up -d --no-deps --force-recreate postiz >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap rollback_on_failure EXIT

cp -p "$ENV_FILE" "$ENV_BACKUP"
chmod 600 "$ENV_BACKUP"
ENV_TEMP=$(mktemp "$ENV_FILE.tmp.XXXXXX")
awk '!/^(PINTEREST_CLIENT_ID|PINTEREST_CLIENT_SECRET)=/' \
  "$ENV_FILE" > "$ENV_TEMP"
printf 'PINTEREST_CLIENT_ID=%s\n' "$PINTEREST_CLIENT_ID_VALUE" >> "$ENV_TEMP"
printf 'PINTEREST_CLIENT_SECRET=%s\n' "$PINTEREST_CLIENT_SECRET_VALUE" >> "$ENV_TEMP"
chmod 600 "$ENV_TEMP"
mv -f "$ENV_TEMP" "$ENV_FILE"
ENV_TEMP=''
unset PINTEREST_CLIENT_ID_VALUE PINTEREST_CLIENT_SECRET_VALUE
MUTATION_STARTED=1

docker tag "$POSTIZ_IMAGE" "$BACKUP_IMAGE"
BACKUP_IMAGE_CREATED=1

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

git reset --hard "$EXPECTED_REV"
docker compose config -q
docker compose build postiz
docker compose up -d --no-deps --force-recreate postiz

ENV_READY_ATTEMPTS=60
[[ "${SKIP_DEPLOY_WAIT:-0}" == 1 ]] && ENV_READY_ATTEMPTS=1
ENV_READY=0
for _ in $(seq 1 "$ENV_READY_ATTEMPTS"); do
  if docker exec "$POSTIZ_CONTAINER" sh -lc \
    'test -n "${PINTEREST_CLIENT_ID:-}" && test -n "${PINTEREST_CLIENT_SECRET:-}"'; then
    ENV_READY=1
    break
  fi
  [[ "${SKIP_DEPLOY_WAIT:-0}" == 1 ]] || sleep 2
done
[[ "$ENV_READY" -eq 1 ]] || {
  echo 'Pinterest environment variables were not present after container startup' >&2
  exit 1
}

READINESS_ATTEMPTS=180
[[ "${SKIP_DEPLOY_WAIT:-0}" == 1 ]] && READINESS_ATTEMPTS=1
READY=0
HTTP_CODE='unknown'
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
  echo "postiz readiness checks did not pass before timeout; public API HTTP: $HTTP_CODE" >&2
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
echo 'Pinterest trial deployment completed'
echo "Configuration backup: $ENV_BACKUP"
echo "Application backup image: $BACKUP_IMAGE"
echo 'Pinterest credentials: set'
echo "mastra_ai_spans attributes: active=$MASTRA_ACTIVE dropped=$MASTRA_DROPPED max=$MASTRA_MAX"
