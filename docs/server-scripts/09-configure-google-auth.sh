#!/usr/bin/env bash
set -euo pipefail

REPO_DIR=${REPO_DIR:-/root/postiz-app}
EXPECTED_REDIRECT=${EXPECTED_REDIRECT:-https://app.vezdepost.ru/auth?provider=GOOGLE}
cd "$REPO_DIR"

docker compose config >/dev/null

for name in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  if ! docker compose run --rm --no-deps --entrypoint sh postiz \
    -lc "test -n \"\${${name}:-}\"" >/dev/null 2>&1; then
    echo "${name} resolves empty in the production Compose environment" >&2
    exit 1
  fi
done

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

printf '%s' "$oauth_url" | docker exec -i \
  -e EXPECTED_REDIRECT="$EXPECTED_REDIRECT" postiz node -e '
let body = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { body += chunk; });
process.stdin.on("end", () => {
  try {
    const url = new URL(body);
    if (url.hostname !== "accounts.google.com") {
      throw new Error();
    }
    if (!url.searchParams.get("client_id")) {
      throw new Error();
    }
    if (url.searchParams.get("redirect_uri") !== process.env.EXPECTED_REDIRECT) {
      throw new Error();
    }
    console.log("Google OAuth configuration verified");
  } catch {
    console.error("Google OAuth configuration verification failed");
    process.exitCode = 1;
  }
});
'
