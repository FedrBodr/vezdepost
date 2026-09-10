#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/16-configure-tumblr.sh"
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
if [[ "${FAIL_COMPOSE_CONFIG:-0}" == 1 && "$*" == 'compose config --quiet' ]]; then
  exit 1
fi
STUB
  chmod +x "$bin_dir/docker"
}

make_repo() {
  local repo=$1
  mkdir -p "$repo"
  cat > "$repo/.env" <<'ENV'
JWT_SECRET=keep-me
TUMBLR_CLIENT_ID=stale-id
TUMBLR_CLIENT_SECRET=stale-secret
TUMBLR_CLIENT_ID=duplicate-id
ENV
  chmod 644 "$repo/.env"
  cat > "$repo/docker-compose.override.yaml" <<'YAML'
services:
  postiz:
    environment:
      LINKEDIN_CLIENT_SECRET: '${LINKEDIN_CLIENT_SECRET:?set in .env}'
      TUMBLR_CLIENT_ID: 'stale'
      TUMBLR_CLIENT_SECRET: 'stale'
      KEEP_ME: 'yes'
YAML
  chmod 644 "$repo/docker-compose.override.yaml"
}

test_configures_tumblr_without_leaking_credentials() {
  local case_dir="$TMP_DIR/configure"
  local repo="$case_dir/repo"
  local bin_dir="$case_dir/bin"
  local docker_calls="$case_dir/docker.calls"
  local output_file="$case_dir/output"
  local client_id='test-client-id'
  local client_secret='test-client-secret'

  make_repo "$repo"
  make_docker_stub "$bin_dir"
  : > "$docker_calls"

  if ! PATH="$bin_dir:$PATH" \
    DOCKER_CALLS="$docker_calls" \
    REPO_DIR="$repo" \
    TUMBLR_CLIENT_ID_INPUT="$client_id" \
    TUMBLR_CLIENT_SECRET_INPUT="$client_secret" \
    SKIP_RUNTIME_READINESS=1 \
    bash "$SCRIPT" > "$output_file" 2>&1; then
    cat "$output_file" >&2
    fail 'configuration script failed'
  fi

  assert_eq '1' "$(grep -c '^TUMBLR_CLIENT_ID=' "$repo/.env")" \
    'client ID must have one definition'
  assert_eq '1' "$(grep -c '^TUMBLR_CLIENT_SECRET=' "$repo/.env")" \
    'client secret must have one definition'
  assert_eq "TUMBLR_CLIENT_ID=$client_id" \
    "$(grep '^TUMBLR_CLIENT_ID=' "$repo/.env")" \
    'client ID must be updated'
  assert_eq "TUMBLR_CLIENT_SECRET=$client_secret" \
    "$(grep '^TUMBLR_CLIENT_SECRET=' "$repo/.env")" \
    'client secret must be updated'
  grep -Fq "TUMBLR_CLIENT_ID: '\${TUMBLR_CLIENT_ID:?set in .env}'" \
    "$repo/docker-compose.override.yaml" || fail 'Compose client ID interpolation is missing'
  grep -Fq "TUMBLR_CLIENT_SECRET: '\${TUMBLR_CLIENT_SECRET:?set in .env}'" \
    "$repo/docker-compose.override.yaml" || fail 'Compose client secret interpolation is missing'
  grep -q '^JWT_SECRET=keep-me$' "$repo/.env" ||
    fail 'unrelated environment values must be preserved'
  grep -q "^[[:space:]]*KEEP_ME: 'yes'$" "$repo/docker-compose.override.yaml" ||
    fail 'unrelated Compose values must be preserved'
  assert_eq '600' "$(file_mode "$repo/.env")" \
    '.env must remain owner-readable only'
  assert_eq '644' "$(file_mode "$repo/docker-compose.override.yaml")" \
    'Compose override mode must be preserved'
  assert_eq '1' \
    "$(find "$repo" -maxdepth 1 -name '.env.tumblr-backup.*' | wc -l | tr -d ' ')" \
    'one .env backup must be created'
  assert_eq '1' \
    "$(find "$repo" -maxdepth 1 -name 'docker-compose.override.yaml.tumblr-backup.*' | wc -l | tr -d ' ')" \
    'one Compose override backup must be created'
  ! grep -Fq "$client_id" "$output_file" || fail 'client ID leaked to output'
  ! grep -Fq "$client_secret" "$output_file" || fail 'client secret leaked to output'
  grep -q '^compose config --quiet$' "$docker_calls" ||
    fail 'Compose config was not validated'
  grep -q '^compose up -d --no-deps --force-recreate postiz$' "$docker_calls" ||
    fail 'postiz was not recreated safely'
  grep -q '^exec postiz sh -lc ' "$docker_calls" ||
    fail 'running container environment was not verified'
}

