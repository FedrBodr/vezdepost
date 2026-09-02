#!/usr/bin/env bash
# Provision the isolated KSY Deals staging stack on the Vezdepost VPS.
# Copy this script and the reviewed KSY Compose file to /tmp, then run the
# script through an interactive SSH TTY. Secret prompts never echo values.
set -euo pipefail
umask 077

KSY_ROOT=${KSY_ROOT:-/opt/ksy-deals}
KSY_BACKUP_DIR=${KSY_BACKUP_DIR:-/var/backups/ksy-deals}
KSY_BANNER_DIR=${KSY_BANNER_DIR:-/var/banners/ksy-deals}
KSY_COVER_DIR=${KSY_COVER_DIR:-/var/covers/ksy-deals}
CADDY_SITES_DIR=${CADDY_SITES_DIR:-/etc/caddy/sites}
STAGED_COMPOSE=${STAGED_COMPOSE:-/tmp/ksy-deals-docker-compose.yml}
ENV_FILE="$KSY_ROOT/.env"
COMPOSE_FILE="$KSY_ROOT/docker-compose.yml"
EVIDENCE_FILE="$KSY_ROOT/deployment-evidence.json"
TEST_MODE=${KSY_PROVISION_TEST_MODE:-0}
WORK_DIR=''
BATCH_ECHO_DISABLED=0
MUTATION_STARTED=0
TRANSACTION_COMMITTED=0

required_keys=(
  VITE_TELEGRAM_BOT_USERNAME GHCR_USERNAME GHCR_READ_TOKEN
  TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET ORDER_TELEGRAM_URL
  ORDER_BOT_TOKEN ORDER_BOT_WEBHOOK_SECRET ORDER_BOT_WEBHOOK_URL ORDER_OPERATOR_CHAT_ID
  ADMIN_TELEGRAM_IDS PLATPRICES_API_KEY POSTGRES_PASSWORD
  SESSION_COOKIE_KEY BACKUP_ENCRYPTION_PASSPHRASE PLATPRICES_PROXY_URL
  TELEGRAM_BROADCAST_CHANNEL FEED_TOKEN
)
runtime_keys=(
  KSY_DEALS_IMAGE KSY_DEALS_PORT KSY_DEALS_BACKUP_DIR
  POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL SESSION_COOKIE_KEY
  TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET TELEGRAM_WEBHOOK_URL
  ORDER_BOT_TOKEN ORDER_BOT_WEBHOOK_SECRET ORDER_BOT_WEBHOOK_URL ORDER_OPERATOR_CHAT_ID
  ORDER_TELEGRAM_URL ADMIN_TELEGRAM_IDS
  SITE_TELEGRAM_BOT_URL
  PLATPRICES_API_KEY PLATPRICES_BASE_URL PLATPRICES_REGION PLATPRICES_PROXY_URL
  TELEGRAM_BROADCAST_CHANNEL FEED_TOKEN
  BACKUP_ENCRYPTION_PASSPHRASE BACKUP_RETENTION_DAYS
)
optional_compose_keys=(SITE_BASE_URL)
storage_compose_keys=(KSY_DEALS_BANNER_DIR KSY_DEALS_COVER_HOST_DIR COVER_PUBLIC_BASE_URL)
fixed_public_keys=(SITE_TELEGRAM_BOT_URL)

for sensitive_key in "${required_keys[@]}" "${runtime_keys[@]}" \
  "${optional_compose_keys[@]}" "${storage_compose_keys[@]}" \
  "${fixed_public_keys[@]}"; do
  unset "$sensitive_key"
done

