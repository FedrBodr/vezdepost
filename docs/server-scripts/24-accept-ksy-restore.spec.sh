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
printf '%s\n' "$*" >> "$DOCKER_CALLS"
if [[ "$*" == *'CREATE DATABASE ksy_deals_restore'* ]]; then
  [[ ! -e "$RESTORE_EXISTS" ]] || exit 3
  : > "$RESTORE_EXISTS"
elif [[ "$*" == *'DROP DATABASE ksy_deals_restore WITH (FORCE)'* ]]; then
  rm -f "$RESTORE_EXISTS"
elif [[ "$*" == *'SELECT 1 FROM pg_database'* ]]; then
  [[ -e "$RESTORE_EXISTS" ]] && printf '1\n' || true
elif [[ "$*" == *'infra/scripts/restore.sh'* ]]; then
  [[ "${RESTORE_DATABASE_URL:-}" == postgresql://ksy_deals:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@db:5432/ksy_deals_restore ]] || exit 4
  [[ "${BACKUP_FILE:-}" == /backups/ksy-deals-20260816T010000Z.dump.gpg ]] || exit 5
  [[ "${RESTORE_CONFIRM:-}" == RESTORE_KSY_DEALS_DISPOSABLE ]] || exit 6
  if [[ -n "${KSY_TEST_RESTORE_ERROR:-}" ]]; then
    case "$KSY_TEST_RESTORE_ERROR" in
      decrypt) printf 'gpg: decryption failed: Bad session key\n' >&2 ;;
      archive) printf 'pg_restore: error: input file does not appear to be a valid archive\n' >&2 ;;
      connect) printf 'pg_restore: error: connection to server at db failed\n' >&2 ;;
      apply) printf 'pg_restore: error: could not execute query: ERROR: synthetic failure\n' >&2 ;;
      mount) printf 'BACKUP_FILE is not a regular file\n' >&2 ;;
      target) printf 'restore database must end with _restore\n' >&2 ;;
      tooling) printf '/bin/sh: infra/scripts/restore.sh: not found\n' >&2 ;;
      shell) printf 'infra/scripts/restore.sh: set: line 3: illegal option -o pipefail\n' >&2 ;;
      pg-generic) printf 'gpg: AES256.CFB encrypted data\npg_restore: error: synthetic pg failure\n' >&2 ;;
      pg-interleaved) printf 'gpg: AES256.CFB encrypted datapg_restore: error: synthetic pg failure\n' >&2 ;;
      gpg-pipe) printf 'gpg: [stdout]: write error: Broken pipe\n' >&2 ;;
      gpg-tty) printf 'gpg: cannot open /dev/tty: No such device or address\n' >&2 ;;
      gpg-format) printf 'gpg: no valid OpenPGP data found\n' >&2 ;;
      gpg-runtime) printf 'gpg: problem with the agent: General error\n' >&2 ;;
      gpg-output) printf 'gpg: handle plaintext failed: General error\n' >&2 ;;
      gpg-kdf) printf 'gpg: key derivation failed: Invalid value\n' >&2 ;;
      gpg-integrity) printf 'gpg: WARNING: message was not integrity protected\n' >&2 ;;
      gpg-generic) printf 'gpg: AES256.CFB encrypted data\ngpg: synthetic category\n' >&2 ;;
      unknown) printf 'synthetic unclassified failure\n' >&2 ;;
    esac
    exit 7
  fi
  [[ "${KSY_TEST_RESTORE_FAIL:-0}" != 1 ]] || exit 7
elif [[ "$*" == *'SELECT o.id'* ]]; then
  if [[ "$*" == *'--dbname ksy_deals_restore'* && "${KSY_TEST_ID_MISMATCH:-0}" == 1 ]]; then
    printf 'observation-a\nobservation-c\n'
  elif [[ "$*" == *'--dbname ksy_deals_restore'* && "${KSY_TEST_ONE_ID:-0}" == 1 ]]; then
    printf 'observation-a\n'
  else
    printf 'observation-a\nobservation-b\n'
  fi
elif [[ "$*" == *'--command SELECT (SELECT COUNT('* ]]; then
  if [[ "$*" == *'--dbname ksy_deals_restore'* && "${KSY_TEST_BAD_RESTORE_COUNTS:-0}" == 1 ]]; then printf '3|2\n'; else printf '2|2\n'; fi
fi
STUB
  chmod +x "$case_dir/bin/docker"
  : > "$case_dir/docker.calls"
}

