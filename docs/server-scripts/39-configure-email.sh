#!/usr/bin/env bash
# Turn on outgoing email for Vezdepost production via Unisender Go SMTP:
# writes EMAIL_PROVIDER, EMAIL_USER, EMAIL_PASS, EMAIL_FROM_ADDRESS and
# EMAIL_REPLY_TO to .env. Host, port, sender name and the activation flag are
# literals in docker-compose.override.yaml; they do nothing until
# EMAIL_PROVIDER is set here.
#
# Idempotent. The SMTP password is read without echo, never printed and never
# passed on a command line. The app picks the values up on the next deploy
# (or `docker compose up -d postiz` on the server).
# Run from the operator machine:
#   scp -q -o BatchMode=yes -o ConnectTimeout=10 docs/server-scripts/39-configure-email.sh vezdepost:/tmp/vezdepost-configure-email.sh
#   ssh -tt -o BatchMode=yes -o ConnectTimeout=10 vezdepost \
#     'status=0; bash /tmp/vezdepost-configure-email.sh || status=$?; rm -f /tmp/vezdepost-configure-email.sh; exit "$status"'
set -euo pipefail

REPO_DIR=${REPO_DIR:-/root/postiz-app}
ENV_FILE="$REPO_DIR/.env"
SMTP_HOST=${SMTP_HOST:-smtp.go1.unisender.ru}
SMTP_PORT=${SMTP_PORT:-587}

smtp_user=${EMAIL_USER:-}
smtp_pass=${EMAIL_PASS:-}
from_address=${EMAIL_FROM_ADDRESS:-}
reply_to=${EMAIL_REPLY_TO:-}

ask() {
  local prompt=$1 secret=${2:-} value
  printf '%s' "$prompt" > /dev/tty
  if [[ -n "$secret" ]]; then
    IFS= read -r -s value < /dev/tty || { printf '\nUnable to read input\n' > /dev/tty; exit 1; }
    printf '\n' > /dev/tty
  else
    IFS= read -r value < /dev/tty || { printf '\nUnable to read input\n' > /dev/tty; exit 1; }
  fi
  printf '%s' "$value"
}

[[ -n "$smtp_user" ]] || smtp_user=$(ask 'Unisender Go SMTP user (user ID): ')
[[ -n "$smtp_pass" ]] || smtp_pass=$(ask 'Unisender Go SMTP password (API key): ' secret)
[[ -n "$from_address" ]] || from_address=$(ask 'From address on vezdepost.ru [hello@vezdepost.ru]: ')
from_address=${from_address:-hello@vezdepost.ru}
[[ -n "$reply_to" ]] || reply_to=$(ask 'Reply-To address (where replies land): ')

email_re='^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
if [[ ! "$smtp_user" =~ ^[A-Za-z0-9_.@-]{1,128}$ ]]; then
  echo 'Invalid SMTP user' >&2
  exit 2
fi
if [[ -z "$smtp_pass" || "$smtp_pass" =~ [[:space:]] ]]; then
  echo 'Invalid SMTP password' >&2
  exit 2
fi
if [[ ! "$from_address" =~ $email_re || "$from_address" != *@vezdepost.ru ]]; then
  echo 'From address must be an address on vezdepost.ru' >&2
  exit 2
fi
if [[ ! "$reply_to" =~ $email_re ]]; then
  echo 'Invalid Reply-To address' >&2
  exit 2
fi
if [[ ! -d "$REPO_DIR" ]]; then
  echo "Postiz directory not found: $REPO_DIR" >&2
  exit 1
fi

# Reachability only; credentials are checked by the first real send.
if timeout 10 bash -c "exec 3<>/dev/tcp/$SMTP_HOST/$SMTP_PORT" 2>/dev/null; then
  reachable="SMTP $SMTP_HOST:$SMTP_PORT is reachable from this server"
else
  reachable="SMTP $SMTP_HOST:$SMTP_PORT is NOT reachable from this server; values stored anyway"
fi

umask 077
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

temp_file=$(mktemp "$REPO_DIR/.env.email.XXXXXX")
trap 'rm -f "$temp_file"' EXIT

declare -A values=(
  [EMAIL_PROVIDER]=nodemailer
  [EMAIL_USER]=$smtp_user
  [EMAIL_PASS]=$smtp_pass
  [EMAIL_FROM_ADDRESS]=$from_address
  [EMAIL_REPLY_TO]=$reply_to
)
declare -A written=()

while IFS= read -r line || [[ -n "$line" ]]; do
  key=${line%%=*}
  if [[ "$line" == *=* && -n "${values[$key]+x}" ]]; then
    if [[ -z "${written[$key]+x}" ]]; then
      printf '%s=%s\n' "$key" "${values[$key]}"
      written[$key]=1
    fi
  else
    printf '%s\n' "$line"
  fi
done < "$ENV_FILE" > "$temp_file"

for key in EMAIL_PROVIDER EMAIL_USER EMAIL_PASS EMAIL_FROM_ADDRESS EMAIL_REPLY_TO; do
  if [[ -z "${written[$key]+x}" ]]; then
    printf '%s=%s\n' "$key" "${values[$key]}" >> "$temp_file"
  fi
done

chmod 600 "$temp_file"
mv "$temp_file" "$ENV_FILE"
trap - EXIT
unset smtp_pass EMAIL_PASS values

echo "$reachable"
echo "Email settings stored in .env (from $from_address)"
echo 'Apply with the next deploy or: docker compose up -d postiz'
