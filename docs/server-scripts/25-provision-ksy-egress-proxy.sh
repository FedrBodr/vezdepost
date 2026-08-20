#!/usr/bin/env bash
# Provision the narrowly scoped KSY Deals PlatPrices egress proxy.
set -euo pipefail
umask 077

PROXY_VERSION=0.9.8
PACKAGE_URL="https://github.com/3proxy/3proxy/releases/download/0.9.8/3proxy-0.9.8.x86_64.deb"
PACKAGE_SHA256=539f918728cef51e37c6ae077adab97cb354da2186d6071160fa68d5873a53c7
SOURCE_IP=201.51.7.50
DESTINATION_HOST=platprices.com
DESTINATION_PORT=443
PROXY_PORT=3128
TEST_MODE=${KSY_EGRESS_TEST_MODE:-0}
ROOT_PREFIX=${KSY_EGRESS_TEST_ROOT:-}
OS_RELEASE_FILE="$ROOT_PREFIX/etc/os-release"
CONFIG_FILE="$ROOT_PREFIX/etc/3proxy/3proxy.cfg"
WORK_DIR=''
BATCH_ECHO_DISABLED=0
MUTATION_STARTED=0
SUCCESS=0
HAD_PREVIOUS_CONFIG=0
SERVICE_WAS_ACTIVE=0
SERVICE_WAS_ENABLED=0
UFW_WAS_ACTIVE=0
ADDED_SSH_RULE=0
ADDED_PROXY_RULE=0
ACTIVATED_UFW=0

unset PROXY_USERNAME PROXY_PASSWORD

fail() { printf 'KSY_EGRESS_PROXY_FAILED %s\n' "$1" >&2; exit 1; }

restore_batch_echo() {
  if [[ "$BATCH_ECHO_DISABLED" == 1 ]] && stty echo <&3 2>/dev/null; then
    BATCH_ECHO_DISABLED=0
    printf '\n' >/dev/tty 2>/dev/null || true
  fi
}

restore_previous_state() {
  set +e
  if [[ "$HAD_PREVIOUS_CONFIG" == 1 ]]; then
    install -o root -g root -m 600 "$WORK_DIR/previous.cfg" "$CONFIG_FILE"
  else
    rm -f "$CONFIG_FILE"
  fi
  systemctl daemon-reload >/dev/null 2>&1
  if [[ "$SERVICE_WAS_ENABLED" == 1 ]]; then
    systemctl enable 3proxy >/dev/null 2>&1
  else
    systemctl disable 3proxy >/dev/null 2>&1
  fi
  if [[ "$SERVICE_WAS_ACTIVE" == 1 ]]; then
    systemctl restart 3proxy >/dev/null 2>&1
  else
    systemctl stop 3proxy >/dev/null 2>&1
  fi
  if [[ "$ADDED_PROXY_RULE" == 1 ]]; then
    ufw --force delete allow from "$SOURCE_IP" to any port "$PROXY_PORT" proto tcp >/dev/null 2>&1
  fi
  if [[ "$ADDED_SSH_RULE" == 1 ]]; then
    ufw --force delete allow OpenSSH >/dev/null 2>&1
  fi
  if [[ "$ACTIVATED_UFW" == 1 ]]; then
    ufw --force disable >/dev/null 2>&1
  fi
  set -e
}

cleanup() {
  local status=$?
  restore_batch_echo
  exec 3>&- 2>/dev/null || true
  if [[ "$status" -ne 0 && "$MUTATION_STARTED" == 1 && "$SUCCESS" == 0 ]]; then
    restore_previous_state
  fi
  [[ -z "$WORK_DIR" ]] || rm -rf "$WORK_DIR"
  return "$status"
}
trap cleanup EXIT

WORK_DIR=$(mktemp -d)