run_case() {
  local case_dir=$1 output=$2
  PATH="$case_dir/bin:$PATH" KSY_RESTORE_TEST_MODE=1 KSY_ROOT="$case_dir/opt/ksy-deals" \
    DOCKER_CALLS="$case_dir/docker.calls" RESTORE_EXISTS="$case_dir/restore.exists" \
    bash "$SCRIPT" > "$output" 2>&1
}

test_restores_verifies_and_drops_without_secret_leaks() {
  local case_dir="$TMP_DIR/success" output="$TMP_DIR/success.out"
  make_case "$case_dir"
  run_case "$case_dir" "$output" || { cat "$output" >&2; fail 'success case failed'; }
  grep -q 'KSY_RESTORE_ACCEPTED file=ksy-deals-20260816T010000Z.dump.gpg bytes=9 editions=2 observations=2 identities=MATCH drop=PASS' "$output" || fail 'acceptance evidence missing'
  [[ ! -e "$case_dir/restore.exists" ]] || fail 'disposable database remains'
  grep -q 'CREATE DATABASE ksy_deals_restore' "$case_dir/docker.calls" || fail 'restore database not created'
  grep -q 'DROP DATABASE ksy_deals_restore WITH (FORCE)' "$case_dir/docker.calls" || fail 'restore database not dropped'
  grep -q -- '--dbname ksy_deals --no-psqlrc --tuples-only --no-align --command SELECT o.id' "$case_dir/docker.calls" || fail 'live identities not read'
  grep -q -- '--dbname ksy_deals_restore --no-psqlrc --tuples-only --no-align --command SELECT o.id' "$case_dir/docker.calls" || fail 'restore identities not read'
  grep -q 'run --rm --no-deps -e RESTORE_DATABASE_URL -e BACKUP_FILE -e RESTORE_CONFIRM backup /bin/sh infra/scripts/restore.sh' "$case_dir/docker.calls" || fail 'image-contained restore missing'
  for secret in aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb postgresql://; do
    ! grep -Fq "$secret" "$output" || fail "secret leaked to output: $secret"
    ! grep -Fq "$secret" "$case_dir/docker.calls" || fail "secret reached argv: $secret"
  done
}

test_failure_still_drops_disposable_database() {
  local case_dir="$TMP_DIR/failure" output="$TMP_DIR/failure.out"
  make_case "$case_dir"
  if KSY_TEST_RESTORE_FAIL=1 run_case "$case_dir" "$output"; then fail 'failed restore passed'; fi
  [[ ! -e "$case_dir/restore.exists" ]] || fail 'failed restore left database'
  grep -q 'KSY_RESTORE_ACCEPT_FAILED RESTORE_FAILED_UNKNOWN' "$output" || fail 'wrong restore failure'
}

test_redacts_and_classifies_restore_errors() {
  local error expected case_dir output
  for error in decrypt archive connect apply mount target tooling shell pg-generic pg-interleaved gpg-pipe gpg-tty gpg-format gpg-runtime gpg-output gpg-kdf gpg-integrity gpg-generic unknown; do
    case "$error" in
      decrypt) expected=RESTORE_DECRYPTION_FAILED ;;
      archive) expected=RESTORE_ARCHIVE_INVALID ;;
      connect) expected=RESTORE_DATABASE_CONNECTION_FAILED ;;
      apply) expected=RESTORE_DATABASE_APPLY_FAILED ;;
      mount) expected=RESTORE_BACKUP_MOUNT_FAILED ;;
      target) expected=RESTORE_TARGET_SAFETY_FAILED ;;
      tooling) expected=RESTORE_TOOLING_FAILED ;;
      shell) expected=RESTORE_SHELL_INCOMPATIBLE ;;
      pg-generic) expected=RESTORE_DATABASE_APPLY_FAILED ;;
      pg-interleaved) expected=RESTORE_DATABASE_APPLY_FAILED ;;
      gpg-pipe) expected=RESTORE_DECRYPTION_PIPE_BROKEN ;;
      gpg-tty) expected=RESTORE_DECRYPTION_NONINTERACTIVE_FAILED ;;
      gpg-format) expected=RESTORE_ENCRYPTED_BACKUP_FORMAT_INVALID ;;
      gpg-runtime) expected=RESTORE_DECRYPTION_RUNTIME_FAILED ;;
      gpg-output) expected=RESTORE_DECRYPTION_OUTPUT_FAILED ;;
      gpg-kdf) expected=RESTORE_DECRYPTION_KDF_FAILED ;;
      gpg-integrity) expected=RESTORE_ENCRYPTED_BACKUP_INTEGRITY_FAILED ;;
      gpg-generic) expected='RESTORE_DECRYPTION_TOOL_FAILED signals=encrypted_data' ;;
      unknown) expected=RESTORE_FAILED_UNKNOWN ;;
    esac
    case_dir="$TMP_DIR/classify-$error"
    output="$TMP_DIR/classify-$error.out"
    make_case "$case_dir"
    if KSY_TEST_RESTORE_ERROR="$error" run_case "$case_dir" "$output"; then
      fail "$error restore failure passed"
    fi
    grep -q "KSY_RESTORE_ACCEPT_FAILED $expected" "$output" || fail "$error classification missing"
    ! grep -Eq 'Bad session key|synthetic failure|connection to server|valid archive|not a regular file|not found|unclassified' "$output" ||
      fail "$error diagnostic leaked raw stderr"
    [[ ! -e "$case_dir/restore.exists" ]] || fail "$error failure left disposable database"
  done
}

