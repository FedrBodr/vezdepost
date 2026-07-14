#!/usr/bin/env bash
# Configure the public VK ID application id for Vezdepost production.
#
# Idempotent. The script never prints .env contents or access tokens.
# Run:
#   ssh -o BatchMode=yes -o ConnectTimeout=10 vezdepost \
#     'bash -s -- 54677685' < docs/server-scripts/12-configure-vk-id.sh
set -euo pipefail

POSTIZ_DIR=/root/postiz-app
ENV_FILE="$POSTIZ_DIR/.env"
VK_APPLICATION_ID="${1:-}"

if [[ ! "$VK_APPLICATION_ID" =~ ^[0-9]+$ ]]; then
  echo "usage: $0 <numeric-vk-application-id>" >&2
  exit 2
fi

if [[ ! -d "$POSTIZ_DIR" ]]; then
  echo "postiz directory not found: $POSTIZ_DIR" >&2
  exit 1
fi

touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

temp_file=$(mktemp "$POSTIZ_DIR/.env.vk-id.XXXXXX")
trap 'rm -f "$temp_file"' EXIT

awk -v value="$VK_APPLICATION_ID" '
  BEGIN { updated = 0 }
  /^VK_ID=/ {
    if (!updated) {
      print "VK_ID=" value
      updated = 1
    }
    next
  }
  { print }
  END {
    if (!updated) {
      print "VK_ID=" value
    }
  }
' "$ENV_FILE" > "$temp_file"

chmod 600 "$temp_file"
mv "$temp_file" "$ENV_FILE"
trap - EXIT

echo "VK_ID is configured in $ENV_FILE"

cd "$POSTIZ_DIR"
docker compose config --quiet
docker compose up -d --no-build postiz

echo "Postiz Compose configuration applied"
