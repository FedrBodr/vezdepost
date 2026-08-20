#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/25-provision-ksy-egress-proxy.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
file_mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }

make_stubs() {
  local bin_dir=$1
  mkdir -p "$bin_dir"
  cat > "$bin_dir/curl" <<'STUB'
#!/usr/bin/env bash
[[ -z "${PROXY_USERNAME:-}" && -z "${PROXY_PASSWORD:-}" ]] || exit 98
printf '%s\n' "$*" >> "$EGRESS_CURL_CALLS"
[[ "${KSY_TEST_DOWNLOAD_FAIL:-0}" != 1 ]] || exit 22
output=''
while (($#)); do
  [[ "$1" == --output ]] && { output=$2; shift 2; continue; }
  shift
done
[[ -n "$output" ]] || exit 91
printf 'synthetic 3proxy package\n' > "$output"
STUB
  cat > "$bin_dir/sha256sum" <<'STUB'
#!/usr/bin/env bash
input=$(cat)
printf '%s %s\n' "$*" "$input" >> "$EGRESS_SHA_CALLS"
[[ "${KSY_TEST_CHECKSUM_FAIL:-0}" != 1 ]]
STUB
  cat > "$bin_dir/apt-get" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$EGRESS_APT_CALLS"
[[ "${KSY_TEST_PACKAGE_FAIL:-0}" != 1 ]]
STUB
  cat > "$bin_dir/dpkg" <<'STUB'
#!/usr/bin/env bash
[[ "$1" == --print-architecture ]] && printf 'amd64\n'
STUB
  cat > "$bin_dir/dpkg-query" <<'STUB'
#!/usr/bin/env bash
printf '0.9.8\n'
STUB
  cat > "$bin_dir/id" <<'STUB'
#!/usr/bin/env bash
[[ "${2:-}" == proxy ]] || exit 1
[[ "$1" == -u ]] && printf '111\n' || printf '112\n'
STUB
  cat > "$bin_dir/install" <<'STUB'
#!/usr/bin/env bash
mode=''
while (($# > 2)); do
  [[ "$1" == -m ]] && { mode=$2; shift 2; continue; }
  [[ "$1" == -o || "$1" == -g ]] && { shift 2; continue; }
  shift
done
source=$1 target=$2
mkdir -p "$(dirname "$target")"
cp "$source" "$target"
[[ -z "$mode" ]] || chmod "$mode" "$target"
STUB
  cat > "$bin_dir/systemctl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$EGRESS_SYSTEMCTL_CALLS"
case "$1 $2" in
  'is-active --quiet') [[ -f "$EGRESS_SERVICE_ACTIVE" ]] ;;
  'is-enabled --quiet') [[ -f "$EGRESS_SERVICE_ENABLED" ]] ;;
  'enable --now') : > "$EGRESS_SERVICE_ENABLED"; : > "$EGRESS_SERVICE_ACTIVE" ;;
  'enable 3proxy') : > "$EGRESS_SERVICE_ENABLED" ;;
  'restart 3proxy') [[ "${KSY_TEST_SERVICE_FAIL:-0}" != 1 ]] || exit 1; : > "$EGRESS_SERVICE_ACTIVE" ;;
  'stop 3proxy') rm -f "$EGRESS_SERVICE_ACTIVE" ;;
  'disable 3proxy') rm -f "$EGRESS_SERVICE_ENABLED" ;;
  'daemon-reload '*) ;;
esac
STUB
  cat > "$bin_dir/ufw" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$EGRESS_UFW_CALLS"
touch "$EGRESS_UFW_RULES"
if [[ "$1" == status ]]; then
  [[ -f "$EGRESS_UFW_ACTIVE" ]] && printf 'Status: active\n' || printf 'Status: inactive\n'
  cat "$EGRESS_UFW_RULES"
elif [[ "$1 $2" == '--force enable' ]]; then
  : > "$EGRESS_UFW_ACTIVE"
elif [[ "$1 $2" == '--force disable' ]]; then
  rm -f "$EGRESS_UFW_ACTIVE"