test_rejects_ambiguous_newest_backup() {
  local case_dir="$TMP_DIR/ambiguous" output="$TMP_DIR/ambiguous.out"
  make_case "$case_dir"
  printf 'encrypted-2' > "$case_dir/backups/ksy-deals-20260816T020000Z.dump.gpg"
  touch -t 202608160300 "$case_dir/backups/ksy-deals-20260816T010000Z.dump.gpg" "$case_dir/backups/ksy-deals-20260816T020000Z.dump.gpg"
  if run_case "$case_dir" "$output"; then fail 'ambiguous latest backup passed'; fi
  grep -q 'KSY_RESTORE_ACCEPT_FAILED BACKUP_NEWEST_AMBIGUOUS' "$output" || fail 'wrong ambiguity failure'
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'database touched after backup rejection'
}

test_rejects_public_env() {
  local case_dir="$TMP_DIR/public" output="$TMP_DIR/public.out"
  make_case "$case_dir"
  chmod 644 "$case_dir/opt/ksy-deals/.env"
  if run_case "$case_dir" "$output"; then fail 'public env passed'; fi
  grep -q 'KSY_RESTORE_ACCEPT_FAILED KSY_ENV_MODE_INVALID' "$output" || fail 'wrong env failure'
}

expect_verification_failure_cleans_up() {
  local name=$1 knob=$2 reason=$3
  local case_dir="$TMP_DIR/$name" output="$TMP_DIR/$name.out"
  make_case "$case_dir"
  if env "$knob=1" PATH="$case_dir/bin:$PATH" KSY_RESTORE_TEST_MODE=1 \
    KSY_ROOT="$case_dir/opt/ksy-deals" DOCKER_CALLS="$case_dir/docker.calls" \
    RESTORE_EXISTS="$case_dir/restore.exists" bash "$SCRIPT" > "$output" 2>&1; then
    fail "$name unexpectedly passed"
  fi
  grep -q "KSY_RESTORE_ACCEPT_FAILED $reason" "$output" || fail "$name returned wrong failure"
  [[ ! -e "$case_dir/restore.exists" ]] || fail "$name left disposable database"
}

test_rejects_existing_restore_without_dropping_it() {
  local case_dir="$TMP_DIR/existing" output="$TMP_DIR/existing.out"
  make_case "$case_dir"
  : > "$case_dir/restore.exists"
  if run_case "$case_dir" "$output"; then fail 'existing restore database passed'; fi
  grep -q 'KSY_RESTORE_ACCEPT_FAILED RESTORE_DATABASE_ALREADY_EXISTS' "$output" || fail 'wrong existing-db failure'
  [[ -e "$case_dir/restore.exists" ]] || fail 'pre-existing restore database was dropped'
  ! grep -q 'DROP DATABASE' "$case_dir/docker.calls" || fail 'drop ran for pre-existing database'
}

test_restores_verifies_and_drops_without_secret_leaks
test_failure_still_drops_disposable_database
test_redacts_and_classifies_restore_errors
test_rejects_ambiguous_newest_backup
test_rejects_public_env
expect_verification_failure_cleans_up bad-counts KSY_TEST_BAD_RESTORE_COUNTS RESTORE_COUNTS_UNEXPECTED
expect_verification_failure_cleans_up one-id KSY_TEST_ONE_ID RESTORE_IDENTITIES_COUNT_UNEXPECTED
expect_verification_failure_cleans_up mismatched-id KSY_TEST_ID_MISMATCH RESTORE_IDENTITIES_MISMATCH
test_rejects_existing_restore_without_dropping_it
bash -n "$SCRIPT"
printf 'KSY restore acceptance tests passed\n'
