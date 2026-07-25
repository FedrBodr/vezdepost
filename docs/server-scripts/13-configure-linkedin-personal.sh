#!/usr/bin/env bash
set -euo pipefail

REPO_DIR=${REPO_DIR:-/root/postiz-app}
cd "$REPO_DIR"

for name in LINKEDIN_CLIENT_ID LINKEDIN_CLIENT_SECRET; do
  if ! grep -Eq "^${name}=.+" .env; then
    echo "Missing non-empty ${name} in $REPO_DIR/.env" >&2
    exit 1
  fi
done

docker compose config >/dev/null
docker compose up -d --no-deps --force-recreate postiz

for name in LINKEDIN_CLIENT_ID LINKEDIN_CLIENT_SECRET; do
  if ! docker exec postiz sh -lc "test -n \"\${${name}:-}\""; then
    echo "${name} is missing in the running container" >&2
    exit 1
  fi
done

echo 'LinkedIn personal OAuth credentials are present in the postiz container'
