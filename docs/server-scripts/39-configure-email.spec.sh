#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/39-configure-email.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

PASS='s3cr3t-api-key-0123456789'

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

file_mode() {
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"
}

run_case() {
  local case_dir=$1
  shift
  env REPO_DIR="$case_dir/repo" SMTP_HOST=127.0.0.1 SMTP_PORT=1 "$@" \
    bash "$SCRIPT" > "$case_dir/output" 2>&1
}

# Replaces existing keys once, keeps unrelated lines, appends missing keys.
case_dir="$TMP_DIR/update"
mkdir -p "$case_dir/repo"
printf 'JWT_SECRET=keep\nEMAIL_USER=old\nEMAIL_USER=dup\nOTHER=1\n' > "$case_dir/repo/.env"
run_case "$case_dir" EMAIL_USER=12345 EMAIL_PASS="$PASS" \
  EMAIL_FROM_ADDRESS=hello@vezdepost.ru EMAIL_REPLY_TO=owner@example.com ||
  fail "update case exited non-zero: $(cat "$case_dir/output")"
env_file="$case_dir/repo/.env"
grep -qx 'JWT_SECRET=keep' "$env_file" || fail 'unrelated line lost'
grep -qx 'OTHER=1' "$env_file" || fail 'unrelated line lost'
[[ $(grep -c '^EMAIL_USER=' "$env_file") -eq 1 ]] || fail 'EMAIL_USER duplicated'
grep -qx 'EMAIL_USER=12345' "$env_file" || fail 'EMAIL_USER not replaced'
grep -qx "EMAIL_PASS=$PASS" "$env_file" || fail 'EMAIL_PASS not written'
grep -qx 'EMAIL_PROVIDER=nodemailer' "$env_file" || fail 'EMAIL_PROVIDER not written'
grep -qx 'EMAIL_FROM_ADDRESS=hello@vezdepost.ru' "$env_file" || fail 'from not written'
grep -qx 'EMAIL_REPLY_TO=owner@example.com' "$env_file" || fail 'reply-to not written'
[[ $(file_mode "$env_file") == 600 ]] || fail '.env mode is not 600'
grep -q "$PASS" "$case_dir/output" && fail 'password printed'

# Second run is idempotent.
before=$(cat "$env_file")
run_case "$case_dir" EMAIL_USER=12345 EMAIL_PASS="$PASS" \
  EMAIL_FROM_ADDRESS=hello@vezdepost.ru EMAIL_REPLY_TO=owner@example.com ||
  fail 'second run exited non-zero'
[[ "$before" == "$(cat "$env_file")" ]] || fail 'second run changed .env'

# Sender outside the domain is rejected and nothing is written.
case_dir="$TMP_DIR/foreign"
mkdir -p "$case_dir/repo"
printf 'JWT_SECRET=keep\n' > "$case_dir/repo/.env"
if run_case "$case_dir" EMAIL_USER=12345 EMAIL_PASS="$PASS" \
  EMAIL_FROM_ADDRESS=me@gmail.com EMAIL_REPLY_TO=owner@example.com; then
  fail 'foreign sender accepted'
fi
grep -q EMAIL_ "$case_dir/repo/.env" && fail 'foreign sender wrote .env'

echo 'PASS 39-configure-email'
