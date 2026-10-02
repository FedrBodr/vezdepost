#!/usr/bin/env bash
# Store the Telegram assistant bot token (@vezde_post_bot) for Vezdepost
# production as TELEGRAM_ASSISTANT_TOKEN in .env.
#
# Idempotent. The token is read without echo, never printed and never passed
# on a command line. It is verified with getMe when Telegram is reachable.
# The app picks it up on the next deploy that passes the variable through
# docker-compose.override.yaml.
# Run from the operator machine:
#   scp -q -o BatchMode=yes -o ConnectTimeout=10 docs/server-scripts/27-configure-telegram-assistant.sh vezdepost:/tmp/vezdepost-configure-telegram-assistant.sh
#   ssh -tt -o BatchMode=yes -o ConnectTimeout=10 vezdepost \
#     'status=0; bash /tmp/vezdepost-configure-telegram-assistant.sh || status=$?; rm -f /tmp/vezdepost-configure-telegram-assistant.sh; exit "$status"'
set -euo pipefail

REPO_DIR=${REPO_DIR:-/root/postiz-app}
ENV_FILE="$REPO_DIR/.env"
token=${TELEGRAM_ASSISTANT_TOKEN:-}

if [[ -z "$token" ]]; then
  printf 'Telegram bot token from @BotFather: ' > /dev/tty
  if ! IFS= read -r -s token < /dev/tty; then
    printf '\nUnable to read the token\n' > /dev/tty
    exit 1
  fi
  printf '\n' > /dev/tty
fi

if [[ ! "$token" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]]; then
  echo 'Invalid Telegram bot token format; expected <digits>:<secret>' >&2
  exit 2
fi
if [[ ! -d "$REPO_DIR" ]]; then
  echo "Postiz directory not found: $REPO_DIR" >&2
  exit 1
fi

# The URL with the token goes to curl through stdin, not argv.
response=$(
  printf 'url = "https://api.telegram.org/bot%s/getMe"\n' "$token" |
    curl -sS --max-time 15 --config - 2>/dev/null || true
)
if [[ "$response" == *'"ok":true'* ]]; then
  username=$(printf '%s' "$response" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')
  verified="Telegram verified the token for @${username:-unknown}"
elif [[ "$response" == *'"ok":false'* ]]; then
  echo 'Telegram rejected the token; nothing was changed' >&2
  exit 3
else
  verified='Telegram is unreachable from this server; the token is stored but not verified'
fi

umask 077
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

temp_file=$(mktemp "$REPO_DIR/.env.telegram-assistant.XXXXXX")
trap 'rm -f "$temp_file"' EXIT

written=0
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    TELEGRAM_ASSISTANT_TOKEN=*)
      if [[ "$written" -eq 0 ]]; then
        printf 'TELEGRAM_ASSISTANT_TOKEN=%s\n' "$token"
        written=1
      fi
      ;;
    *)
      printf '%s\n' "$line"
      ;;
  esac
done < "$ENV_FILE" > "$temp_file"

if [[ "$written" -eq 0 ]]; then
  printf 'TELEGRAM_ASSISTANT_TOKEN=%s\n' "$token" >> "$temp_file"
fi

chmod 600 "$temp_file"
mv "$temp_file" "$ENV_FILE"
trap - EXIT
unset token TELEGRAM_ASSISTANT_TOKEN response

echo "$verified"
echo 'Telegram assistant token stored in .env'
