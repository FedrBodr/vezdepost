#!/usr/bin/env bash
# Store the OAuth app credentials of one social provider in the production
# .env and recreate postiz so the container sees them.
#
# Usage: 39-configure-social-app.sh <provider>
#   facebook (also serves Instagram via Facebook), instagram-standalone,
#   threads, reddit, twitch, discord, slack, mastodon
#
# Idempotent. Values are read without echo, never printed and never passed on
# a command line. The provider stays request-only until it is added to
# ENABLED_SOCIAL_INTEGRATIONS in docker-compose.override.yaml after an
# end-to-end connection check.
# Run from the operator machine:
#   scp -q -o BatchMode=yes -o ConnectTimeout=10 docs/server-scripts/39-configure-social-app.sh vezdepost:/tmp/vezdepost-configure-social-app.sh
#   ssh -tt -o BatchMode=yes -o ConnectTimeout=10 vezdepost \
#     'status=0; bash /tmp/vezdepost-configure-social-app.sh discord || status=$?; rm -f /tmp/vezdepost-configure-social-app.sh; exit "$status"'
set -euo pipefail

REPO_DIR=${REPO_DIR:-/root/postiz-app}
ENV_FILE="$REPO_DIR/.env"
AUTODEPLOY_LOCK=${AUTODEPLOY_LOCK:-/var/lock/vezdepost-autodeploy.lock}

case "${1:-}" in
  facebook) vars=(FACEBOOK_APP_ID FACEBOOK_APP_SECRET) ;;
  instagram-standalone) vars=(INSTAGRAM_APP_ID INSTAGRAM_APP_SECRET) ;;
  threads) vars=(THREADS_APP_ID THREADS_APP_SECRET) ;;
  reddit) vars=(REDDIT_CLIENT_ID REDDIT_CLIENT_SECRET) ;;
  twitch) vars=(TWITCH_CLIENT_ID TWITCH_CLIENT_SECRET) ;;
  discord) vars=(DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET DISCORD_BOT_TOKEN_ID) ;;
  slack) vars=(SLACK_ID SLACK_SECRET) ;;
  mastodon) vars=(MASTODON_CLIENT_ID MASTODON_CLIENT_SECRET) ;;
  *)
    echo 'Usage: 39-configure-social-app.sh facebook|instagram-standalone|threads|reddit|twitch|discord|slack|mastodon' >&2
    exit 2
    ;;
esac

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

declare -A values
for var in "${vars[@]}"; do
  printf '%s: ' "$var" > /dev/tty
  if ! IFS= read -r -s value < /dev/tty; then
    printf '\nUnable to read %s\n' "$var" > /dev/tty
    exit 1
  fi
  printf '\n' > /dev/tty
  if [[ -z "$value" || "$value" == *[[:space:]\'\"\$\`]* ]]; then
    echo "$var is empty or contains whitespace/quotes; nothing was changed" >&2
    exit 2
  fi
  values[$var]=$value
done

umask 077
cp -p "$ENV_FILE" "$ENV_FILE.bak-social-app"
temp_file=$(mktemp "$REPO_DIR/.env.social-app.XXXXXX")
trap 'rm -f "$temp_file"' EXIT

pattern="^($(IFS='|'; echo "${vars[*]}"))="
grep -Ev "$pattern" "$ENV_FILE" > "$temp_file" || true
for var in "${vars[@]}"; do
  printf '%s=%s\n' "$var" "${values[$var]}" >> "$temp_file"
done

chmod 600 "$temp_file"
mv "$temp_file" "$ENV_FILE"
trap - EXIT
unset values value

cd "$REPO_DIR"
docker compose config -q
docker compose up -d --no-deps --force-recreate postiz >/dev/null

for var in "${vars[@]}"; do
  if docker exec postiz sh -c "test -n \"\$$var\""; then
    echo "$var is set in the postiz container"
  else
    echo "$var is EMPTY in the postiz container (is it passed in docker-compose.override.yaml?)" >&2
    exit 4
  fi
done
echo "Credentials for $1 stored; previous .env kept as .env.bak-social-app"
