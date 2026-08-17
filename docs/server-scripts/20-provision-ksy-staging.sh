#!/usr/bin/env bash
# Provision the isolated KSY Deals staging stack on the Vezdepost VPS.
# Copy this script and the reviewed KSY Compose file to /tmp, then run the
# script through an interactive SSH TTY. Secret prompts never echo values.
set -euo pipefail
umask 077

KSY_ROOT=${KSY_ROOT:-/opt/ksy-deals}
KSY_BACKUP_DIR=${KSY_BACKUP_DIR:-/var/backups/ksy-deals}
CADDY_SITES_DIR=${CADDY_SITES_DIR:-/etc/caddy/sites}
STAGED_COMPOSE=${STAGED_COMPOSE:-/tmp/ksy-deals-docker-compose.yml}
ENV_FILE="$KSY_ROOT/.env"
COMPOSE_FILE="$KSY_ROOT/docker-compose.yml"
EVIDENCE_FILE="$KSY_ROOT/deployment-evidence.json"
TEST_MODE=${KSY_PROVISION_TEST_MODE:-0}
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

fail() {
  printf 'KSY_PROVISION_FAILED %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 2 && $1 == --image ]] || fail IMAGE_ARGUMENT_REQUIRED
KSY_DEALS_IMAGE=$2

required_keys=(
  VITE_TELEGRAM_BOT_USERNAME GHCR_USERNAME GHCR_READ_TOKEN
  TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET ORDER_TELEGRAM_URL
  ADMIN_TELEGRAM_IDS PLATPRICES_API_KEY POSTGRES_PASSWORD
  SESSION_COOKIE_KEY BACKUP_ENCRYPTION_PASSPHRASE
)

trim_horizontal() {
  local value=$1
  value="${value#"${value%%[!$' \t']*}"}"
  value="${value%"${value##*[!$' \t']}"}"
  TRIMMED_VALUE=$value
}

cleanup_batch() {
  if [[ "${BATCH_ECHO_DISABLED:-0}" == 1 ]]; then
    stty echo <&3 2>/dev/null || true
    BATCH_ECHO_DISABLED=0
  fi
  exec 3>&- 2>/dev/null || true
  rm -rf "$WORK_DIR"
}

read_batch() {
  local input_fd=0
  local line trimmed key value required_key key_allowed
  local terminated=0
  local seen_keys=''

  if [[ "$TEST_MODE" != 1 ]]; then
    exec 3</dev/tty || fail TTY_REQUIRED
    trap cleanup_batch EXIT INT TERM
    stty -echo <&3 || fail TERMINAL_ECHO_DISABLE_FAILED
    BATCH_ECHO_DISABLED=1
    input_fd=3
  fi

  if (( BASH_VERSINFO[0] >= 4 )); then
    declare -A seen=()
  fi

  while IFS= read -r line <&"$input_fd"; do
    trim_horizontal "$line"
    trimmed=$TRIMMED_VALUE
    [[ -z "$trimmed" ]] && continue
    if [[ "$trimmed" == KSY_SECRETS_END ]]; then
      terminated=1
      break
    fi
    [[ "$trimmed" == *=* ]] || fail BATCH_MALFORMED_LINE
    key=${trimmed%%=*}
    value=${trimmed#*=}
    trim_horizontal "$key"
    key=$TRIMMED_VALUE
    trim_horizontal "$value"
    value=$TRIMMED_VALUE

    key_allowed=0
    for required_key in "${required_keys[@]}"; do
      if [[ "$key" == "$required_key" ]]; then
        key_allowed=1
        break
      fi
    done
    (( key_allowed == 1 )) || fail BATCH_UNKNOWN_KEY

    if (( BASH_VERSINFO[0] >= 4 )); then
      [[ -z "${seen[$key]+x}" ]] || fail BATCH_DUPLICATE_KEY
      seen["$key"]=1
    else
      case ":$seen_keys:" in
        *":$key:"*) fail BATCH_DUPLICATE_KEY ;;
      esac
      seen_keys="$seen_keys:$key"
    fi
    [[ -n "$value" ]] || fail BATCH_EMPTY_VALUE
    printf -v "$key" '%s' "$value"
  done

  if [[ "$input_fd" == 3 ]]; then
    stty echo <&3 2>/dev/null || true
    BATCH_ECHO_DISABLED=0
  fi
  (( terminated == 1 )) || fail BATCH_TERMINATOR_REQUIRED

  for required_key in "${required_keys[@]}"; do
    if (( BASH_VERSINFO[0] >= 4 )); then
      [[ -n "${seen[$required_key]+x}" ]] || fail BATCH_MISSING_KEY
    else
      case ":$seen_keys:" in
        *":$required_key:"*) ;;
        *) fail BATCH_MISSING_KEY ;;
      esac
    fi
  done
}

hex64() {
  [[ "$1" =~ ^[a-f0-9]{64}$ ]]
}