test_rejects_invalid_input_before_mutation() {
  local case_dir="$TMP_DIR/invalid"
  local repo="$case_dir/repo"
  local bin_dir="$case_dir/bin"
  local docker_calls="$case_dir/docker.calls"
  local output_file="$case_dir/output"

  make_repo "$repo"
  make_docker_stub "$bin_dir"
  : > "$docker_calls"
  cp "$repo/.env" "$case_dir/env.before"
  cp "$repo/docker-compose.override.yaml" "$case_dir/override.before"

  if PATH="$bin_dir:$PATH" \
    DOCKER_CALLS="$docker_calls" \
    REPO_DIR="$repo" \
    TUMBLR_CLIENT_ID_INPUT=$'invalid\nclient-id' \
    TUMBLR_CLIENT_SECRET_INPUT='test-client-secret' \
    SKIP_RUNTIME_READINESS=1 \
    bash "$SCRIPT" > "$output_file" 2>&1; then
    fail 'multiline credentials were accepted'
  fi

  cmp -s "$case_dir/env.before" "$repo/.env" ||
    fail '.env changed after invalid input'
  cmp -s "$case_dir/override.before" "$repo/docker-compose.override.yaml" ||
    fail 'Compose override changed after invalid input'
  [[ ! -s "$docker_calls" ]] || fail 'Docker ran after invalid input'
  ! grep -Fq 'invalid' "$output_file" || fail 'invalid credential leaked to output'
}

test_rolls_back_files_when_compose_validation_fails() {
  local case_dir="$TMP_DIR/rollback"
  local repo="$case_dir/repo"
  local bin_dir="$case_dir/bin"
  local docker_calls="$case_dir/docker.calls"
  local output_file="$case_dir/output"

  make_repo "$repo"
  make_docker_stub "$bin_dir"
  : > "$docker_calls"
  cp "$repo/.env" "$case_dir/env.before"
  cp "$repo/docker-compose.override.yaml" "$case_dir/override.before"

  if PATH="$bin_dir:$PATH" \
    DOCKER_CALLS="$docker_calls" \
    FAIL_COMPOSE_CONFIG=1 \
    REPO_DIR="$repo" \
    TUMBLR_CLIENT_ID_INPUT='test-client-id' \
    TUMBLR_CLIENT_SECRET_INPUT='test-client-secret' \
    SKIP_RUNTIME_READINESS=1 \
    bash "$SCRIPT" > "$output_file" 2>&1; then
    fail 'Compose validation failure was ignored'
  fi

  cmp -s "$case_dir/env.before" "$repo/.env" ||
    fail '.env was not rolled back after validation failure'
  cmp -s "$case_dir/override.before" "$repo/docker-compose.override.yaml" ||
    fail 'Compose override was not rolled back after validation failure'
  ! grep -q '^compose up ' "$docker_calls" ||
    fail 'postiz was recreated after failed Compose validation'
  ! grep -Fq 'test-client-id' "$output_file" || fail 'client ID leaked during rollback'
  ! grep -Fq 'test-client-secret' "$output_file" || fail 'client secret leaked during rollback'
}

test_documents_safe_interactive_transport() {
  local readme="$SCRIPT_DIR/../../deploy/README.md"

  grep -q 'scp .*16-configure-tumblr.sh' "$readme" ||
    fail 'documentation must copy the script before the interactive SSH run'
  grep -q 'ssh -tt .*vezdepost' "$readme" ||
    fail 'documentation must allocate a remote TTY'
  grep -q 'bash /tmp/vezdepost-configure-tumblr.sh' "$readme" ||
    fail 'documentation must execute the copied script'
  ! grep -q "'bash -s' < docs/server-scripts/16-configure-tumblr.sh" "$readme" ||
    fail 'stdin script transport prevents hidden remote prompts'
}

test_configures_tumblr_without_leaking_credentials
test_rejects_invalid_input_before_mutation
test_rolls_back_files_when_compose_validation_fails
test_documents_safe_interactive_transport
echo 'Tumblr configuration script tests passed'
