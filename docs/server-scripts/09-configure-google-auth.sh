#!/usr/bin/env bash
set -euo pipefail

REPO_DIR=${REPO_DIR:-/root/postiz-app}
EXPECTED_REDIRECT=${EXPECTED_REDIRECT:-https://app.vezdepost.ru/auth?provider=GOOGLE}
cd "$REPO_DIR"

for name in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  if ! grep -Eq "^${name}=.+" .env; then
    echo "Missing non-empty ${name} in $REPO_DIR/.env" >&2
    exit 1
  fi
done

docker compose config >/dev/null
docker compose up -d --no-deps --force-recreate postiz

for name in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  if ! docker exec postiz sh -lc "test -n \"\${${name}:-}\""; then
    echo "${name} is missing in the running container" >&2
    exit 1
  fi
done

oauth_url=$(curl --fail --silent --show-error \
  --retry 10 --retry-delay 3 --retry-connrefused \
  http://127.0.0.1:4007/api/auth/oauth/GOOGLE)

EXPECTED_REDIRECT="$EXPECTED_REDIRECT" node -e '
let body = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { body += chunk; });
process.stdin.on("end", () => {
  const url = new URL(body);
  if (url.hostname !== "accounts.google.com") {
    throw new Error("unexpected OAuth host");
  }
  if (!url.searchParams.get("client_id")) {
    throw new Error("missing client_id");
  }
  if (url.searchParams.get("redirect_uri") !== process.env.EXPECTED_REDIRECT) {
    throw new Error("unexpected redirect_uri");
  }
  console.log("Google OAuth configuration verified");
});
' <<<"$oauth_url"