elif [[ "$1" == allow && "$2" == OpenSSH ]]; then
  grep -Fxq 'OpenSSH ALLOW Anywhere' "$EGRESS_UFW_RULES" || printf 'OpenSSH ALLOW Anywhere\n' >> "$EGRESS_UFW_RULES"
elif [[ "$1 $2 $3" == '--force delete allow' && "$4" == OpenSSH ]]; then
  sed '/^OpenSSH ALLOW Anywhere$/d' "$EGRESS_UFW_RULES" > "$EGRESS_UFW_RULES.tmp"
  mv "$EGRESS_UFW_RULES.tmp" "$EGRESS_UFW_RULES"
elif [[ "$1" == allow && "$2" == from ]]; then
  grep -Fxq '3128/tcp ALLOW 201.51.7.50' "$EGRESS_UFW_RULES" || printf '3128/tcp ALLOW 201.51.7.50\n' >> "$EGRESS_UFW_RULES"
elif [[ "$1 $2 $3" == '--force delete allow' && "$4" == from ]]; then
  sed '/^3128\/tcp ALLOW 201\.51\.7\.50$/d' "$EGRESS_UFW_RULES" > "$EGRESS_UFW_RULES.tmp"
  mv "$EGRESS_UFW_RULES.tmp" "$EGRESS_UFW_RULES"
fi
STUB
  cat > "$bin_dir/ss" <<'STUB'
