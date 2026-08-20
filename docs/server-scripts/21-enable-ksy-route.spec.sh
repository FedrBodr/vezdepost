#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/21-enable-ksy-route.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

make_stubs() {
  local bin_dir=$1
  mkdir -p "$bin_dir"
  cat > "$bin_dir/dig" <<'STUB'
#!/usr/bin/env bash
if [[ "${DNS_MODE:-ok}" == mismatch && "$*" == *'@ns2.hosting.reg.ru'* ]]; then
  printf '%s\n' 203.0.113.10
else
  printf '%s\n' 201.51.7.50
fi
STUB
  cat > "$bin_dir/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_CALLS"
STUB
  cat > "$bin_dir/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CURL_CALLS"
url=${*: -1}
if [[ "$url" == 'http://127.0.0.1:4300/health/ready' ]]; then
  [[ "${READY_FAIL:-0}" != 1 ]]
  exit
fi
if [[ "$url" == 'https://ksy-deals.fedrbodr.com/' &&
  "${PUBLIC_TRANSIENT_FAILURES:-0}" -gt 0 ]]; then
  count=0
  [[ -f "$PUBLIC_COUNTER" ]] && count=$(cat "$PUBLIC_COUNTER")
  if [[ "$count" -lt "$PUBLIC_TRANSIENT_FAILURES" ]]; then
    printf '%s' "$((count + 1))" > "$PUBLIC_COUNTER"
    printf '%s' '503|text/plain'
    exit
  fi
fi
if [[ "${PUBLIC_FAIL:-0}" == 1 && "$url" == 'https://ksy-deals.fedrbodr.com/' ]]; then
  printf '%s' '503|text/plain'
  exit
fi
case "$url" in
  'https://ksy-deals.fedrbodr.com/') printf '%s' '200|text/html; charset=utf-8' ;;
  'https://vezdepost.ru/') printf '%s' '200|text/html; charset=utf-8' ;;
  'https://vezdepost.ru/assets/vezdepost-og.png') printf '%s' '200|image/png' ;;
  'https://app.vezdepost.ru/api/user/self') printf '%s' '401|application/json' ;;
  *) exit 1 ;;
esac
STUB
  chmod +x "$bin_dir/dig" "$bin_dir/docker" "$bin_dir/curl"
}

run_case() {
  local case_dir=$1
  local output=$2
  local dns_mode=${3:-ok}
  local ready_fail=${4:-0}
  local public_fail=${5:-0}
  local transient_failures=${6:-0}
  local bin_dir="$case_dir/bin"
  mkdir -p "$case_dir/sites"
  make_stubs "$bin_dir"
  : > "$case_dir/docker.calls"
  : > "$case_dir/curl.calls"
  PATH="$bin_dir:$PATH" \
    DNS_MODE="$dns_mode" READY_FAIL="$ready_fail" PUBLIC_FAIL="$public_fail" \
    PUBLIC_TRANSIENT_FAILURES="$transient_failures" PUBLIC_COUNTER="$case_dir/public.counter" \
    DOCKER_CALLS="$case_dir/docker.calls" CURL_CALLS="$case_dir/curl.calls" \
    KSY_ROUTE_TEST_MODE=1 CADDY_SITES_DIR="$case_dir/sites" \
    bash "$SCRIPT" > "$output" 2>&1
}

test_rejects_dns_mismatch_before_mutation() {
  local case_dir="$TMP_DIR/dns-mismatch"
  local output="$case_dir/output"
  mkdir -p "$case_dir"
  if run_case "$case_dir" "$output" mismatch; then
    fail 'authoritative DNS mismatch was accepted'
  fi
  [[ ! -e "$case_dir/sites/ksy-deals.caddy" ]] ||
    fail 'site file was installed after DNS rejection'
  [[ ! -s "$case_dir/docker.calls" ]] ||
    fail 'Docker ran after DNS rejection'
}

test_rejects_unready_upstream_before_mutation() {
  local case_dir="$TMP_DIR/not-ready"
  local output="$case_dir/output"
  mkdir -p "$case_dir"
  if run_case "$case_dir" "$output" ok 1; then
    fail 'unready loopback upstream was accepted'
  fi
  [[ ! -e "$case_dir/sites/ksy-deals.caddy" ]] ||
    fail 'site file was installed for an unready upstream'
  [[ ! -s "$case_dir/docker.calls" ]] ||
    fail 'Caddy changed for an unready upstream'
}

test_activates_exact_route_idempotently() {
  local case_dir="$TMP_DIR/success"
  local output="$case_dir/output"
  mkdir -p "$case_dir"
  run_case "$case_dir" "$output" ok 0 0 2
  cp "$case_dir/sites/ksy-deals.caddy" "$case_dir/site.before"
  run_case "$case_dir" "$case_dir/output-second"

  cmp -s "$case_dir/site.before" "$case_dir/sites/ksy-deals.caddy" ||
    fail 'idempotent rerun changed the site file'
  cat > "$case_dir/expected.caddy" <<'CADDY'
ksy-deals.fedrbodr.com {
	reverse_proxy ksy-server:3000
	encode gzip
}
CADDY
  cmp -s "$case_dir/expected.caddy" "$case_dir/sites/ksy-deals.caddy" ||
    fail 'installed Caddy site does not match the approved route'
  grep -q '^exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile$' \
    "$case_dir/docker.calls" || fail 'Caddy config was not validated'
  grep -q '^exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile$' \
    "$case_dir/docker.calls" || fail 'Caddy config was not reloaded'
  grep -q 'https://vezdepost.ru/$' "$case_dir/curl.calls" ||
    fail 'Vezdepost landing was not verified'
  grep -q 'https://vezdepost.ru/assets/vezdepost-og.png$' "$case_dir/curl.calls" ||
    fail 'Vezdepost preview was not verified'
  grep -q 'https://app.vezdepost.ru/api/user/self$' "$case_dir/curl.calls" ||
    fail 'Vezdepost unauthenticated API was not verified'
}

test_removes_new_route_when_public_acceptance_fails() {
  local case_dir="$TMP_DIR/public-failure"
  local output="$case_dir/output"
  mkdir -p "$case_dir"
  if run_case "$case_dir" "$output" ok 0 1; then
    fail 'failed public acceptance was accepted'
  fi
  [[ ! -e "$case_dir/sites/ksy-deals.caddy" ]] ||
    fail 'failed KSY route was not removed'
  [[ "$(grep -c '^exec caddy caddy reload ' "$case_dir/docker.calls")" -eq 2 ]] ||
    fail 'Caddy was not reloaded after route rollback'
}

test_rejects_dns_mismatch_before_mutation
test_rejects_unready_upstream_before_mutation
test_activates_exact_route_idempotently
test_removes_new_route_when_public_acceptance_fails
echo 'KSY Caddy route tests passed'
