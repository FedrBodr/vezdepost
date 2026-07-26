#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/14-configure-posthog.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_eq() {
  local expected=$1
  local actual=$2
  local message=$3
  [[ "$actual" == "$expected" ]] ||
    fail "$message (expected '$expected', got '$actual')"
}

file_mode() {
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"
}

make_docker_stub() {
  local bin_dir=$1
  mkdir -p "$bin_dir"
  cat > "$bin_dir/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_CALLS"
STUB
  chmod +x "$bin_dir/docker"
}

test_configures_posthog_without_leaking_token() {
  local case_dir="$TMP_DIR/configure"
  local repo="$case_dir/repo"
  local bin_dir="$case_dir/bin"
  local docker_calls="$case_dir/docker.calls"
  local output_file="$case_dir/output"
  local token='phc_testToken123'

  mkdir -p "$repo"
  make_docker_stub "$bin_dir"
  : > "$docker_calls"
  cat > "$repo/.env" <<'ENV'
JWT_SECRET=keep-me
NEXT_PUBLIC_POSTHOG_KEY=phc_stale
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
NEXT_PUBLIC_POSTHOG_KEY=phc_duplicate
ENV
  chmod 644 "$repo/.env"

  if ! PATH="$bin_dir:$PATH" \
    DOCKER_CALLS="$docker_calls" \
    REPO_DIR="$repo" \
    POSTHOG_PROJECT_TOKEN="$token" \
    bash "$SCRIPT" > "$output_file" 2>&1; then
    cat "$output_file" >&2
    fail 'configuration script failed'
  fi

  assert_eq '1' "$(grep -c '^NEXT_PUBLIC_POSTHOG_KEY=' "$repo/.env")" \
    'project token must have one definition'
  assert_eq '1' "$(grep -c '^NEXT_PUBLIC_POSTHOG_HOST=' "$repo/.env")" \
    'ingestion host must have one definition'
  assert_eq "NEXT_PUBLIC_POSTHOG_KEY=$token" \
    "$(grep '^NEXT_PUBLIC_POSTHOG_KEY=' "$repo/.env")" \
    'project token must be updated'
  assert_eq 'NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com' \
    "$(grep '^NEXT_PUBLIC_POSTHOG_HOST=' "$repo/.env")" \
    'EU ingestion host must be configured'
  grep -q '^JWT_SECRET=keep-me$' "$repo/.env" ||
    fail 'unrelated environment values must be preserved'
  assert_eq '600' "$(file_mode "$repo/.env")" \
    '.env must remain owner-readable only'
  ! grep -q "$token" "$output_file" || fail 'project token leaked to output'
  grep -q '^compose config --quiet$' "$docker_calls" ||
    fail 'Compose config was not validated'
  grep -q '^compose up -d --no-deps --force-recreate postiz$' "$docker_calls" ||
    fail 'postiz was not recreated safely'
  grep -q '^exec postiz sh -lc ' "$docker_calls" ||
    fail 'running container environment was not verified'
}

test_rejects_invalid_token_before_mutation() {
  local case_dir="$TMP_DIR/invalid"
  local repo="$case_dir/repo"
  local bin_dir="$case_dir/bin"
  local docker_calls="$case_dir/docker.calls"
  local output_file="$case_dir/output"

  mkdir -p "$repo"
  make_docker_stub "$bin_dir"
  : > "$docker_calls"
  printf '%s\n' 'JWT_SECRET=unchanged' > "$repo/.env"
  cp "$repo/.env" "$case_dir/env.before"

  if PATH="$bin_dir:$PATH" \
    DOCKER_CALLS="$docker_calls" \
    REPO_DIR="$repo" \
    POSTHOG_PROJECT_TOKEN='invalid-token' \
    bash "$SCRIPT" > "$output_file" 2>&1; then
    fail 'invalid project token was accepted'
  fi

  cmp -s "$case_dir/env.before" "$repo/.env" ||
    fail '.env changed after invalid input'
  [[ ! -s "$docker_calls" ]] || fail 'Docker ran after invalid input'
  ! grep -q 'invalid-token' "$output_file" ||
    fail 'invalid project token leaked to output'
}

test_configures_posthog_without_leaking_token
test_rejects_invalid_token_before_mutation
echo 'PostHog configuration script tests passed'
