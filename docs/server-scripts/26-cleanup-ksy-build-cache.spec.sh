#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/26-cleanup-ksy-build-cache.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

current_image=ghcr.io/fedrbodr/ksy-deals@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
rollback_image=ghcr.io/fedrbodr/ksy-deals@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
historical_image=ghcr.io/fedrbodr/ksy-deals@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc

make_case() {
  local case_dir=$1
  mkdir -p "$case_dir/opt/ksy-deals" "$case_dir/backups" "$case_dir/bin"
  cat > "$case_dir/opt/ksy-deals/deployment-evidence.json" <<JSON
{"image":"$current_image","rollbackImage":"$rollback_image"}
JSON
  cat > "$case_dir/opt/ksy-deals/.env" <<ENV
KSY_DEALS_BACKUP_DIR=$case_dir/backups
ENV
  cat > "$case_dir/b2.env" <<'ENV'
B2_ACCOUNT_ID=synthetic-b2-account-secret
B2_APP_KEY=synthetic-b2-application-secret
B2_BUCKET=synthetic-ksy-bucket
ENV
  chmod 600 "$case_dir/opt/ksy-deals/deployment-evidence.json" \
    "$case_dir/opt/ksy-deals/.env" "$case_dir/b2.env"
  printf 'encrypted-synthetic-backup-content\n' > \
    "$case_dir/backups/ksy-deals-20260829T120000Z.dump.gpg"

  cat > "$case_dir/bin/df" <<'STUB'
#!/usr/bin/env bash
if [[ -e "$PRUNE_MARKER" ]]; then
  if [[ "${KSY_TEST_POST_DISK_81:-0}" == 1 ]]; then used=81; else used=79; fi
else
  used=85
fi
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf '/dev/sda1 1 1 1 %s%% /\n' "$used"
STUB

  cat > "$case_dir/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_CALLS"
if [[ "$*" == 'builder prune --all --force' ]]; then
  : > "$PRUNE_MARKER"
elif [[ "$*" == 'builder du --format {{.ID}}' ]]; then
  for number in $(seq 1 33); do printf 'cache-%s\n' "$number"; done
elif [[ "$*" == 'system df --format {{.Type}}|{{.Reclaimable}}' ]]; then
  printf 'Build Cache|4.696GB (25%%)\n'
elif [[ "$1 $2" == 'image inspect' ]]; then
  if [[ "${KSY_TEST_MISSING_IMAGE:-0}" == 1 && "$3" == *cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc ]]; then
    exit 1
  fi
elif [[ "$*" == *'ksy-deals-server-1'* && "$*" == *'RestartCount'* ]]; then
  if [[ "${KSY_TEST_UNHEALTHY:-0}" == 1 ]]; then printf '1|true|unhealthy\n'; else printf '0|false|healthy\n'; fi
elif [[ "$*" == *'ksy-deals-db-1'* && "$*" == *'RestartCount'* ]]; then
  if [[ "${KSY_TEST_UNHEALTHY:-0}" == 1 ]]; then printf '1|true|unhealthy\n'; else printf '0|false|healthy\n'; fi
elif [[ "$*" == *'ksy-deals-db-1'* && "$*" == *'Mounts'* ]]; then
  if [[ "${KSY_TEST_BAD_VOLUME:-0}" == 1 ]]; then
    printf 'volume|wrong-volume|/var/lib/postgresql/data|true\n'
  else
    printf 'volume|ksy-deals_postgres-data|/var/lib/postgresql/data|true\n'
  fi
fi
STUB

  cat > "$case_dir/bin/curl" <<'STUB'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *127.0.0.1:4300* ]]; then exit 0; fi
if [[ "${KSY_TEST_ROUTE_FAIL:-0}" == 1 ]]; then printf '500'; exit 0; fi
case "$args" in
  *ksy-deals.fedrbodr.com*) printf '200' ;;
  *vezdepost.ru/assets/vezdepost-og.png*) printf '200' ;;
  *app.vezdepost.ru/api/user/self*) printf '401' ;;
  *https://vezdepost.ru/*) printf '200' ;;
  *) exit 1 ;;
esac
STUB

  cat > "$case_dir/bin/rclone" <<'STUB'
#!/usr/bin/env bash
[[ -z "${B2_ACCOUNT_ID:-}" && -z "${B2_APP_KEY:-}" ]] && exit 90
[[ "${KSY_TEST_OFFSITE_MISSING:-0}" != 1 ]] || exit 0
printf 'ksy-deals-20260829T120000Z.dump.gpg\n'
STUB

  chmod +x "$case_dir/bin/df" "$case_dir/bin/docker" "$case_dir/bin/curl" "$case_dir/bin/rclone"
  : > "$case_dir/docker.calls"
}