trim_horizontal() {
  local value=$1
  value="${value#"${value%%[!$' \t']*}"}"
  value="${value%"${value##*[!$' \t']}"}"
  TRIMMED_VALUE=$value
}

read_secrets() {
  local input_fd=0 line trimmed key value terminated=0
  local seen_username=0 seen_password=0
  if [[ "$TEST_MODE" != 1 ]]; then
    exec 3</dev/tty || fail TTY_REQUIRED
    trap 'exit 130' INT
    trap 'exit 143' TERM
    stty -echo <&3 || fail TERMINAL_ECHO_DISABLE_FAILED
    BATCH_ECHO_DISABLED=1
    printf 'Paste the two KSY proxy secret assignments, then KSY_PROXY_SECRETS_END:\n' >/dev/tty || fail TTY_REQUIRED
    input_fd=3
  fi
  while IFS= read -r line <&"$input_fd"; do
    trim_horizontal "$line"
    trimmed=$TRIMMED_VALUE
    [[ -z "$trimmed" ]] && continue
    if [[ "$trimmed" == KSY_PROXY_SECRETS_END ]]; then
      terminated=1
      break
    fi
    [[ "$trimmed" == *=* ]] || fail BATCH_MALFORMED_LINE
    key=${trimmed%%=*}
    value=${trimmed#*=}
    trim_horizontal "$key"; key=$TRIMMED_VALUE
    trim_horizontal "$value"; value=$TRIMMED_VALUE
    [[ -n "$value" ]] || fail BATCH_EMPTY_VALUE
    case "$key" in
      PROXY_USERNAME)
        [[ "$seen_username" == 0 ]] || fail BATCH_DUPLICATE_KEY
        PROXY_USERNAME=$value
        seen_username=1
        ;;
      PROXY_PASSWORD)
        [[ "$seen_password" == 0 ]] || fail BATCH_DUPLICATE_KEY
        PROXY_PASSWORD=$value
        seen_password=1
        ;;
      *) fail BATCH_UNKNOWN_KEY ;;
    esac
  done
  [[ "$input_fd" != 3 ]] || restore_batch_echo
  [[ "$terminated" == 1 ]] || fail BATCH_TERMINATOR_REQUIRED
  [[ "$seen_username" == 1 && "$seen_password" == 1 ]] || fail BATCH_MISSING_KEY
}

disk_used_percent() {
  if [[ "$TEST_MODE" == 1 ]]; then
    [[ "${KSY_EGRESS_TEST_DISK_USED_PERCENT:-}" =~ ^[0-9]+$ ]] || fail TEST_DISK_PERCENT_INVALID
    printf '%s\n' "$KSY_EGRESS_TEST_DISK_USED_PERCENT"
  else
    df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }'
  fi
}

[[ "$TEST_MODE" == 1 || $EUID -eq 0 ]] || fail ROOT_REQUIRED
[[ -f "$OS_RELEASE_FILE" ]] || fail OS_RELEASE_MISSING
grep -Eq '^ID=("?ubuntu"?)$' "$OS_RELEASE_FILE" || fail OS_UNSUPPORTED
grep -Eq '^VERSION_ID=("?24\.04"?)$' "$OS_RELEASE_FILE" || fail OS_VERSION_UNSUPPORTED
[[ "$(dpkg --print-architecture)" == amd64 ]] || fail ARCHITECTURE_UNSUPPORTED
used=$(disk_used_percent)
[[ "$used" =~ ^[0-9]+$ && "$used" -lt 85 ]] || fail DISK_USAGE_LIMIT

read_secrets
[[ "$PROXY_USERNAME" =~ ^[A-Za-z0-9_-]{8,32}$ ]] || fail PROXY_USERNAME_INVALID
[[ "$PROXY_PASSWORD" =~ ^[A-Za-z0-9_-]{43,86}$ ]] || fail PROXY_PASSWORD_INVALID

