#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/27-configure-telegram-assistant.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

TOKEN='123456789:AAbbCCddEEffGGhhIIjjKKllMMnnOOppQQr'

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

file_mode() {
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"
}

# curl stub: records how it was called and answers getMe.
make_curl_stub() {
  local bin_dir=$1
  mkdir -p "$bin_dir"
  cat > "$bin_dir/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CURL_CALLS"
cat > /dev/null
printf '%s' "${CURL_RESPONSE-{\"ok\":true,\"result\":{\"username\":\"vezde_post_bot\"}}}"
STUB
  chmod +x "$bin_dir/curl"
}

run_case() {
  local case_dir=$1
  shift
  make_curl_stub "$case_dir/bin"
  : > "$case_dir/curl.calls"
  env PATH="$case_dir/bin:$PATH" CURL_CALLS="$case_dir/curl.calls" \
    REPO_DIR="$case_dir/repo" "$@" bash "$SCRIPT" > "$case_dir/output" 2>&1
}

test_stores_token_privately_without_leaking_it() {
  local case_dir="$TMP_DIR/store"
  mkdir -p "$case_dir/repo"
  printf 'JWT_SECRET=keep-me\nTELEGRAM_ASSISTANT_TOKEN=old:stale\n' > "$case_dir/repo/.env"
  chmod 644 "$case_dir/repo/.env"

  run_case "$case_dir" TELEGRAM_ASSISTANT_TOKEN="$TOKEN" ||
    { cat "$case_dir/output" >&2; fail 'configuration failed'; }

  [[ "$(cat "$case_dir/repo/.env")" == "JWT_SECRET=keep-me
TELEGRAM_ASSISTANT_TOKEN=$TOKEN" ]] || fail 'replaces the token and keeps other settings'
  [[ "$(file_mode "$case_dir/repo/.env")" == 600 ]] || fail 'keeps .env private'
  grep -q "$TOKEN" "$case_dir/output" && fail 'prints the token'
  grep -q "$TOKEN" "$case_dir/curl.calls" && fail 'passes the token on the command line'
  grep -q '@vezde_post_bot' "$case_dir/output" || fail 'reports the verified bot'
}

test_rejects_malformed_token() {
  local case_dir="$TMP_DIR/malformed"
  mkdir -p "$case_dir/repo"
  printf 'JWT_SECRET=keep-me\n' > "$case_dir/repo/.env"

  if run_case "$case_dir" TELEGRAM_ASSISTANT_TOKEN='not-a-token'; then
    fail 'must reject a malformed token'
  fi
  [[ "$(cat "$case_dir/repo/.env")" == 'JWT_SECRET=keep-me' ]] || fail 'leaves .env untouched'
}

test_rejects_token_telegram_refuses() {
  local case_dir="$TMP_DIR/refused"
  mkdir -p "$case_dir/repo"
  printf 'JWT_SECRET=keep-me\n' > "$case_dir/repo/.env"

  if run_case "$case_dir" TELEGRAM_ASSISTANT_TOKEN="$TOKEN" \
    CURL_RESPONSE='{"ok":false,"error_code":401,"description":"Unauthorized"}'; then
    fail 'must reject a token Telegram refuses'
  fi
  [[ "$(cat "$case_dir/repo/.env")" == 'JWT_SECRET=keep-me' ]] || fail 'leaves .env untouched'
}

test_stores_token_when_telegram_is_unreachable() {
  local case_dir="$TMP_DIR/unreachable"
  mkdir -p "$case_dir/repo"
  : > "$case_dir/repo/.env"

  run_case "$case_dir" TELEGRAM_ASSISTANT_TOKEN="$TOKEN" CURL_RESPONSE='' ||
    { cat "$case_dir/output" >&2; fail 'configuration failed'; }

  grep -qx "TELEGRAM_ASSISTANT_TOKEN=$TOKEN" "$case_dir/repo/.env" ||
    fail 'stores the token'
  grep -qi 'not verified' "$case_dir/output" || fail 'warns that the token was not verified'
}

test_stores_token_privately_without_leaking_it
test_rejects_malformed_token
test_rejects_token_telegram_refuses
test_stores_token_when_telegram_is_unreachable
echo 'PASS: 27-configure-telegram-assistant'
