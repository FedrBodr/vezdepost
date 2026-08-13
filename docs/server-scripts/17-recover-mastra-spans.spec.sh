#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/17-recover-mastra-spans.sh"
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

make_stubs() {
  local bin_dir=$1
  mkdir -p "$bin_dir"

  cat > "$bin_dir/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_CALLS"

case "$*" in
  *"max(attnum)"*)
    printf '%s\n' "${TABLE_STATS:-0|1600|1562}"
    ;;
  *"select count(*) from public.mastra_ai_spans"*)
    printf '%s\n' "${TABLE_ROWS_AFTER_STOP:-0}"
    ;;
  *"pg_dump"*)
    printf '%s\n' '-- safe test dump'
    ;;
  *"to_regclass('public.mastra_ai_spans')"*)
    printf '%s\n' 'mastra_ai_spans'
    ;;
  *"to_regclass("*".mastra_ai_spans')"*)
    printf '%s\n' 'mastra_ai_spans'
    ;;
  *"pm2 pid backend"*)
    printf '%s\n' '123'
    ;;
esac
STUB
  chmod +x "$bin_dir/docker"

  cat > "$bin_dir/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CURL_CALLS"
printf '%s' '401'
STUB
  chmod +x "$bin_dir/curl"
}

test_recovers_empty_exhausted_table_without_restarting_containers() {
  local case_dir="$TMP_DIR/recover"
  local repo="$case_dir/repo"
  local bin_dir="$case_dir/bin"
  local docker_calls="$case_dir/docker.calls"
  local curl_calls="$case_dir/curl.calls"
  local output_file="$case_dir/output"

  mkdir -p "$repo"
  make_stubs "$bin_dir"
  : > "$docker_calls"
  : > "$curl_calls"

  if ! PATH="$bin_dir:$PATH" \
    DOCKER_CALLS="$docker_calls" \
    CURL_CALLS="$curl_calls" \
    REPO_DIR="$repo" \
    SKIP_RECOVERY_WAIT=1 \
    bash "$SCRIPT" > "$output_file" 2>&1; then
    cat "$output_file" >&2
    fail 'recovery script failed'
  fi

  grep -q '^exec postiz pm2 stop backend$' "$docker_calls" ||
    fail 'backend was not stopped before the schema move'
  grep -q '^exec postiz pm2 start backend$' "$docker_calls" ||
    fail 'backend was not started after the schema move'
  grep -qi 'alter table public.mastra_ai_spans set schema' "$docker_calls" ||
    fail 'exhausted table was not moved to the backup schema'
  ! grep -Eq '^compose (up|restart|down)|^restart ' "$docker_calls" ||
    fail 'a container-level restart was attempted'

  local dump_file
  dump_file=$(find "$repo/backups" -maxdepth 1 -name 'mastra_ai_spans-before-recovery-*.sql' -print -quit)
  [[ -n "$dump_file" ]] || fail 'SQL backup was not created'
  assert_eq '600' "$(file_mode "$dump_file")" 'SQL backup must be owner-readable only'
  grep -q 'Mastra spans recovery completed' "$output_file" ||
    fail 'successful recovery was not reported'
}

test_refuses_to_move_a_nonempty_table() {
  local case_dir="$TMP_DIR/nonempty"
  local repo="$case_dir/repo"
  local bin_dir="$case_dir/bin"
  local docker_calls="$case_dir/docker.calls"
  local curl_calls="$case_dir/curl.calls"
  local output_file="$case_dir/output"

  mkdir -p "$repo"
  make_stubs "$bin_dir"
  : > "$docker_calls"
  : > "$curl_calls"

  if PATH="$bin_dir:$PATH" \
    DOCKER_CALLS="$docker_calls" \
    CURL_CALLS="$curl_calls" \
    TABLE_STATS='1|1600|1562' \
    REPO_DIR="$repo" \
    SKIP_RECOVERY_WAIT=1 \
    bash "$SCRIPT" > "$output_file" 2>&1; then
    fail 'nonempty table was accepted'
  fi

  ! grep -q 'pm2 stop backend' "$docker_calls" ||
    fail 'backend was stopped for a nonempty table'
  ! grep -qi 'alter table public.mastra_ai_spans set schema' "$docker_calls" ||
    fail 'nonempty table was moved'
}

test_recovers_empty_exhausted_table_without_restarting_containers
test_refuses_to_move_a_nonempty_table
echo 'Mastra spans recovery script tests passed'
