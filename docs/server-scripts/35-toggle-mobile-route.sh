#!/usr/bin/env bash
# Enable or disable the mobile shell redirect (MOBILE_ROUTE_ENABLED) in the
# production .env, then restart the app so the proxy picks it up.
# Usage on the server: bash 35-toggle-mobile-route.sh on|off
# From the operator machine:
#   scp -q docs/server-scripts/35-toggle-mobile-route.sh vezdepost:/tmp/vz-mobile.sh
#   ssh vezdepost 'bash /tmp/vz-mobile.sh on; rm -f /tmp/vz-mobile.sh'
set -euo pipefail

REPO_DIR=${REPO_DIR:-/root/postiz-app}
ENV_FILE="$REPO_DIR/.env"
case "${1:-}" in
  on) value=true ;;
  off) value=false ;;
  *) echo 'usage: 35-toggle-mobile-route.sh on|off' >&2; exit 2 ;;
esac

touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
temp_file=$(mktemp "$REPO_DIR/.env.mobile.XXXXXX")
trap 'rm -f "$temp_file"' EXIT
grep -v '^MOBILE_ROUTE_ENABLED=' "$ENV_FILE" > "$temp_file" || true
printf 'MOBILE_ROUTE_ENABLED=%s\n' "$value" >> "$temp_file"
chmod 600 "$temp_file"
mv "$temp_file" "$ENV_FILE"
trap - EXIT

cd "$REPO_DIR"
docker compose up -d postiz
echo "MOBILE_ROUTE_ENABLED=$value applied"
