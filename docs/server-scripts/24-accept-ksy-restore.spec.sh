#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/24-accept-ksy-restore.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

make_case() {
  local case_dir=$1
  mkdir -p "$case_dir/opt/ksy-deals" "$case_dir/backups" "$case_dir/bin"
  cat > "$case_dir/opt/ksy-deals/.env" <<ENV
KSY_DEALS_BACKUP_DIR=$case_dir/backups
POSTGRES_DB=ksy_deals
POSTGRES_USER=ksy_deals
POSTGRES_PASSWORD=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
DATABASE_URL=postgresql://ksy_deals:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@db:5432/ksy_deals
BACKUP_ENCRYPTION_PASSPHRASE=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
KSY_DEALS_IMAGE=ghcr.io/fedrbodr/ksy-deals@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
ENV
  chmod 600 "$case_dir/opt/ksy-deals/.env"
  printf 'services: {}\n' > "$case_dir/opt/ksy-deals/docker-compose.yml"
  printf 'encrypted' > "$case_dir/backups/ksy-deals-20260816T010000Z.dump.gpg"
  cat > "$case_dir/bin/docker" <<'STUB'
#!/usr/bin/env bash
if env | grep -Eq '^(DATABASE_URL|POSTGRES_PASSWORD|BACKUP_ENCRYPTION_PASSPHRASE|TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|ADMIN_TELEGRAM_IDS|PLATPRICES_API_KEY|PLATPRICES_PROXY_URL)='; then
  exit 98
fi
printf '%s\n' "$*" >> "$DOCKER_CALLS"
if [[ "$*" == *'CREATE DATABASE ksy_deals_restore'* ]]; then
  [[ ! -e "$RESTORE_EXISTS" ]] || exit 3
  : > "$RESTORE_EXISTS"
elif [[ "$*" == *'DROP DATABASE ksy_deals_restore WITH (FORCE)'* ]]; then
  if [[ "${KSY_TEST_CLEANUP_FAIL:-0}" == 1 ]]; then exit 91; fi
  rm -f "$RESTORE_EXISTS"
elif [[ "$*" == *"SELECT 1 FROM pg_database WHERE datname='ksy_deals_restore'"* ]]; then
  [[ -e "$RESTORE_EXISTS" ]] && printf '1\n' || true
elif [[ "$*" == *'KSY_RESTORE_RUNNER_V3'* ]]; then
  [[ "${RESTORE_DATABASE_URL:-}" == postgresql://ksy_deals:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@db:5432/ksy_deals_restore ]] || exit 4
  [[ "${BACKUP_FILE:-}" == /backups/ksy-deals-20260816T010000Z.dump.gpg ]] || exit 5
  [[ "${RESTORE_CONFIRM:-}" == RESTORE_KSY_DEALS_DISPOSABLE ]] || exit 6
  if [[ -n "${KSY_TEST_STAGE_STATUS:-}" ]]; then
    printf 'raw-secret=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb postgresql://user:password@db/private diagnostic\n' >&2
    exit "$KSY_TEST_STAGE_STATUS"
  fi
elif [[ "$*" == *'KSY_FULL_GAME_EDITIONS_V1'* ]]; then
  if [[ "$*" == *'--dbname ksy_deals_restore'* && "${KSY_TEST_ROW_MISMATCH:-0}" == 1 ]]; then
    printf '67616d652d726f772d6368616e676564\n'
  else
    printf '67616d652d726f772d636f6d706c657465\n'
  fi
elif [[ "$*" == *'KSY_FULL_PRICE_OBSERVATIONS_V1'* ]]; then
  if [[ "$*" == *'--dbname ksy_deals '* ]]; then
    reads=$(wc -l < "$LIVE_OBSERVATION_READS" | tr -d ' ')
    printf 'x\n' >> "$LIVE_OBSERVATION_READS"
    if [[ "${KSY_TEST_LIVE_CHANGED:-0}" == 1 && "$reads" -ge 1 ]]; then
      printf '6c6976652d6f62736572766174696f6e2d6368616e676564\n'
    else
      printf '6f62736572766174696f6e2d726f772d636f6d706c657465\n'
    fi
  elif [[ "${KSY_TEST_ROW_MISMATCH:-0}" == 1 ]]; then
    printf '726573746f72652d6f62736572766174696f6e2d6368616e676564\n'
  else
    printf '6f62736572766174696f6e2d726f772d636f6d706c657465\n'
  fi
elif [[ "$*" == *'KSY_SCHEMA_MIGRATIONS_V1'* ]]; then
  if [[ "$*" == *'--dbname ksy_deals_restore'* && "${KSY_TEST_MIGRATION_MISMATCH:-0}" == 1 ]]; then
    printf '303030315f763031\n303030325f756e6578706563746564\n'
  else
    printf '303030315f763031\n303030325f6f62736572766174696f6e5f70706964\n'
  fi
elif [[ "$*" == *'KSY_DEAL_POST_FORMAT_COUNT_V1'* ]]; then
  if [[ "$*" == *'--dbname ksy_deals_restore'* && "${KSY_TEST_FORMAT_ROWS_BAD:-0}" == 1 ]]; then printf '2\n'; else printf '1\n'; fi
elif [[ "$*" == *'KSY_DEAL_POST_FORMAT_V1'* ]]; then
  if [[ "$*" == *'--dbname ksy_deals_restore'* && "${KSY_TEST_FORMAT_MISMATCH:-0}" == 1 ]]; then
    printf '666f726d61742d4f4e455f4c494e45\n'
  else
    printf '666f726d61742d54485245455f4c494e4553\n'
  fi
elif [[ "$*" == *'--command SELECT (SELECT COUNT('* ]]; then
  if [[ "$*" == *'--dbname ksy_deals_restore'* && "${KSY_TEST_COUNT_MISMATCH:-0}" == 1 ]]; then printf '136|161\n'; else printf '136|162\n'; fi
fi
STUB
  chmod +x "$case_dir/bin/docker"
  : > "$case_dir/docker.calls"
  : > "$case_dir/live-observation.reads"
}

run_case() {
  local case_dir=$1 output=$2
  PATH="$case_dir/bin:$PATH" TMPDIR="$case_dir" KSY_RESTORE_TEST_MODE=1 \
    KSY_ROOT="$case_dir/opt/ksy-deals" DOCKER_CALLS="$case_dir/docker.calls" \
    RESTORE_EXISTS="$case_dir/restore.exists" \
    LIVE_OBSERVATION_READS="$case_dir/live-observation.reads" \
    bash "$SCRIPT" > "$output" 2>&1
}

assert_no_sensitive_output() {
  local output=$1
  ! grep -Eiq 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|postgres(ql)?://|raw-secret|private diagnostic|DATABASE_URL|BACKUP_ENCRYPTION_PASSPHRASE' "$output" ||
    fail 'sensitive restore evidence leaked'
}

test_restores_complete_snapshot_and_drops_owned_database() {
  local case_dir="$TMP_DIR/success" output="$TMP_DIR/success.out"
  make_case "$case_dir"
  run_case "$case_dir" "$output" || { cat "$output" >&2; fail 'success case failed'; }
  grep -q '^KSY_RESTORE_ACCEPTED file=ksy-deals-20260816T010000Z.dump.gpg bytes=9 editions=136 observations=162 fingerprints=MATCH migrations=MATCH postFormat=MATCH liveStable=PASS drop=PASS$' "$output" ||
    fail 'complete acceptance evidence missing'
  [[ ! -e "$case_dir/restore.exists" ]] || fail 'disposable database remains'
  grep -q 'CREATE DATABASE ksy_deals_restore' "$case_dir/docker.calls" || fail 'restore database not created'
  [[ "$(grep -c 'DROP DATABASE ksy_deals_restore WITH (FORCE)' "$case_dir/docker.calls")" == 1 ]] || fail 'owned database was not dropped exactly once'
  for marker in KSY_RESTORE_RUNNER_V3 KSY_FULL_GAME_EDITIONS_V1 KSY_FULL_PRICE_OBSERVATIONS_V1 KSY_SCHEMA_MIGRATIONS_V1 KSY_DEAL_POST_FORMAT_V1; do
    grep -q "$marker" "$case_dir/docker.calls" || fail "$marker missing"
  done
  grep -q 'pg_restore --list "$archive"' "$case_dir/docker.calls" || fail 'real archive TOC stage missing'
  grep -q -- '--passphrase-fd 0' "$case_dir/docker.calls" || fail 'private passphrase fd missing'
  ! grep -Fq 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@db' "$case_dir/docker.calls" || fail 'database password reached argv'
  ! grep -Fq 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' "$case_dir/docker.calls" || fail 'passphrase reached argv'
  assert_no_sensitive_output "$output"
  [[ -z "$(find "$case_dir" -maxdepth 1 -name 'ksy-restore-diagnostic.*' -print -quit)" ]] || fail 'diagnostic file survived success'
}

expect_stage_failure() {
  local status=$1 reason=$2
  local case_dir="$TMP_DIR/stage-$status" output="$TMP_DIR/stage-$status.out"
  make_case "$case_dir"
  KSY_TEST_STAGE_STATUS=$status
  export KSY_TEST_STAGE_STATUS
  if run_case "$case_dir" "$output"; then
    unset KSY_TEST_STAGE_STATUS
    fail "stage $status unexpectedly passed"
  fi
  unset KSY_TEST_STAGE_STATUS
  grep -q "^KSY_RESTORE_ACCEPT_FAILED $reason$" "$output" || { cat "$output" >&2; fail "stage $status returned wrong class"; }
  assert_no_sensitive_output "$output"
  [[ ! -e "$case_dir/restore.exists" ]] || fail "stage $status left disposable database"
  [[ -z "$(find "$case_dir" -maxdepth 1 -name 'ksy-restore-diagnostic.*' -print -quit)" ]] || fail "stage $status left diagnostic file"
}

expect_verification_failure() {
  local name=$1 knob=$2 reason=$3
  local case_dir="$TMP_DIR/$name" output="$TMP_DIR/$name.out"
  make_case "$case_dir"
  printf -v "$knob" '%s' 1
  export "$knob"
  if run_case "$case_dir" "$output"; then
    unset "$knob"
    fail "$name unexpectedly passed"
  fi
  unset "$knob"
  grep -q "^KSY_RESTORE_ACCEPT_FAILED $reason$" "$output" || { cat "$output" >&2; fail "$name returned wrong failure"; }
  [[ ! -e "$case_dir/restore.exists" ]] || fail "$name left disposable database"
  assert_no_sensitive_output "$output"
}

test_rejects_existing_restore_without_dropping_it() {
  local case_dir="$TMP_DIR/existing" output="$TMP_DIR/existing.out"
  make_case "$case_dir"
  : > "$case_dir/restore.exists"
  if run_case "$case_dir" "$output"; then fail 'existing restore database passed'; fi
  grep -q '^KSY_RESTORE_ACCEPT_FAILED RESTORE_DATABASE_ALREADY_EXISTS$' "$output" || fail 'wrong existing-db failure'
  [[ -e "$case_dir/restore.exists" ]] || fail 'pre-existing restore database was dropped'
  ! grep -q 'DROP DATABASE' "$case_dir/docker.calls" || fail 'drop ran for pre-existing database'
}

test_cleanup_failure_is_safe_and_visible() {
  local case_dir="$TMP_DIR/cleanup" output="$TMP_DIR/cleanup.out"
  make_case "$case_dir"
  KSY_TEST_CLEANUP_FAIL=1
  export KSY_TEST_CLEANUP_FAIL
  if run_case "$case_dir" "$output"; then
    unset KSY_TEST_CLEANUP_FAIL
    fail 'cleanup failure passed'
  fi
  unset KSY_TEST_CLEANUP_FAIL
  grep -q '^KSY_RESTORE_ACCEPT_FAILED CLEANUP_FAILED$' "$output" || fail 'cleanup failure class missing'
  assert_no_sensitive_output "$output"
}

test_rejects_ambiguous_newest_backup_before_database_access() {
  local case_dir="$TMP_DIR/ambiguous" output="$TMP_DIR/ambiguous.out"
  make_case "$case_dir"
  printf 'encrypted-2' > "$case_dir/backups/ksy-deals-20260816T020000Z.dump.gpg"
  touch -t 202608160300 "$case_dir/backups/ksy-deals-20260816T010000Z.dump.gpg" "$case_dir/backups/ksy-deals-20260816T020000Z.dump.gpg"
  if run_case "$case_dir" "$output"; then fail 'ambiguous latest backup passed'; fi
  grep -q '^KSY_RESTORE_ACCEPT_FAILED BACKUP_NEWEST_AMBIGUOUS$' "$output" || fail 'wrong ambiguity failure'
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'database touched after backup rejection'
}

test_static_target_safety() {
  ! grep -Eiq 'DROP DATABASE ksy_deals([^_]|$)|--dbname[ =]+ksy_deals([^_]|$).*(pg_restore|restore)|TRUNCATE|ALTER DATABASE ksy_deals' "$SCRIPT" ||
    fail 'live database appears in a mutation target'
}

test_static_post_format_invariant() {
  grep -Fq "bool_and(singleton AND format IN ('ONE_LINE','TWO_LINES','THREE_LINES'))" "$SCRIPT" ||
    fail 'restore snapshot does not validate the complete post-format singleton enum'
}

test_restores_complete_snapshot_and_drops_owned_database
expect_stage_failure 41 DECRYPTION_FAILED
expect_stage_failure 42 ARCHIVE_TOC_FAILED
expect_stage_failure 43 DATABASE_CONNECTION_FAILED
expect_stage_failure 44 PG_RESTORE_FAILED
expect_stage_failure 70 RESTORE_TOOL_FAILED
expect_verification_failure count-mismatch KSY_TEST_COUNT_MISMATCH VERIFICATION_FAILED
expect_verification_failure row-mismatch KSY_TEST_ROW_MISMATCH VERIFICATION_FAILED
expect_verification_failure migration-mismatch KSY_TEST_MIGRATION_MISMATCH VERIFICATION_FAILED
expect_verification_failure format-mismatch KSY_TEST_FORMAT_MISMATCH VERIFICATION_FAILED
expect_verification_failure format-rows KSY_TEST_FORMAT_ROWS_BAD VERIFICATION_FAILED
expect_verification_failure live-changed KSY_TEST_LIVE_CHANGED LIVE_CHANGED_DURING_RESTORE
test_rejects_existing_restore_without_dropping_it
test_cleanup_failure_is_safe_and_visible
test_rejects_ambiguous_newest_backup_before_database_access
test_static_target_safety
test_static_post_format_invariant
bash -n "$SCRIPT"
printf 'KSY restore acceptance tests passed\n'