run_case() {
  local case_dir=$1 output=$2
  shift 2
  env PATH="$case_dir/bin:$PATH" KSY_CLEANUP_TEST_MODE=1 \
    KSY_ROOT="$case_dir/opt/ksy-deals" \
    KSY_CLEANUP_B2_ENV_FILE="$case_dir/b2.env" \
    DOCKER_CALLS="$case_dir/docker.calls" PRUNE_MARKER="$case_dir/pruned" \
    "$@" bash "$SCRIPT" --confirm PRUNE_BUILDKIT_CACHE \
      --protect-image "$historical_image" > "$output" 2>&1
}

expect_failure() {
  local name=$1 knob=$2 reason=$3
  local case_dir="$TMP_DIR/$name" output="$TMP_DIR/$name.out"
  make_case "$case_dir"
  if [[ "$knob" == DELETE_LOCAL_BACKUP ]]; then
    rm "$case_dir/backups/ksy-deals-20260829T120000Z.dump.gpg"
    knob=''
  elif [[ "$knob" == BAD_EVIDENCE ]]; then
    printf '{invalid\n' > "$case_dir/opt/ksy-deals/deployment-evidence.json"
    knob=''
  fi
  if [[ -n "$knob" ]]; then
    if run_case "$case_dir" "$output" "$knob=1"; then fail "$name unexpectedly passed"; fi
  elif run_case "$case_dir" "$output"; then
    fail "$name unexpectedly passed"
  fi
  grep -q "KSY_BUILD_CACHE_CLEANUP_FAILED $reason" "$output" || {
    cat "$output" >&2
    fail "$name returned the wrong failure"
  }
  if [[ "$reason" != DISK_TARGET_NOT_REACHED ]]; then
    [[ ! -e "$case_dir/pruned" ]] || fail "$name pruned before its preflight gate"
  fi
}

test_requires_explicit_confirmation() {
  local case_dir="$TMP_DIR/confirm" output="$TMP_DIR/confirm.out"
  make_case "$case_dir"
  if PATH="$case_dir/bin:$PATH" KSY_CLEANUP_TEST_MODE=1 \
    KSY_ROOT="$case_dir/opt/ksy-deals" KSY_CLEANUP_B2_ENV_FILE="$case_dir/b2.env" \
    DOCKER_CALLS="$case_dir/docker.calls" PRUNE_MARKER="$case_dir/pruned" \
    bash "$SCRIPT" > "$output" 2>&1; then
    fail 'missing confirmation passed'
  fi
  grep -q 'KSY_BUILD_CACHE_CLEANUP_FAILED CONFIRMATION_REQUIRED' "$output" ||
    fail 'wrong confirmation failure'
  [[ ! -e "$case_dir/pruned" ]] || fail 'missing confirmation pruned cache'
}

test_cleans_only_build_cache_without_leaking_secrets() {
  local case_dir="$TMP_DIR/success" output="$TMP_DIR/success.out"
  make_case "$case_dir"
  run_case "$case_dir" "$output" || { cat "$output" >&2; fail 'success case failed'; }
  grep -q 'KSY_BUILD_CACHE_CLEANUP before=85 after=79 cache_records=33 physical_reclaimable=4.696GB protected_images=3 postgres_volume=PASS local_backup=PASS offsite_backup=PASS health=PASS routes=PASS' "$output" ||
    fail 'redacted cleanup evidence missing'
  [[ "$(grep -c '^builder prune --all --force$' "$case_dir/docker.calls")" == 1 ]] ||
    fail 'expected exactly one BuildKit prune'
  for forbidden in 'system prune' 'image prune' 'container prune' 'network prune' \
    'volume prune' 'volume rm' 'image rm' 'rm -f'; do
    ! grep -Fq "$forbidden" "$case_dir/docker.calls" || fail "forbidden Docker operation: $forbidden"
  done
  for secret in synthetic-b2-account-secret synthetic-b2-application-secret \
    synthetic-ksy-bucket encrypted-synthetic-backup-content; do
    ! grep -Fq "$secret" "$output" || fail "secret or backup content leaked: $secret"
    ! grep -Fq "$secret" "$case_dir/docker.calls" || fail "secret reached Docker argv: $secret"
  done
}

test_requires_explicit_confirmation
expect_failure bad-evidence BAD_EVIDENCE DEPLOYMENT_EVIDENCE_INVALID
expect_failure missing-image KSY_TEST_MISSING_IMAGE PROTECTED_IMAGE_MISSING
expect_failure bad-volume KSY_TEST_BAD_VOLUME POSTGRES_VOLUME_INVALID
expect_failure unhealthy KSY_TEST_UNHEALTHY CONTAINER_STATE_UNHEALTHY
expect_failure local-backup DELETE_LOCAL_BACKUP LOCAL_BACKUP_MISSING
expect_failure offsite KSY_TEST_OFFSITE_MISSING OFFSITE_BACKUP_MISSING
expect_failure route KSY_TEST_ROUTE_FAIL ROUTE_PREFLIGHT_FAILED
expect_failure post-disk KSY_TEST_POST_DISK_81 DISK_TARGET_NOT_REACHED
test_cleans_only_build_cache_without_leaking_secrets
bash -n "$SCRIPT"
printf 'KSY build-cache cleanup tests passed\n'