package_file="$WORK_DIR/3proxy-${PROXY_VERSION}.x86_64.deb"
curl --fail --location --silent --show-error --output "$package_file" "$PACKAGE_URL" || fail PACKAGE_DOWNLOAD_FAILED
printf '%s  %s\n' "$PACKAGE_SHA256" "$package_file" |
  sha256sum --check --status || fail PACKAGE_CHECKSUM_INVALID

mkdir -p "$(dirname "$CONFIG_FILE")"
if [[ -f "$CONFIG_FILE" ]]; then
  HAD_PREVIOUS_CONFIG=1
  cp -p "$CONFIG_FILE" "$WORK_DIR/previous.cfg"
fi
if systemctl is-active --quiet 3proxy; then SERVICE_WAS_ACTIVE=1; fi
if systemctl is-enabled --quiet 3proxy; then SERVICE_WAS_ENABLED=1; fi
ufw_before=$(ufw status)
[[ "$ufw_before" != 'Status: active'* ]] || UFW_WAS_ACTIVE=1

MUTATION_STARTED=1
if ! grep -Eq '^OpenSSH[[:space:]]+ALLOW[[:space:]]+' <<<"$ufw_before"; then
  ufw allow OpenSSH >/dev/null || fail UFW_SSH_RULE_FAILED
  ADDED_SSH_RULE=1
fi
if ! grep -Eq '^3128/tcp[[:space:]]+ALLOW[[:space:]]+201\.51\.7\.50$' <<<"$ufw_before"; then
  ufw allow from "$SOURCE_IP" to any port "$PROXY_PORT" proto tcp >/dev/null || fail UFW_PROXY_RULE_FAILED
  ADDED_PROXY_RULE=1
fi
if [[ "$UFW_WAS_ACTIVE" == 0 ]]; then
  ufw --force enable >/dev/null || fail UFW_ENABLE_FAILED
  ACTIVATED_UFW=1
fi

apt-get install -y "$package_file" >/dev/null || fail PACKAGE_INSTALL_FAILED
installed_version=$(dpkg-query -W -f='${Version}\n' 3proxy 2>/dev/null) || fail PACKAGE_VERSION_INVALID
[[ "$installed_version" == "$PROXY_VERSION"* ]] || fail PACKAGE_VERSION_INVALID
systemctl stop 3proxy >/dev/null 2>&1 || true
proxy_uid=$(id -u proxy) || fail PROXY_USER_MISSING
proxy_gid=$(id -g proxy) || fail PROXY_USER_MISSING
[[ "$proxy_uid" =~ ^[0-9]+$ && "$proxy_gid" =~ ^[0-9]+$ ]] || fail PROXY_USER_INVALID

candidate="$WORK_DIR/3proxy.cfg"
cat > "$candidate" <<CONFIG
maxconn 20
nscache 65536
users "$PROXY_USERNAME:CL:$PROXY_PASSWORD"
auth strong
allow "$PROXY_USERNAME" $SOURCE_IP $DESTINATION_HOST $DESTINATION_PORT HTTP_CONNECT
deny *
setgid $proxy_gid
setuid $proxy_uid
proxy -p$PROXY_PORT -a
CONFIG
chmod 600 "$candidate"
install -o root -g root -m 600 "$candidate" "$CONFIG_FILE"

systemctl daemon-reload >/dev/null || fail SERVICE_RELOAD_FAILED
systemctl enable 3proxy >/dev/null || fail SERVICE_ENABLE_FAILED
systemctl restart 3proxy >/dev/null || fail SERVICE_START_FAILED
systemctl is-active --quiet 3proxy || fail SERVICE_INACTIVE
ss -ltn | grep -Eq "[.:]${PROXY_PORT}[[:space:]]" || fail LISTENER_MISSING

SUCCESS=1
unset PROXY_USERNAME PROXY_PASSWORD
printf 'KSY_EGRESS_PROXY_READY version=%s source=%s destination=%s:%s auth=strong\n' \
  "$PROXY_VERSION" "$SOURCE_IP" "$DESTINATION_HOST" "$DESTINATION_PORT"
