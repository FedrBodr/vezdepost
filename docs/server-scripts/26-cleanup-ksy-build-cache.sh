#!/usr/bin/env bash
# Remove only rebuildable BuildKit cache after proving KSY production invariants.
set -euo pipefail
umask 077

KSY_ROOT=${KSY_ROOT:-/opt/ksy-deals}
EVIDENCE_FILE=${KSY_CLEANUP_EVIDENCE_FILE:-$KSY_ROOT/deployment-evidence.json}
KSY_ENV_FILE=${KSY_CLEANUP_ENV_FILE:-$KSY_ROOT/.env}
B2_ENV_FILE=${KSY_CLEANUP_B2_ENV_FILE:-/root/vezdepost-backup.env}
TEST_MODE=${KSY_CLEANUP_TEST_MODE:-0}
DISK_TARGET=${KSY_CLEANUP_DISK_TARGET:-80}
CONFIRM=''
protected=()

fail() {
  printf 'KSY_BUILD_CACHE_CLEANUP_FAILED %s\n' "$1" >&2
  exit 1
}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

while (($#)); do
  case "$1" in
    --confirm)
      [[ $# -ge 2 && -z "$CONFIRM" ]] || fail ARGUMENTS_INVALID
      CONFIRM=$2
      shift 2
      ;;
    --protect-image)
      [[ $# -ge 2 ]] || fail ARGUMENTS_INVALID
      protected+=("$2")
      shift 2
      ;;
    *) fail ARGUMENTS_INVALID ;;
  esac
done

[[ "$CONFIRM" == PRUNE_BUILDKIT_CACHE ]] || fail CONFIRMATION_REQUIRED
[[ "$TEST_MODE" == 1 || $EUID -eq 0 ]] || fail ROOT_REQUIRED
[[ "$DISK_TARGET" =~ ^[0-9]+$ && "$DISK_TARGET" -le 80 ]] || fail DISK_TARGET_INVALID

for required in "$EVIDENCE_FILE" "$KSY_ENV_FILE" "$B2_ENV_FILE"; do
  [[ -f "$required" && ! -L "$required" && "$(file_mode "$required")" == 600 ]] ||
    fail CONFIGURATION_FILE_INVALID
  if [[ "$TEST_MODE" != 1 ]]; then
    [[ "$(stat -c '%U:%G' "$required")" == root:root ]] || fail CONFIGURATION_OWNER_INVALID
  fi
done

evidence_output=$(jq -er '.image, .rollbackImage' "$EVIDENCE_FILE" 2>/dev/null) ||
  fail DEPLOYMENT_EVIDENCE_INVALID
evidence_images=()
while IFS= read -r image; do
  evidence_images+=("$image")
done <<< "$evidence_output"
[[ ${#evidence_images[@]} == 2 ]] || fail DEPLOYMENT_EVIDENCE_INVALID
protected=("${evidence_images[@]}" "${protected[@]}")

unique_protected=()
for image in "${protected[@]}"; do
  duplicate=0
  [[ "$image" =~ ^ghcr\.io/fedrbodr/ksy-deals@sha256:[a-f0-9]{64}$ ]] ||
    fail PROTECTED_IMAGE_INVALID
  if [[ ${unique_protected[0]+present} ]]; then
    for existing_image in "${unique_protected[@]}"; do
      if [[ "$existing_image" == "$image" ]]; then
        duplicate=1
        break
      fi
    done
  fi
  if [[ "$duplicate" == 0 ]]; then
    unique_protected+=("$image")
  fi
done
protected=("${unique_protected[@]}")

disk_used_percent() {
  df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }'
}

verify_images() {
  local image
  for image in "${protected[@]}"; do
    docker image inspect "$image" >/dev/null 2>&1 || fail PROTECTED_IMAGE_MISSING
  done
}

verify_volume() {
  local mount
  mount=$(docker inspect --format '{{range .Mounts}}{{.Type}}|{{.Name}}|{{.Destination}}|{{.RW}}{{end}}' \
    ksy-deals-db-1 2>/dev/null) || fail POSTGRES_VOLUME_INVALID
  [[ "$mount" == 'volume|ksy-deals_postgres-data|/var/lib/postgresql/data|true' ]] ||
    fail POSTGRES_VOLUME_INVALID
}

verify_health() {
  local server_state db_state
  server_state=$(docker inspect --format '{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.Health.Status}}' \
    ksy-deals-server-1 2>/dev/null) || fail CONTAINER_STATE_UNHEALTHY
  db_state=$(docker inspect --format '{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.Health.Status}}' \
    ksy-deals-db-1 2>/dev/null) || fail CONTAINER_STATE_UNHEALTHY
  [[ "$server_state" == '0|false|healthy' && "$db_state" == '0|false|healthy' ]] ||
    fail CONTAINER_STATE_UNHEALTHY
}

verify_routes() {
  curl --fail --silent --show-error --max-time 20 \
    http://127.0.0.1:4300/health/live >/dev/null || fail ROUTE_PREFLIGHT_FAILED
  curl --fail --silent --show-error --max-time 20 \
    http://127.0.0.1:4300/health/ready >/dev/null || fail ROUTE_PREFLIGHT_FAILED
  [[ "$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 20 \
    https://ksy-deals.fedrbodr.com/)" == 200 ]] || fail ROUTE_PREFLIGHT_FAILED
  [[ "$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 20 \
    https://vezdepost.ru/)" == 200 ]] || fail ROUTE_PREFLIGHT_FAILED
  [[ "$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 20 \
    https://vezdepost.ru/assets/vezdepost-og.png)" == 200 ]] || fail ROUTE_PREFLIGHT_FAILED
  [[ "$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 20 \
    https://app.vezdepost.ru/api/user/self)" == 401 ]] || fail ROUTE_PREFLIGHT_FAILED
}

verify_backup() {
  local newest='' newest_mtime=-1 newest_ties=0 candidate candidate_mtime offsite

  set -a
  # shellcheck disable=SC1090
  . "$KSY_ENV_FILE"
  # shellcheck disable=SC1090
  . "$B2_ENV_FILE"
  set +a
  [[ "${KSY_DEALS_BACKUP_DIR:-}" == /* && -d "$KSY_DEALS_BACKUP_DIR" ]] ||
    fail LOCAL_BACKUP_MISSING
  [[ -n "${B2_ACCOUNT_ID:-}" && -n "${B2_APP_KEY:-}" && "${B2_BUCKET:-}" =~ ^[A-Za-z0-9.-]+$ ]] ||
    fail OFFSITE_BACKUP_MISSING

  shopt -s nullglob
  candidates=("$KSY_DEALS_BACKUP_DIR"/ksy-deals-*.dump.gpg)
  shopt -u nullglob
  [[ ${#candidates[@]} -gt 0 ]] || fail LOCAL_BACKUP_MISSING
  for candidate in "${candidates[@]}"; do
    [[ -f "$candidate" && ! -L "$candidate" && -s "$candidate" ]] || fail LOCAL_BACKUP_MISSING
    basename "$candidate" | grep -Eq '^ksy-deals-[0-9]{8}T[0-9]{6}Z\.dump\.gpg$' ||
      fail LOCAL_BACKUP_MISSING
    candidate_mtime=$(stat -c '%Y' "$candidate" 2>/dev/null || stat -f '%m' "$candidate")
    [[ "$candidate_mtime" =~ ^[0-9]+$ ]] || fail LOCAL_BACKUP_MISSING
    if ((candidate_mtime > newest_mtime)); then
      newest=$candidate
      newest_mtime=$candidate_mtime
      newest_ties=1
    elif ((candidate_mtime == newest_mtime)); then
      newest_ties=$((newest_ties + 1))
    fi
  done
  [[ "$newest_ties" == 1 ]] || fail LOCAL_BACKUP_MISSING
  backup_name=$(basename "$newest")

  export RCLONE_CONFIG_B2_TYPE=b2
  export RCLONE_CONFIG_B2_ACCOUNT="$B2_ACCOUNT_ID"
  export RCLONE_CONFIG_B2_KEY="$B2_APP_KEY"
  offsite=$(rclone lsf "B2:$B2_BUCKET/ksy-deals/" --files-only --include "$backup_name" 2>/dev/null) || {
    unset DATABASE_URL BACKUP_ENCRYPTION_PASSPHRASE B2_ACCOUNT_ID B2_APP_KEY \
      RCLONE_CONFIG_B2_TYPE RCLONE_CONFIG_B2_ACCOUNT RCLONE_CONFIG_B2_KEY
    fail OFFSITE_BACKUP_MISSING
  }
  unset DATABASE_URL BACKUP_ENCRYPTION_PASSPHRASE B2_ACCOUNT_ID B2_APP_KEY \
    RCLONE_CONFIG_B2_TYPE RCLONE_CONFIG_B2_ACCOUNT RCLONE_CONFIG_B2_KEY
  [[ "$offsite" == "$backup_name" ]] || fail OFFSITE_BACKUP_MISSING
}

verify_invariants() {
  verify_images
  verify_volume
  verify_health
  verify_routes
  verify_backup
}

before=$(disk_used_percent)
[[ "$before" =~ ^[0-9]+$ ]] || fail DISK_USAGE_INVALID
[[ "$before" -gt "$DISK_TARGET" ]] || fail DISK_CLEANUP_NOT_REQUIRED

verify_invariants
cache_records=$(docker builder du --format '{{.ID}}' | sed '/^$/d' | wc -l | tr -d ' ')
physical_reclaimable=$(docker system df --format '{{.Type}}|{{.Reclaimable}}' |
  awk -F'|' '$1 == "Build Cache" { split($2, value, " "); print value[1]; exit }')
[[ "$cache_records" =~ ^[0-9]+$ && "$cache_records" -gt 0 && -n "$physical_reclaimable" ]] ||
  fail BUILD_CACHE_EVIDENCE_INVALID

docker builder prune --all --force >/dev/null

verify_invariants
after=$(disk_used_percent)
[[ "$after" =~ ^[0-9]+$ ]] || fail DISK_USAGE_INVALID
[[ "$after" -le "$DISK_TARGET" ]] || fail DISK_TARGET_NOT_REACHED

printf 'KSY_BUILD_CACHE_CLEANUP before=%s after=%s cache_records=%s physical_reclaimable=%s protected_images=%s postgres_volume=PASS local_backup=PASS offsite_backup=PASS health=PASS routes=PASS\n' \
  "$before" "$after" "$cache_records" "$physical_reclaimable" "${#protected[@]}"
