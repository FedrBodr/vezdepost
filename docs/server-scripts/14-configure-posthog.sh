#!/usr/bin/env bash
# Configure the public PostHog project token for Vezdepost production.
#
# Idempotent. The script never prints the token or .env contents.
# Run from the operator machine:
#   scp -q -o BatchMode=yes -o ConnectTimeout=10 docs/server-scripts/14-configure-posthog.sh vezdepost:/tmp/vezdepost-configure-posthog.sh
#   ssh -tt -o BatchMode=yes -o ConnectTimeout=10 vezdepost \
#     'status=0; bash /tmp/vezdepost-configure-posthog.sh || status=$?; rm -f /tmp/vezdepost-configure-posthog.sh; exit "$status"'
set -euo pipefail

REPO_DIR=${REPO_DIR:-/root/postiz-app}
ENV_FILE="$REPO_DIR/.env"
POSTHOG_HOST=https://eu.i.posthog.com
token=${POSTHOG_PROJECT_TOKEN:-}

if [[ -z "$token" ]]; then
  printf 'PostHog project token (phc_...): ' > /dev/tty
  if ! IFS= read -r -s token < /dev/tty; then
    printf '\nUnable to read the PostHog project token\n' > /dev/tty
    exit 1
  fi
  printf '\n' > /dev/tty
fi

if [[ ! "$token" =~ ^phc_[A-Za-z0-9_-]+$ ]]; then
  echo 'Invalid PostHog project token format; expected phc_...' >&2
  exit 2
fi

if [[ ! -d "$REPO_DIR" ]]; then
  echo "Postiz directory not found: $REPO_DIR" >&2
  exit 1
fi

umask 077
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

temp_file=$(mktemp "$REPO_DIR/.env.posthog.XXXXXX")
trap 'rm -f "$temp_file"' EXIT

key_written=0
host_written=0
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    NEXT_PUBLIC_POSTHOG_KEY=*)
      if [[ "$key_written" -eq 0 ]]; then
        printf 'NEXT_PUBLIC_POSTHOG_KEY=%s\n' "$token"
        key_written=1
      fi
      ;;
    NEXT_PUBLIC_POSTHOG_HOST=*)
      if [[ "$host_written" -eq 0 ]]; then
        printf 'NEXT_PUBLIC_POSTHOG_HOST=%s\n' "$POSTHOG_HOST"
        host_written=1
      fi
      ;;
    *)
      printf '%s\n' "$line"
      ;;
  esac
done < "$ENV_FILE" > "$temp_file"

if [[ "$key_written" -eq 0 ]]; then
  printf 'NEXT_PUBLIC_POSTHOG_KEY=%s\n' "$token" >> "$temp_file"
fi
if [[ "$host_written" -eq 0 ]]; then
  printf 'NEXT_PUBLIC_POSTHOG_HOST=%s\n' "$POSTHOG_HOST" >> "$temp_file"
fi

chmod 600 "$temp_file"
mv "$temp_file" "$ENV_FILE"
trap - EXIT
unset token POSTHOG_PROJECT_TOKEN

cd "$REPO_DIR"
docker compose config --quiet
docker compose up -d --no-deps --force-recreate postiz
docker exec postiz sh -lc \
  'test -n "${NEXT_PUBLIC_POSTHOG_KEY:-}" && test "${NEXT_PUBLIC_POSTHOG_HOST:-}" = "https://eu.i.posthog.com"'

echo 'PostHog production configuration applied and verified'