safe_token() {
  [[ "$1" =~ ^[A-Za-z0-9._~:/+=-]+$ ]]
}

disk_used_percent() {
  if [[ "$TEST_MODE" == 1 ]]; then
    [[ "${KSY_PROVISION_TEST_DISK_USED_PERCENT:-}" =~ ^[0-9]+$ ]] ||
      fail TEST_DISK_PERCENT_INVALID
    printf '%s\n' "$KSY_PROVISION_TEST_DISK_USED_PERCENT"
    return
  fi
  df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }'
}

install_private() {
  local source=$1
  local target=$2
  if [[ "$TEST_MODE" == 1 ]]; then
    cp "$source" "$target"
    chmod 600 "$target"
  else
    install -o root -g root -m 600 "$source" "$target"
  fi
}

install_public() {
  local source=$1
  local target=$2
  if [[ "$TEST_MODE" == 1 ]]; then
    cp "$source" "$target"
    chmod 644 "$target"
  else
    install -o root -g root -m 644 "$source" "$target"
  fi
}

[[ "$TEST_MODE" == 1 || $EUID -eq 0 ]] || fail ROOT_REQUIRED
[[ -f "$STAGED_COMPOSE" ]] || fail STAGED_COMPOSE_MISSING
if [[ -e "$ENV_FILE" && ! -e "$COMPOSE_FILE" ]] ||
  [[ ! -e "$ENV_FILE" && -e "$COMPOSE_FILE" ]]; then
  fail PREVIOUS_INSTALLATION_INCOMPLETE
fi
used=$(disk_used_percent)
[[ "$used" =~ ^[0-9]+$ && "$used" -lt 85 ]] || fail DISK_USAGE_LIMIT

read_batch

[[ "$KSY_DEALS_IMAGE" =~ ^ghcr\.io/fedrbodr/ksy-deals@sha256:[a-f0-9]{64}$ ]] ||
  fail KSY_DEALS_IMAGE_INVALID
[[ "$GHCR_USERNAME" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$ ]] ||
  fail GHCR_USERNAME_INVALID
safe_token "$GHCR_READ_TOKEN" || fail GHCR_READ_TOKEN_INVALID
[[ "$VITE_TELEGRAM_BOT_USERNAME" =~ ^[A-Za-z0-9_]{5,32}$ ]] ||
  fail VITE_TELEGRAM_BOT_USERNAME_INVALID