#!/usr/bin/env bash
[[ "${KSY_TEST_LISTENER_FAIL:-0}" == 1 ]] || printf 'LISTEN 0 4096 0.0.0.0:3128 0.0.0.0:*\n'
STUB
  chmod +x "$bin_dir"/*
}

valid_batch() {
  cat <<'BATCH'
PROXY_USERNAME = ksy_user_01
PROXY_PASSWORD = abcdefghijklmnopqrstuvwxyzABCDEFGH123456789
KSY_PROXY_SECRETS_END
BATCH
}
missing_batch() { valid_batch | awk '$0 !~ /^PROXY_PASSWORD/'; }
duplicate_batch() { valid_batch | awk '{ if ($0 == "KSY_PROXY_SECRETS_END") print "PROXY_USERNAME = another_user"; print }'; }
malformed_batch() { valid_batch | awk '{ if ($0 == "KSY_PROXY_SECRETS_END") print "not-an-assignment"; print }'; }
invalid_username_batch() { valid_batch | sed 's/ksy_user_01/short/'; }
invalid_password_batch() { valid_batch | sed 's/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789/short/'; }

make_case() {
  local case_dir=$1
  mkdir -p "$case_dir/root/etc/3proxy" "$case_dir/bin"
  printf 'VERSION_ID="24.04"\nID=ubuntu\n' > "$case_dir/root/etc/os-release"
  make_stubs "$case_dir/bin"
  : > "$case_dir/curl.calls"
  : > "$case_dir/sha.calls"
  : > "$case_dir/apt.calls"
  : > "$case_dir/systemctl.calls"
  : > "$case_dir/ufw.calls"
  : > "$case_dir/ufw.rules"
}

run_case() {
  local case_dir=$1 output=$2 batch_fn=${3:-valid_batch}
  "$batch_fn" | PROXY_USERNAME=inherited_user PROXY_PASSWORD=abcdefghijklmnopqrstuvwxyzABCDEFGH987654321 \
    PATH="$case_dir/bin:$PATH" KSY_EGRESS_TEST_MODE=1 \
    KSY_EGRESS_TEST_ROOT="$case_dir/root" KSY_EGRESS_TEST_DISK_USED_PERCENT=20 \
    EGRESS_CURL_CALLS="$case_dir/curl.calls" EGRESS_SHA_CALLS="$case_dir/sha.calls" \
    EGRESS_APT_CALLS="$case_dir/apt.calls" EGRESS_SYSTEMCTL_CALLS="$case_dir/systemctl.calls" \
    EGRESS_UFW_CALLS="$case_dir/ufw.calls" EGRESS_UFW_RULES="$case_dir/ufw.rules" \
    EGRESS_UFW_ACTIVE="$case_dir/ufw.active" EGRESS_SERVICE_ACTIVE="$case_dir/service.active" \
    EGRESS_SERVICE_ENABLED="$case_dir/service.enabled" \
    bash "$SCRIPT" > "$output" 2>&1
}

assert_secrets_absent() {
  local case_dir=$1 output=$2 target
  for target in "$output" "$case_dir/curl.calls" "$case_dir/sha.calls" "$case_dir/apt.calls" \
    "$case_dir/systemctl.calls" "$case_dir/ufw.calls"; do
    ! grep -Fq 'ksy_user_01' "$target" || fail "proxy username leaked to $target"
    ! grep -Fq 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456789' "$target" || fail "proxy password leaked to $target"
  done
}

test_installs_exact_config_idempotently() {
  local case_dir="$TMP_DIR/success" output
  output="$case_dir/output"
  make_case "$case_dir"
  run_case "$case_dir" "$output"
  cp "$case_dir/root/etc/3proxy/3proxy.cfg" "$case_dir/first.cfg"
  run_case "$case_dir" "$case_dir/output-second"

  [[ "$(file_mode "$case_dir/root/etc/3proxy/3proxy.cfg")" == 600 ]] || fail '3proxy config mode is not 600'
  cmp -s "$case_dir/first.cfg" "$case_dir/root/etc/3proxy/3proxy.cfg" || fail 'idempotent run changed config'
  grep -Fxq 'auth strong' "$case_dir/root/etc/3proxy/3proxy.cfg" || fail 'strong auth missing'
  grep -Fxq 'allow "ksy_user_01" 201.51.7.50 platprices.com 443 HTTP_CONNECT' "$case_dir/root/etc/3proxy/3proxy.cfg" || fail 'exact allow ACL missing'
  [[ "$(tail -n 4 "$case_dir/root/etc/3proxy/3proxy.cfg" | head -n 1)" == 'deny *' ]] || fail 'deny is not the final ACL'
  grep -Fxq 'proxy -p3128 -a' "$case_dir/root/etc/3proxy/3proxy.cfg" || fail 'listener missing'
  grep -Fq 'https://github.com/3proxy/3proxy/releases/download/0.9.8/3proxy-0.9.8.x86_64.deb' "$case_dir/curl.calls" || fail 'pinned release URL missing'
  grep -Fq '539f918728cef51e37c6ae077adab97cb354da2186d6071160fa68d5873a53c7' "$case_dir/sha.calls" || fail 'pinned checksum missing'
  [[ "$(grep -c '^OpenSSH ALLOW Anywhere$' "$case_dir/ufw.rules")" == 1 ]] || fail 'OpenSSH rule is not idempotent'
  [[ "$(grep -c '^3128/tcp ALLOW 201.51.7.50$' "$case_dir/ufw.rules")" == 1 ]] || fail 'source proxy rule is not idempotent'
  ssh_line=$(grep -n '^allow OpenSSH$' "$case_dir/ufw.calls" | head -1 | cut -d: -f1)
  proxy_line=$(grep -n '^allow from 201.51.7.50 to any port 3128 proto tcp$' "$case_dir/ufw.calls" | head -1 | cut -d: -f1)
  enable_line=$(grep -n '^--force enable$' "$case_dir/ufw.calls" | head -1 | cut -d: -f1)
  [[ -n "$ssh_line" && -n "$proxy_line" && -n "$enable_line" && "$ssh_line" -lt "$proxy_line" && "$proxy_line" -lt "$enable_line" ]] ||
    fail 'UFW did not protect SSH before proxy exposure and enablement'
  [[ -f "$case_dir/ufw.active" && -f "$case_dir/service.active" && -f "$case_dir/service.enabled" ]] || fail 'firewall or service inactive'
  grep -q '^KSY_EGRESS_PROXY_READY version=0.9.8 source=201.51.7.50 destination=platprices.com:443 auth=strong$' "$output" || fail 'safe readiness evidence missing'
  assert_secrets_absent "$case_dir" "$output"
}

assert_input_rejection() {
  local name=$1 expected=$2 batch_fn=$3 case_dir output
  case_dir="$TMP_DIR/$name"
  output="$TMP_DIR/$name.out"
  make_case "$case_dir"
  if run_case "$case_dir" "$output" "$batch_fn"; then fail "$name was accepted"; fi
  grep -q "KSY_EGRESS_PROXY_FAILED $expected" "$output" || fail "$name returned wrong error"
  [[ ! -s "$case_dir/curl.calls" && ! -s "$case_dir/ufw.calls" ]] || fail "$name mutated host"
  assert_secrets_absent "$case_dir" "$output"
}

test_rejects_invalid_hidden_input() {
  assert_input_rejection missing BATCH_MISSING_KEY missing_batch
  assert_input_rejection duplicate BATCH_DUPLICATE_KEY duplicate_batch
  assert_input_rejection malformed BATCH_MALFORMED_LINE malformed_batch
  assert_input_rejection username PROXY_USERNAME_INVALID invalid_username_batch
  assert_input_rejection password PROXY_PASSWORD_INVALID invalid_password_batch
}

assert_failure_rolls_back() {
  local name=$1 knob=$2 expected=$3 case_dir output
  case_dir="$TMP_DIR/$name"
  output="$TMP_DIR/$name.out"
  make_case "$case_dir"
  printf 'previous-config\n' > "$case_dir/root/etc/3proxy/3proxy.cfg"
  chmod 600 "$case_dir/root/etc/3proxy/3proxy.cfg"
  if env "$knob=1" PROXY_USERNAME=inherited_user PROXY_PASSWORD=abcdefghijklmnopqrstuvwxyzABCDEFGH987654321 \
    PATH="$case_dir/bin:$PATH" KSY_EGRESS_TEST_MODE=1 \
    KSY_EGRESS_TEST_ROOT="$case_dir/root" KSY_EGRESS_TEST_DISK_USED_PERCENT=20 \
    EGRESS_CURL_CALLS="$case_dir/curl.calls" EGRESS_SHA_CALLS="$case_dir/sha.calls" \
    EGRESS_APT_CALLS="$case_dir/apt.calls" EGRESS_SYSTEMCTL_CALLS="$case_dir/systemctl.calls" \
    EGRESS_UFW_CALLS="$case_dir/ufw.calls" EGRESS_UFW_RULES="$case_dir/ufw.rules" \
    EGRESS_UFW_ACTIVE="$case_dir/ufw.active" EGRESS_SERVICE_ACTIVE="$case_dir/service.active" \
    EGRESS_SERVICE_ENABLED="$case_dir/service.enabled" \
    bash "$SCRIPT" > "$output" 2>&1 < <(valid_batch); then
    fail "$name unexpectedly passed"
  fi
  grep -q "KSY_EGRESS_PROXY_FAILED $expected" "$output" || fail "$name returned wrong failure"
  [[ "$(<"$case_dir/root/etc/3proxy/3proxy.cfg")" == previous-config ]] || fail "$name did not restore config"
  [[ ! -f "$case_dir/ufw.active" && ! -s "$case_dir/ufw.rules" ]] || fail "$name did not restore firewall"
  assert_secrets_absent "$case_dir" "$output"
}

test_rolls_back_failures() {
  assert_failure_rolls_back checksum KSY_TEST_CHECKSUM_FAIL PACKAGE_CHECKSUM_INVALID
  assert_failure_rolls_back package KSY_TEST_PACKAGE_FAIL PACKAGE_INSTALL_FAILED
  assert_failure_rolls_back service KSY_TEST_SERVICE_FAIL SERVICE_START_FAILED
  assert_failure_rolls_back listener KSY_TEST_LISTENER_FAIL LISTENER_MISSING
}

test_installs_exact_config_idempotently
test_rejects_invalid_hidden_input
test_rolls_back_failures
bash -n "$SCRIPT"
printf 'KSY egress proxy provisioner tests passed\n'
