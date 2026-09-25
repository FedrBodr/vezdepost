#!/usr/bin/env bash
# Enable the Telegram Stories connector for the owner's organizations in
# Vezdepost production (TELEGRAM_STORIES_ORG_IDS), then recreate postiz.
#
# Idempotent. Organization IDs are not secrets; .env contents are never printed.
# Requires the deployed docker-compose.override.yaml to pass
# TELEGRAM_STORIES_ORG_IDS to the postiz container.
# Run from the operator machine:
#   scp -q -o BatchMode=yes -o ConnectTimeout=10 docs/server-scripts/26-configure-telegram-stories.sh vezdepost:/tmp/vezdepost-configure-telegram-stories.sh
#   ssh -tt -o BatchMode=yes -o ConnectTimeout=10 vezdepost \
#     'status=0; bash /tmp/vezdepost-configure-telegram-stories.sh || status=$?; rm -f /tmp/vezdepost-configure-telegram-stories.sh; exit "$status"'
# Another owner: prefix the remote command with OWNER_EMAIL=someone@example.com
set -euo pipefail

REPO_DIR=${REPO_DIR:-/root/postiz-app}
ENV_FILE="$REPO_DIR/.env"
OWNER_EMAIL=${OWNER_EMAIL:-fedrbodr@gmail.com}
PROVIDER=telegram-stories

if [[ ! "$OWNER_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$ ]]; then
  echo "Invalid owner email: $OWNER_EMAIL" >&2
  exit 2
fi
if [[ ! -d "$REPO_DIR" ]]; then
  echo "Postiz directory not found: $REPO_DIR" >&2
  exit 1
fi
cd "$REPO_DIR"

if ! docker compose config | grep -q 'TELEGRAM_STORIES_ORG_IDS'; then
  echo 'The deployed compose file does not pass TELEGRAM_STORIES_ORG_IDS yet; wait for the autodeploy' >&2
  exit 1
fi

org_ids=$(
  docker exec postiz-postgres psql -U postiz-user -d postiz-db-local -tA -c \
    "SELECT DISTINCT uo.\"organizationId\" FROM \"UserOrganization\" uo JOIN \"User\" u ON u.id = uo.\"userId\" WHERE u.email = '$OWNER_EMAIL' AND uo.disabled = false ORDER BY 1;" |
    sed '/^$/d' | paste -sd, -
)
if [[ -z "$org_ids" ]]; then
  echo "No active organizations found for $OWNER_EMAIL" >&2
  exit 1
fi

umask 077
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

temp_file=$(mktemp "$REPO_DIR/.env.telegram-stories.XXXXXX")
trap 'rm -f "$temp_file"' EXIT

ids_written=0
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    TELEGRAM_STORIES_ORG_IDS=*)
      if [[ "$ids_written" -eq 0 ]]; then
        printf 'TELEGRAM_STORIES_ORG_IDS=%s\n' "$org_ids"
        ids_written=1
      fi
      ;;
    ENABLED_SOCIAL_INTEGRATIONS=*)
      allowlist=${line#ENABLED_SOCIAL_INTEGRATIONS=}
      allowlist=${allowlist//\"/}
      # An empty allowlist already enables every provider.
      if [[ -n "$allowlist" && ",$allowlist," != *",$PROVIDER,"* ]]; then
        allowlist="$allowlist,$PROVIDER"
      fi
      printf 'ENABLED_SOCIAL_INTEGRATIONS=%s\n' "$allowlist"
      ;;
    *)
      printf '%s\n' "$line"
      ;;
  esac
done < "$ENV_FILE" > "$temp_file"

if [[ "$ids_written" -eq 0 ]]; then
  printf 'TELEGRAM_STORIES_ORG_IDS=%s\n' "$org_ids" >> "$temp_file"
fi

chmod 600 "$temp_file"
mv "$temp_file" "$ENV_FILE"
trap - EXIT

docker compose up -d --no-deps --force-recreate postiz
docker exec postiz sh -lc 'test -n "${TELEGRAM_STORIES_ORG_IDS:-}"'

echo "Telegram Stories enabled for organizations: $org_ids"