hex64 "$POSTGRES_PASSWORD" || fail POSTGRES_PASSWORD_INVALID
hex64 "$SESSION_COOKIE_KEY" || fail SESSION_COOKIE_KEY_INVALID
hex64 "$TELEGRAM_WEBHOOK_SECRET" || fail TELEGRAM_WEBHOOK_SECRET_INVALID
hex64 "$BACKUP_ENCRYPTION_PASSPHRASE" || fail BACKUP_ENCRYPTION_PASSPHRASE_INVALID
safe_token "$TELEGRAM_BOT_TOKEN" || fail TELEGRAM_BOT_TOKEN_INVALID
safe_token "$PLATPRICES_API_KEY" || fail PLATPRICES_API_KEY_INVALID
[[ "$ORDER_TELEGRAM_URL" =~ ^https://t\.me/([A-Za-z0-9_]{5,32}|\+[A-Za-z0-9_-]+)$ ]] ||
  fail ORDER_TELEGRAM_URL_INVALID
[[ "$ADMIN_TELEGRAM_IDS" =~ ^([1-9][0-9]*),([1-9][0-9]*)$ ]] ||
  fail ADMIN_TELEGRAM_IDS_INVALID
[[ "${BASH_REMATCH[1]}" != "${BASH_REMATCH[2]}" ]] ||
  fail ADMIN_TELEGRAM_IDS_DUPLICATE

encoded_password=$POSTGRES_PASSWORD
candidate_env="$WORK_DIR/ksy.env"
cat > "$candidate_env" <<ENV
KSY_DEALS_IMAGE=$KSY_DEALS_IMAGE
KSY_DEALS_PORT=4300
KSY_DEALS_BACKUP_DIR=$KSY_BACKUP_DIR
POSTGRES_DB=ksy_deals
POSTGRES_USER=ksy_deals
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
DATABASE_URL=postgresql://ksy_deals:$encoded_password@db:5432/ksy_deals
SESSION_COOKIE_KEY=$SESSION_COOKIE_KEY
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET=$TELEGRAM_WEBHOOK_SECRET
TELEGRAM_WEBHOOK_URL=https://ksy-deals.fedrbodr.com/telegram/webhook
ORDER_TELEGRAM_URL=$ORDER_TELEGRAM_URL
ADMIN_TELEGRAM_IDS=$ADMIN_TELEGRAM_IDS
PLATPRICES_API_KEY=$PLATPRICES_API_KEY
PLATPRICES_BASE_URL=https://platprices.com/api/v2
PLATPRICES_REGION=ua
BACKUP_ENCRYPTION_PASSPHRASE=$BACKUP_ENCRYPTION_PASSPHRASE
BACKUP_RETENTION_DAYS=14
ENV
chmod 600 "$candidate_env"

mkdir -p "$KSY_ROOT" "$KSY_BACKUP_DIR" "$CADDY_SITES_DIR"
chmod 700 "$KSY_ROOT" "$KSY_BACKUP_DIR"
empty_site="$WORK_DIR/00-empty.caddy"
: > "$empty_site"
if [[ ! -e "$CADDY_SITES_DIR/00-empty.caddy" ]]; then
  install_public "$empty_site" "$CADDY_SITES_DIR/00-empty.caddy"
fi

had_previous=0
rollback_image=''
if [[ -f "$ENV_FILE" && -f "$COMPOSE_FILE" ]]; then
  had_previous=1
  cp -p "$ENV_FILE" "$WORK_DIR/previous.env"
  cp -p "$COMPOSE_FILE" "$WORK_DIR/previous-compose.yml"
  rollback_image=$(sed -n 's/^KSY_DEALS_IMAGE=//p' "$ENV_FILE" | head -1)
  [[ -z "$rollback_image" || "$rollback_image" =~ ^ghcr\.io/fedrbodr/ksy-deals@sha256:[a-f0-9]{64}$ ]] ||
    fail PREVIOUS_IMAGE_INVALID
  if [[ "$rollback_image" == "$KSY_DEALS_IMAGE" && -f "$EVIDENCE_FILE" ]]; then
    rollback_image=$(sed -n 's/.*"rollbackImage":"\([^"]*\)".*/\1/p' "$EVIDENCE_FILE")
    if [[ -z "$rollback_image" ]] && ! grep -q '"rollbackImage":null' "$EVIDENCE_FILE"; then
      fail PREVIOUS_EVIDENCE_INVALID
    fi
    [[ -z "$rollback_image" || "$rollback_image" =~ ^ghcr\.io/fedrbodr/ksy-deals@sha256:[a-f0-9]{64}$ ]] ||
      fail PREVIOUS_EVIDENCE_IMAGE_INVALID
  fi
fi

printf '%s' "$GHCR_READ_TOKEN" | docker login ghcr.io \
  --username "$GHCR_USERNAME" --password-stdin >/dev/null 2>&1 ||
  fail GHCR_LOGIN_FAILED
unset GHCR_READ_TOKEN
docker network inspect caddy-edge >/dev/null 2>&1 ||
  docker network create caddy-edge >/dev/null
install_public "$STAGED_COMPOSE" "$COMPOSE_FILE"
install_private "$candidate_env" "$ENV_FILE"

compose=(docker compose --project-name ksy-deals --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

wait_for_health() {
  local url=$1
  local attempt
  for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error "$url" >/dev/null; then
      return 0
    fi
    [[ "$TEST_MODE" == 1 ]] || sleep 2
  done
  return 1
}

deploy_stack() {
  "${compose[@]}" config --quiet || return
  "${compose[@]}" pull || return
  "${compose[@]}" up -d db || return
  "${compose[@]}" run --rm migrate || return
  "${compose[@]}" up -d server || return
  wait_for_health http://127.0.0.1:4300/health/live || return
  wait_for_health http://127.0.0.1:4300/health/ready
}

rollback() {
  if [[ "$had_previous" == 1 ]]; then
    install_private "$WORK_DIR/previous.env" "$ENV_FILE"
    install_public "$WORK_DIR/previous-compose.yml" "$COMPOSE_FILE"
    local previous=(docker compose --project-name ksy-deals --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
    "${previous[@]}" config --quiet >/dev/null 2>&1 &&
      "${previous[@]}" up -d server >/dev/null 2>&1 || true
  else
    rm -f "$ENV_FILE" "$COMPOSE_FILE"
  fi
}

if ! deploy_stack; then
  rollback
  fail READINESS_FAILED
fi

deployed_at=$(date -u +%FT%TZ)
rollback_json=null
if [[ -n "$rollback_image" ]]; then
  rollback_json="\"$rollback_image\""
fi
candidate_evidence="$WORK_DIR/deployment-evidence.json"
printf '{"hostname":"ksy-deals.fedrbodr.com","image":"%s","rollbackImage":%s,"deployedAt":"%s","loopbackLive":true,"loopbackReady":true}\n' \
  "$KSY_DEALS_IMAGE" "$rollback_json" "$deployed_at" > "$candidate_evidence"
install_private "$candidate_evidence" "$EVIDENCE_FILE"

printf 'KSY_PROVISIONED image=%s rollback=%s live=PASS ready=PASS\n' \
  "$KSY_DEALS_IMAGE" "${rollback_image:-none}"
