#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/22-install-ksy-backup.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
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
stamp=$(date -u +%Y%m%dT%H%M%SZ)
printf '%s' encrypted-payload > "$KSY_DEALS_BACKUP_DIR/ksy-deals-$stamp.dump.gpg"
STUB
  cat > "$bin_dir/rclone" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$RCLONE_CALLS"
STUB
  chmod +x "$bin_dir/docker" "$bin_dir/rclone"
}

write_envs() {
  local case_dir=$1
  mkdir -p "$case_dir/opt/ksy-deals" "$case_dir/backups" "$case_dir/root"
  cat > "$case_dir/opt/ksy-deals/.env" <<ENV
KSY_DEALS_BACKUP_DIR=$case_dir/backups
DATABASE_URL=postgresql://ksy:database-secret@db:5432/ksy_deals
BACKUP_ENCRYPTION_PASSPHRASE=backup-secret
ENV
  cat > "$case_dir/root/vezdepost-backup.env" <<'ENV'
B2_ACCOUNT_ID=b2-account-secret
B2_APP_KEY=b2-application-secret
B2_BUCKET=vezdepost-pg-backups
ENV
  chmod 600 "$case_dir/opt/ksy-deals/.env" "$case_dir/root/vezdepost-backup.env"
  printf '%s\n' 'services: {}' > "$case_dir/opt/ksy-deals/docker-compose.yml"
}

install_case() {
  local case_dir=$1
  local output=$2
  local bin_dir="$case_dir/bin"
  make_stubs "$bin_dir"
  : > "$case_dir/docker.calls"
  : > "$case_dir/rclone.calls"
  PATH="$bin_dir:$PATH" \
    DOCKER_CALLS="$case_dir/docker.calls" RCLONE_CALLS="$case_dir/rclone.calls" \
    KSY_BACKUP_TEST_MODE=1 \
    KSY_ROOT="$case_dir/opt/ksy-deals" \
    B2_ENV_FILE="$case_dir/root/vezdepost-backup.env" \
    BACKUP_PROGRAM="$case_dir/usr/local/sbin/ksy-deals-backup" \
    CRON_FILE="$case_dir/etc/cron.d/ksy-deals-backup" \
    LOG_FILE="$case_dir/var/log/ksy-deals-backup.log" \
    bash "$SCRIPT" > "$output" 2>&1
}

run_wrapper() {
  local case_dir=$1
  local output=$2
  PATH="$case_dir/bin:$PATH" \
    DOCKER_CALLS="$case_dir/docker.calls" RCLONE_CALLS="$case_dir/rclone.calls" \
    KSY_ROOT="$case_dir/opt/ksy-deals" \
    B2_ENV_FILE="$case_dir/root/vezdepost-backup.env" \
    LOG_FILE="$case_dir/var/log/ksy-deals-backup.log" \
    bash "$case_dir/usr/local/sbin/ksy-deals-backup" > "$output" 2>&1
}

test_rejects_non_private_env_files() {
  local case_dir="$TMP_DIR/public-env"
  local output="$case_dir/output"
  mkdir -p "$case_dir"
  write_envs "$case_dir"
  chmod 644 "$case_dir/opt/ksy-deals/.env"
  if install_case "$case_dir" "$output"; then
    fail 'publicly readable KSY env was accepted'
  fi
  [[ ! -e "$case_dir/usr/local/sbin/ksy-deals-backup" ]] ||
    fail 'backup wrapper was installed after env rejection'
}

test_rejects_placeholder_b2_credentials() {
  local case_dir="$TMP_DIR/placeholder-b2"
  local output="$case_dir/output"
  mkdir -p "$case_dir"
  write_envs "$case_dir"
  sed -i.bak 's/b2-application-secret/REPLACE_WITH_APP_KEY/' \
    "$case_dir/root/vezdepost-backup.env"
  rm -f "$case_dir/root/vezdepost-backup.env.bak"
  chmod 600 "$case_dir/root/vezdepost-backup.env"
  if install_case "$case_dir" "$output"; then
    fail 'placeholder B2 credentials were accepted'
  fi
  [[ ! -e "$case_dir/usr/local/sbin/ksy-deals-backup" ]] ||
    fail 'backup wrapper was installed with placeholder B2 credentials'
}

test_installs_and_uploads_only_encrypted_backup_idempotently() {
  local case_dir="$TMP_DIR/success"
  local output="$case_dir/output"
  mkdir -p "$case_dir"
  write_envs "$case_dir"
  install_case "$case_dir" "$output"
  cp "$case_dir/usr/local/sbin/ksy-deals-backup" "$case_dir/wrapper.before"
  install_case "$case_dir" "$case_dir/output-second"
  cmp -s "$case_dir/wrapper.before" "$case_dir/usr/local/sbin/ksy-deals-backup" ||
    fail 'idempotent install changed the wrapper'

  run_wrapper "$case_dir" "$case_dir/wrapper.output"
  [[ "$(file_mode "$case_dir/usr/local/sbin/ksy-deals-backup")" == 700 ]] ||
    fail 'backup wrapper mode must be 700'
  [[ "$(file_mode "$case_dir/etc/cron.d/ksy-deals-backup")" == 644 ]] ||
    fail 'cron mode must be 644'
  grep -q '^CRON_TZ=Europe/Moscow$' "$case_dir/etc/cron.d/ksy-deals-backup" ||
    fail 'cron timezone is missing'
  grep -q '^37 3 \* \* \* root ' "$case_dir/etc/cron.d/ksy-deals-backup" ||
    fail 'independent daily schedule is missing'
  grep -q '^compose --project-name ksy-deals .* --profile maintenance run --rm backup$' \
    "$case_dir/docker.calls" || fail 'KSY maintenance backup service was not invoked'
  grep -q '^copy .*ksy-deals-.*\.dump\.gpg B2:vezdepost-pg-backups/ksy-deals/ --no-traverse$' \
    "$case_dir/rclone.calls" || fail 'encrypted backup was not uploaded to the KSY prefix'
  ! grep -qE 'copy .*\.(dump|sql|gz) B2:' "$case_dir/rclone.calls" ||
    fail 'an unencrypted backup path reached rclone'
  grep -q '^delete B2:vezdepost-pg-backups/ksy-deals/ --min-age 90d$' \
    "$case_dir/rclone.calls" || fail 'independent remote retention was not applied'

  for secret in database-secret backup-secret b2-account-secret b2-application-secret; do
    ! grep -Fq "$secret" "$output" || fail 'secret leaked from installer'
    ! grep -Fq "$secret" "$case_dir/wrapper.output" || fail 'secret leaked from wrapper'
    ! grep -Fq "$secret" "$case_dir/var/log/ksy-deals-backup.log" ||
      fail 'secret leaked to backup log'
  done
}

test_rejects_non_private_env_files
test_rejects_placeholder_b2_credentials
test_installs_and_uploads_only_encrypted_backup_idempotently
echo 'KSY backup installer tests passed'
