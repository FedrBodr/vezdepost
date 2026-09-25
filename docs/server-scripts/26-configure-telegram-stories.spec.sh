#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/26-configure-telegram-stories.sh"
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

# The stub answers the organization query with $ORG_IDS (one per line) and
# the compose config check with $COMPOSE_CONFIG; every call is recorded.
make_docker_stub() {
  local bin_dir=$1
  mkdir -p "$bin_dir"
  cat > "$bin_dir/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_CALLS"
case "$*" in
  *psql*) printf '%s' "$ORG_IDS" ;;
  "compose config") printf '%s\n' "$COMPOSE_CONFIG" ;;
esac
STUB
  chmod +x "$bin_dir/docker"
}

run_case() {
  local case_dir=$1
  shift
  make_docker_stub "$case_dir/bin"
  : > "$case_dir/docker.calls"
  env PATH="$case_dir/bin:$PATH" \
    DOCKER_CALLS="$case_dir/docker.calls" \
    REPO_DIR="$case_dir/repo" \
    COMPOSE_CONFIG="${COMPOSE_CONFIG:-      TELEGRAM_STORIES_ORG_IDS: org-a}" \
    "$@" bash "$SCRIPT" > "$case_dir/output" 2>&1
}

test_enables_owner_organizations() {
  local case_dir="$TMP_DIR/enable"
  mkdir -p "$case_dir/repo"
  cat > "$case_dir/repo/.env" <<'ENV'
JWT_SECRET=keep-me
TELEGRAM_STORIES_ORG_IDS=stale
ENV
  chmod 644 "$case_dir/repo/.env"

  run_case "$case_dir" ORG_IDS=$'org-a\norg-b\n' ||
    { cat "$case_dir/output" >&2; fail 'configuration failed'; }

  assert_eq 'JWT_SECRET=keep-me
TELEGRAM_STORIES_ORG_IDS=org-a,org-b' "$(cat "$case_dir/repo/.env")" \
    'replaces the organization list and keeps other settings'
  assert_eq '600' "$(file_mode "$case_dir/repo/.env")" 'keeps .env private'
  grep -q "fedrbodr@gmail.com" "$case_dir/docker.calls" ||
    fail 'looks up the default owner'
  grep -q 'compose up -d --no-deps --force-recreate postiz' "$case_dir/docker.calls" ||
    fail 'recreates the application container'
  grep -q 'exec postiz' "$case_dir/docker.calls" ||
    fail 'verifies the variable inside the container'
}

test_adds_provider_to_explicit_allowlist() {
  local case_dir="$TMP_DIR/allowlist"
  mkdir -p "$case_dir/repo"
  printf 'ENABLED_SOCIAL_INTEGRATIONS=telegram,max\n' > "$case_dir/repo/.env"

  run_case "$case_dir" ORG_IDS=$'org-a\n' ||
    { cat "$case_dir/output" >&2; fail 'configuration failed'; }

  grep -qx 'ENABLED_SOCIAL_INTEGRATIONS=telegram,max,telegram-stories' \
    "$case_dir/repo/.env" || fail 'appends telegram-stories to the allowlist'
}

test_keeps_empty_allowlist_empty() {
  local case_dir="$TMP_DIR/empty-allowlist"
  mkdir -p "$case_dir/repo"
  printf 'ENABLED_SOCIAL_INTEGRATIONS=\n' > "$case_dir/repo/.env"

  run_case "$case_dir" ORG_IDS=$'org-a\n' ||
    { cat "$case_dir/output" >&2; fail 'configuration failed'; }

  grep -qx 'ENABLED_SOCIAL_INTEGRATIONS=' "$case_dir/repo/.env" ||
    fail 'an empty allowlist already enables every provider'
}

test_refuses_unknown_owner() {
  local case_dir="$TMP_DIR/unknown"
  mkdir -p "$case_dir/repo"
  printf 'JWT_SECRET=keep-me\n' > "$case_dir/repo/.env"

  if run_case "$case_dir" ORG_IDS='' OWNER_EMAIL=nobody@example.com; then
    fail 'must fail without organizations'
  fi
  assert_eq 'JWT_SECRET=keep-me' "$(cat "$case_dir/repo/.env")" \
    'leaves .env untouched'
  grep -q 'compose up' "$case_dir/docker.calls" && fail 'must not restart' || true
}

test_refuses_before_compose_passes_the_variable() {
  local case_dir="$TMP_DIR/old-compose"
  mkdir -p "$case_dir/repo"
  printf 'JWT_SECRET=keep-me\n' > "$case_dir/repo/.env"

  if COMPOSE_CONFIG='      JWT_SECRET: x' run_case "$case_dir" ORG_IDS=$'org-a\n'; then
    fail 'must fail until the compose change is deployed'
  fi
  assert_eq 'JWT_SECRET=keep-me' "$(cat "$case_dir/repo/.env")" \
    'leaves .env untouched'
}

test_enables_owner_organizations
test_adds_provider_to_explicit_allowlist
test_keeps_empty_allowlist_empty
test_refuses_unknown_owner
test_refuses_before_compose_passes_the_variable
echo 'PASS: 26-configure-telegram-stories'