trim_horizontal() {
  local value=$1
  value="${value#"${value%%[!$' \t']*}"}"
  value="${value%"${value##*[!$' \t']}"}"
  TRIMMED_VALUE=$value
}

restore_batch_echo() {
  if [[ "$BATCH_ECHO_DISABLED" == 1 ]] && stty echo <&3 2>/dev/null; then
    BATCH_ECHO_DISABLED=0
    printf '\n' >/dev/tty 2>/dev/null || true
  fi
}

cleanup_batch() {
  local status=$?
  if [[ "$MUTATION_STARTED" == 1 && "$TRANSACTION_COMMITTED" != 1 ]]; then
    rollback || true
  fi
  restore_batch_echo
  exec 3>&- 2>/dev/null || true
  [[ -z "$WORK_DIR" ]] || rm -rf "$WORK_DIR"
  return "$status"
}

trap cleanup_batch EXIT
WORK_DIR=$(mktemp -d)

fail() {
  printf 'KSY_PROVISION_FAILED %s\n' "$1" >&2
  exit 1
}

PROGRESS_TOTAL=9

progress() {
  local step=$1
  local phase=$2
  local message=$3
  printf 'KSY_PROGRESS step=%s/%s phase=%s message="%s"\n' \
    "$step" "$PROGRESS_TOTAL" "$phase" "$message"
}

APPROVED_ORDER_TELEGRAM_URL=https://t.me/ksybuybot
APPROVED_SITE_TELEGRAM_BOT_URL=https://t.me/ksy_deals_store_bot
APPROVED_ORDER_BOT_WEBHOOK_URL=https://ksy-deals.fedrbodr.com/telegram/order-webhook
REUSE_EXISTING_SECRETS=0
SECRETS_STDIN=0
KSY_DEALS_IMAGE=''
ORDER_TELEGRAM_URL_OVERRIDE=''
reuse_seen=0
stdin_seen=0
image_seen=0
order_url_seen=0

while (($#)); do
  case "$1" in
    --reuse-existing-secrets)
      [[ "$reuse_seen" == 0 ]] || fail IMAGE_ARGUMENT_REQUIRED
      reuse_seen=1
      REUSE_EXISTING_SECRETS=1
      shift
      ;;
    --secrets-stdin)
      [[ "$stdin_seen" == 0 ]] || fail SECRETS_STDIN_ARGUMENT_INVALID
      stdin_seen=1
      SECRETS_STDIN=1
      shift
      ;;
    --order-telegram-url)
      [[ "$order_url_seen" == 0 && $# -ge 2 && "$2" != --* ]] ||
        fail ORDER_TELEGRAM_URL_ARGUMENT_INVALID
      order_url_seen=1
      ORDER_TELEGRAM_URL_OVERRIDE=$2
      shift 2
      ;;
    --image)
      [[ "$image_seen" == 0 && $# -ge 2 && "$2" != --* ]] || fail IMAGE_ARGUMENT_REQUIRED
      image_seen=1
      KSY_DEALS_IMAGE=$2
      shift 2
      ;;
    *) fail IMAGE_ARGUMENT_REQUIRED ;;
  esac
done

[[ "$image_seen" == 1 ]] || fail IMAGE_ARGUMENT_REQUIRED
[[ "$REUSE_EXISTING_SECRETS" == 0 || "$SECRETS_STDIN" == 0 ]] ||
  fail SECRETS_STDIN_ARGUMENT_INVALID
if [[ "$REUSE_EXISTING_SECRETS" == 1 ]]; then
  [[ "$order_url_seen" == 1 &&
    "$ORDER_TELEGRAM_URL_OVERRIDE" == "$APPROVED_ORDER_TELEGRAM_URL" ]] ||
    fail ORDER_TELEGRAM_URL_ARGUMENT_INVALID
else
  [[ "$order_url_seen" == 0 ]] || fail ORDER_TELEGRAM_URL_ARGUMENT_INVALID
fi

read_batch() {
  local input_fd=0
  local line trimmed key value required_key key_allowed
  local line_number=0
  local terminated=0
  local seen_keys=''

  if [[ "$SECRETS_STDIN" == 1 ]]; then
    input_fd=0
  elif [[ "$TEST_MODE" != 1 ]]; then
    exec 3</dev/tty || fail TTY_REQUIRED
    trap 'exit 130' INT
    trap 'exit 143' TERM
    stty -echo <&3 || fail TERMINAL_ECHO_DISABLE_FAILED
    BATCH_ECHO_DISABLED=1
    printf 'Paste the eighteen KSY secret assignments, then KSY_SECRETS_END:\n' >/dev/tty ||
      fail TTY_REQUIRED
    input_fd=3
  fi

  if (( BASH_VERSINFO[0] >= 4 )); then
    declare -A seen=()
  fi

  while IFS= read -r line <&"$input_fd"; do
    line_number=$((line_number + 1))
    trim_horizontal "$line"
    trimmed=$TRIMMED_VALUE
    [[ -z "$trimmed" ]] && continue
    if [[ "$trimmed" == KSY_SECRETS_END ]]; then
      terminated=1
      break
    fi
    [[ "$trimmed" == *=* ]] || fail "BATCH_MALFORMED_LINE line=$line_number"
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
    restore_batch_echo
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
    cp "$source" "$target" || return
    chmod 600 "$target"
  else
    install -o root -g root -m 600 "$source" "$target"
  fi
}

install_env_atomic() {
  local source=$1
  local temporary
  temporary=$(mktemp "$KSY_ROOT/.env.tmp.XXXXXX") || return 1
  if ! install_private "$source" "$temporary"; then
    rm -f "$temporary"
    return 1
  fi
  if ! mv -f "$temporary" "$ENV_FILE"; then
    rm -f "$temporary"
    return 1
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

ensure_fixed_assignment() {
  local key=$1
  local value=$2
  local target=$3
  local occurrences canonical
  occurrences=$(awk -v key="$key" '
    $0 ~ "^[[:space:]]*(export[[:space:]]+)?" key "[[:space:]]*=" { count++ }
    END { print count + 0 }
  ' "$target")
  canonical=$(grep -Fxc "$key=$value" "$target" || true)
  if [[ "$occurrences" == 0 ]]; then
    printf '%s=%s\n' "$key" "$value" >> "$target"
  elif [[ "$occurrences" != 1 || "$canonical" != 1 ]]; then
    fail EXISTING_ENV_INVALID
  fi
}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

file_uid() {
  stat -c '%u' "$1" 2>/dev/null || stat -f '%u' "$1"
}

progress 1 preflight 'Checking host prerequisites'
[[ "$TEST_MODE" == 1 || $EUID -eq 0 ]] || fail ROOT_REQUIRED
[[ -f "$STAGED_COMPOSE" ]] || fail STAGED_COMPOSE_MISSING
if [[ -e "$ENV_FILE" && ! -e "$COMPOSE_FILE" ]] ||
  [[ ! -e "$ENV_FILE" && -e "$COMPOSE_FILE" ]]; then
  fail PREVIOUS_INSTALLATION_INCOMPLETE
fi

if [[ "$REUSE_EXISTING_SECRETS" == 1 ]] &&
  [[ ! -e "$ENV_FILE" || ! -e "$COMPOSE_FILE" ]]; then
  fail PREVIOUS_INSTALLATION_REQUIRED
fi
used=$(disk_used_percent)
[[ "$used" =~ ^[0-9]+$ && "$used" -lt 85 ]] || fail DISK_USAGE_LIMIT

[[ "$KSY_DEALS_IMAGE" =~ ^ghcr\.io/fedrbodr/ksy-deals@sha256:[a-f0-9]{64}$ ]] ||
  fail KSY_DEALS_IMAGE_INVALID
candidate_env="$WORK_DIR/ksy.env"

if [[ "$REUSE_EXISTING_SECRETS" == 1 ]]; then
  progress 2 secrets 'Reusing existing secret configuration'
  expected_env_uid=0
  if [[ "$TEST_MODE" == 1 ]]; then
    expected_env_uid=$(id -u)
  fi
  [[ ! -L "$ENV_FILE" && -f "$ENV_FILE" ]] || fail PREVIOUS_ENV_UNSAFE
  [[ "$(file_uid "$ENV_FILE")" == "$expected_env_uid" ]] || fail PREVIOUS_ENV_UNSAFE
  [[ "$(file_mode "$ENV_FILE")" == 600 ]] || fail PREVIOUS_ENV_UNSAFE
  if LC_ALL=C grep -q '[^ -~]' "$ENV_FILE"; then
    fail EXISTING_ENV_INVALID
  else
    whole_file_status=$?
    [[ "$whole_file_status" == 1 ]] || fail EXISTING_ENV_INVALID
  fi
  final_newline_count=$(tail -c 1 "$ENV_FILE" | wc -l | awk '{print $1}')
  [[ "$final_newline_count" == 1 ]] || fail EXISTING_ENV_INVALID
  for runtime_key in "${runtime_keys[@]}"; do
    runtime_key_state=$(LC_ALL=C awk -v key="$runtime_key" '
      BEGIN {
        assignment = "^[[:space:]]*(export[[:space:]]+)?" key "[[:space:]]*[=:]"
        bare = "^[[:space:]]*(export[[:space:]]+)?" key "([[:space:]]*(#.*)?)?$"
      }
      $0 ~ assignment || $0 ~ bare {
        if (index($0, key "=") != 1) {
          noncanonical++
          next
        }
        count++
        value = substr($0, length(key) + 2)
        if (value !~ /^[!-~]+$/ || value ~ /["\047]/ || value ~ /\$/ || index(value, "\\") > 0)
          noncanonical++
        else
          nonempty++
      }
      END { print (count + 0) ":" (nonempty + 0) ":" (noncanonical + 0) }
    ' "$ENV_FILE")
    [[ "$runtime_key_state" == 1:1:0 ]] || fail EXISTING_ENV_INVALID
  done
  existing_telegram_bot_token=$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' "$ENV_FILE")
  existing_order_bot_token=$(sed -n 's/^ORDER_BOT_TOKEN=//p' "$ENV_FILE")
  existing_telegram_webhook_secret=$(sed -n 's/^TELEGRAM_WEBHOOK_SECRET=//p' "$ENV_FILE")
  existing_order_bot_webhook_secret=$(sed -n 's/^ORDER_BOT_WEBHOOK_SECRET=//p' "$ENV_FILE")
  existing_order_bot_webhook_url=$(sed -n 's/^ORDER_BOT_WEBHOOK_URL=//p' "$ENV_FILE")
  existing_order_operator_chat_id=$(sed -n 's/^ORDER_OPERATOR_CHAT_ID=//p' "$ENV_FILE")
  existing_order_telegram_url=$(sed -n 's/^ORDER_TELEGRAM_URL=//p' "$ENV_FILE")
  existing_site_telegram_bot_url=$(sed -n 's/^SITE_TELEGRAM_BOT_URL=//p' "$ENV_FILE")
  safe_token "$existing_telegram_bot_token" || fail EXISTING_ENV_INVALID
  safe_token "$existing_order_bot_token" || fail EXISTING_ENV_INVALID
  [[ "$existing_telegram_bot_token" != "$existing_order_bot_token" ]] || fail EXISTING_ENV_INVALID
  [[ -n "$existing_telegram_webhook_secret" && -n "$existing_order_bot_webhook_secret" ]] ||
    fail EXISTING_ENV_INVALID
  [[ "$existing_telegram_webhook_secret" != "$existing_order_bot_webhook_secret" ]] ||
    fail EXISTING_ENV_INVALID
  [[ "$existing_order_bot_webhook_url" == "$APPROVED_ORDER_BOT_WEBHOOK_URL" ]] ||
    fail EXISTING_ENV_INVALID
  [[ "$existing_order_operator_chat_id" =~ ^-100[0-9]+$ ]] || fail EXISTING_ENV_INVALID
  [[ "$existing_order_telegram_url" == "$APPROVED_ORDER_TELEGRAM_URL" ]] ||
    fail EXISTING_ENV_INVALID
  [[ "$existing_site_telegram_bot_url" == "$APPROVED_SITE_TELEGRAM_BOT_URL" ]] ||
    fail EXISTING_ENV_INVALID
  awk -v image="$KSY_DEALS_IMAGE" -v order="$ORDER_TELEGRAM_URL_OVERRIDE" \
    -v site="$APPROVED_SITE_TELEGRAM_BOT_URL" '
    /^KSY_DEALS_IMAGE=/ { print "KSY_DEALS_IMAGE=" image; next }
    order != "" && /^ORDER_TELEGRAM_URL=/ {
      print "ORDER_TELEGRAM_URL=" order
      next
    }
    /^SITE_TELEGRAM_BOT_URL=/ {
      if (!site_written) print "SITE_TELEGRAM_BOT_URL=" site
      site_written = 1
      next
    }
    { print }
    END {
      if (!site_written) print "SITE_TELEGRAM_BOT_URL=" site
    }
  ' "$ENV_FILE" > "$candidate_env"
  chmod 600 "$candidate_env"
else
  progress 2 secrets 'Reading hidden secret assignments'
  read_batch
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
  safe_token "$ORDER_BOT_TOKEN" || fail ORDER_BOT_TOKEN_INVALID
  [[ "$TELEGRAM_BOT_TOKEN" != "$ORDER_BOT_TOKEN" ]] || fail TELEGRAM_BOT_TOKENS_DUPLICATE
  safe_token "$ORDER_BOT_WEBHOOK_SECRET" || fail ORDER_BOT_WEBHOOK_SECRET_INVALID
  [[ "$TELEGRAM_WEBHOOK_SECRET" != "$ORDER_BOT_WEBHOOK_SECRET" ]] ||
    fail TELEGRAM_WEBHOOK_SECRETS_DUPLICATE
  [[ "$ORDER_BOT_WEBHOOK_URL" == "$APPROVED_ORDER_BOT_WEBHOOK_URL" ]] ||
    fail ORDER_BOT_WEBHOOK_URL_INVALID
  [[ "$ORDER_OPERATOR_CHAT_ID" =~ ^-100[0-9]+$ ]] || fail ORDER_OPERATOR_CHAT_ID_INVALID
  safe_token "$PLATPRICES_API_KEY" || fail PLATPRICES_API_KEY_INVALID
  [[ "$TELEGRAM_BROADCAST_CHANNEL" =~ ^[A-Za-z0-9_]{5,32}$ ]] ||
    fail TELEGRAM_BROADCAST_CHANNEL_INVALID
  safe_token "$FEED_TOKEN" || fail FEED_TOKEN_INVALID
  [[ "$PLATPRICES_PROXY_URL" =~ ^http://[A-Za-z0-9_-]{8,32}:[A-Za-z0-9_-]{43,86}@185\.158\.249\.84:3128$ ]] ||
    fail PLATPRICES_PROXY_URL_INVALID
  [[ "$ORDER_TELEGRAM_URL" == "$APPROVED_ORDER_TELEGRAM_URL" ]] ||
    fail ORDER_TELEGRAM_URL_INVALID
  [[ "$ADMIN_TELEGRAM_IDS" =~ ^([1-9][0-9]*),([1-9][0-9]*)$ ]] ||
    fail ADMIN_TELEGRAM_IDS_INVALID
  [[ "${BASH_REMATCH[1]}" != "${BASH_REMATCH[2]}" ]] ||
    fail ADMIN_TELEGRAM_IDS_DUPLICATE

  encoded_password=$POSTGRES_PASSWORD
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
ORDER_BOT_TOKEN=$ORDER_BOT_TOKEN
ORDER_BOT_WEBHOOK_SECRET=$ORDER_BOT_WEBHOOK_SECRET
ORDER_BOT_WEBHOOK_URL=$ORDER_BOT_WEBHOOK_URL
ORDER_OPERATOR_CHAT_ID=$ORDER_OPERATOR_CHAT_ID
ORDER_TELEGRAM_URL=$APPROVED_ORDER_TELEGRAM_URL
SITE_TELEGRAM_BOT_URL=$APPROVED_SITE_TELEGRAM_BOT_URL
ADMIN_TELEGRAM_IDS=$ADMIN_TELEGRAM_IDS
PLATPRICES_API_KEY=$PLATPRICES_API_KEY
PLATPRICES_BASE_URL=https://platprices.com/api/v2
PLATPRICES_REGION=ua
PLATPRICES_PROXY_URL=$PLATPRICES_PROXY_URL
TELEGRAM_BROADCAST_CHANNEL=$TELEGRAM_BROADCAST_CHANNEL
FEED_TOKEN=$FEED_TOKEN
BACKUP_ENCRYPTION_PASSPHRASE=$BACKUP_ENCRYPTION_PASSPHRASE
BACKUP_RETENTION_DAYS=14
ENV
  chmod 600 "$candidate_env"
fi

ensure_fixed_assignment KSY_DEALS_BANNER_DIR "$KSY_BANNER_DIR" "$candidate_env"
ensure_fixed_assignment KSY_DEALS_COVER_HOST_DIR "$KSY_COVER_DIR" "$candidate_env"
ensure_fixed_assignment COVER_PUBLIC_BASE_URL \
  https://ksy-deals.fedrbodr.com/covers/ "$candidate_env"
ensure_fixed_assignment ORDER_DONE_TOPIC_ID 10 "$candidate_env"

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

rollback() {
  if [[ "$had_previous" == 1 ]]; then
    install_env_atomic "$WORK_DIR/previous.env"
    install_public "$WORK_DIR/previous-compose.yml" "$COMPOSE_FILE"
    local previous=(docker compose --project-name ksy-deals --progress plain --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
    "${previous[@]}" config --quiet >/dev/null 2>&1 &&
      "${previous[@]}" up -d server >/dev/null 2>&1 || true
  else
    rm -f "$ENV_FILE" "$COMPOSE_FILE"
  fi
}

progress 3 install 'Installing reviewed configuration'
if [[ "$REUSE_EXISTING_SECRETS" == 1 ]]; then
  docker pull "$KSY_DEALS_IMAGE" >/dev/null 2>&1 ||
    fail EXISTING_DOCKER_AUTH_REQUIRED
else
  printf '%s' "$GHCR_READ_TOKEN" | docker login ghcr.io \
    --username "$GHCR_USERNAME" --password-stdin >/dev/null 2>&1 ||
    fail GHCR_LOGIN_FAILED
  unset GHCR_READ_TOKEN
fi

MUTATION_STARTED=1
banner_parent=$(dirname "$KSY_BANNER_DIR")
cover_parent=$(dirname "$KSY_COVER_DIR")
mkdir -p "$KSY_ROOT" "$KSY_BACKUP_DIR" "$banner_parent" "$KSY_BANNER_DIR" \
  "$cover_parent" "$KSY_COVER_DIR" "$CADDY_SITES_DIR"
chmod 700 "$KSY_ROOT" "$KSY_BACKUP_DIR"
chmod 755 "$banner_parent" "$KSY_BANNER_DIR" "$cover_parent" "$KSY_COVER_DIR"
if [[ "$TEST_MODE" != 1 ]]; then
  chown 1000:1000 "$KSY_COVER_DIR"
fi
empty_site="$WORK_DIR/00-empty.caddy"
: > "$empty_site"
if [[ ! -e "$CADDY_SITES_DIR/00-empty.caddy" ]]; then
  install_public "$empty_site" "$CADDY_SITES_DIR/00-empty.caddy"
fi
docker network inspect caddy-edge >/dev/null 2>&1 ||
  docker network create caddy-edge >/dev/null
install_public "$STAGED_COMPOSE" "$COMPOSE_FILE"
install_env_atomic "$candidate_env"

compose=(docker compose --project-name ksy-deals --progress plain --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

wait_for_health() {
  local endpoint=$1
  local url=$2
  local attempt
  for attempt in $(seq 1 30); do
    if curl --fail --silent "$url" >/dev/null 2>&1; then
      printf 'KSY_PROGRESS step=8/%s phase=health message="Checking %s endpoint" endpoint=%s attempt=%s/30 result=PASS\n' \
        "$PROGRESS_TOTAL" "$endpoint" "$endpoint" "$attempt"
      return 0
    fi
    printf 'KSY_PROGRESS step=8/%s phase=health message="Waiting for %s endpoint" endpoint=%s attempt=%s/30 result=WAIT\n' \
      "$PROGRESS_TOTAL" "$endpoint" "$endpoint" "$attempt"
    [[ "$TEST_MODE" == 1 ]] || sleep 2
  done
  return 1
}

deploy_stack() {
  progress 4 pull 'Pulling immutable images'
  "${compose[@]}" config --quiet || return
  "${compose[@]}" pull || return
  progress 5 database 'Starting PostgreSQL'
  "${compose[@]}" up -d db || return
  progress 6 migrations 'Applying database migrations'
  "${compose[@]}" run --rm migrate || return
  progress 7 server 'Starting KSY server'
  "${compose[@]}" up -d server || return
  wait_for_health live http://127.0.0.1:4300/health/live || return
  wait_for_health ready http://127.0.0.1:4300/health/ready
}

if ! deploy_stack; then
  fail READINESS_FAILED
fi

progress 9 evidence 'Writing deployment evidence'
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
TRANSACTION_COMMITTED=1
