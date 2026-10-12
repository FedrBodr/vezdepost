#!/usr/bin/env bash
# Store the MAX assistant bot token for Vezdepost production as
# MAX_ASSISTANT_TOKEN in .env. This is a SEPARATE bot from MAX_TOKEN: the
# channel provider already consumes getUpdates on the main bot, and two
# consumers would steal each other's updates.
#
# Idempotent. The token is read without echo, never printed and never passed
# on a command line. It is verified with GET /me when MAX is reachable.
# The app picks it up on the next deploy that passes the variable through
# docker-compose.override.yaml.
# Run from the operator machine:
#   scp -q -o BatchMode=yes -o ConnectTimeout=10 docs/server-scripts/37-configure-max-assistant.sh vezdepost:/tmp/vezdepost-configure-max-assistant.sh
#   ssh -tt -o BatchMode=yes -o ConnectTimeout=10 vezdepost \
#     'status=0; bash /tmp/vezdepost-configure-max-assistant.sh || status=$?; rm -f /tmp/vezdepost-configure-max-assistant.sh; exit "$status"'
set -euo pipefail

REPO_DIR=${REPO_DIR:-/root/postiz-app}
ENV_FILE="$REPO_DIR/.env"
token=${MAX_ASSISTANT_TOKEN:-}

if [[ -z "$token" ]]; then
  printf 'MAX assistant bot token (from @MasterBot): ' > /dev/tty
  if ! IFS= read -r -s token < /dev/tty; then
    printf '\nUnable to read the token\n' > /dev/tty
    exit 1
  fi
  printf '\n' > /dev/tty
fi

if [[ ! "$token" =~ ^[A-Za-z0-9_.-]{20,}$ ]]; then
  echo 'Invalid MAX bot token format' >&2
  exit 2
fi
if [[ ! -d "$REPO_DIR" ]]; then
  echo "Postiz directory not found: $REPO_DIR" >&2
  exit 1
fi

# The token goes to curl through a config file on stdin, not argv.
response=$(
  printf 'url = "https://platform-api2.max.ru/me"\nheader = "Authorization: %s"\n' "$token" |
    curl -sS --max-time 15 --config - 2>/dev/null || true
)
username=''
if [[ "$response" == *'"user_id"'* ]]; then
  username=$(printf '%s' "$response" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')
  verified="MAX verified the token for @${username:-unknown}"
elif [[ "$response" == *'"code"'* ]]; then
  echo 'MAX rejected the token; nothing was changed' >&2
  exit 3
else
  verified='MAX is unreachable from this server; the token is stored but not verified'
fi

umask 077
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

temp_file=$(mktemp "$REPO_DIR/.env.max-assistant.XXXXXX")
trap 'rm -f "$temp_file"' EXIT

# The bot username comes from /me: MAX assigns it, so it is never guessed.
# Without a verified name the frontend keeps the MAX button hidden.
written=0
name_written=0
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    MAX_ASSISTANT_TOKEN=*)
      if [[ "$written" -eq 0 ]]; then
        printf 'MAX_ASSISTANT_TOKEN=%s\n' "$token"
        written=1
      fi
      ;;
    MAX_ASSISTANT_BOT_NAME=*)
      if [[ -n "$username" && "$name_written" -eq 0 ]]; then
        printf 'MAX_ASSISTANT_BOT_NAME=%s\n' "$username"
        name_written=1
      elif [[ -z "$username" ]]; then
        printf '%s\n' "$line"
      fi
      ;;
    *)
      printf '%s\n' "$line"
      ;;
  esac
done < "$ENV_FILE" > "$temp_file"

if [[ "$written" -eq 0 ]]; then
  printf 'MAX_ASSISTANT_TOKEN=%s\n' "$token" >> "$temp_file"
fi
if [[ -n "$username" && "$name_written" -eq 0 ]]; then
  printf 'MAX_ASSISTANT_BOT_NAME=%s\n' "$username" >> "$temp_file"
fi

chmod 600 "$temp_file"
mv "$temp_file" "$ENV_FILE"
trap - EXIT
unset token MAX_ASSISTANT_TOKEN response

echo "$verified"
echo 'MAX assistant token stored in .env'
if [[ -n "$username" ]]; then
  echo "MAX_ASSISTANT_BOT_NAME=$username stored in .env"
else
  echo 'Bot username not verified: set MAX_ASSISTANT_BOT_NAME in .env by hand before enabling the button' >&2
fi
