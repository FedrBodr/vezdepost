#!/usr/bin/env bash
# Atomically enable the KSY Deals Caddy route after private readiness and DNS.
set -euo pipefail
umask 077

HOSTNAME=ksy-deals.fedrbodr.com
TARGET_IP=201.51.7.50
READY_URL=http://127.0.0.1:4300/health/ready
CADDY_SITES_DIR=${CADDY_SITES_DIR:-/etc/caddy/sites}
SITE_FILE="$CADDY_SITES_DIR/ksy-deals.caddy"
TEST_MODE=${KSY_ROUTE_TEST_MODE:-0}
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

fail() {
  printf 'KSY_ROUTE_FAILED %s\n' "$1" >&2
  exit 1
}

install_site() {
  local source=$1
  local target=$2
  if [[ "$TEST_MODE" == 1 ]]; then
    cp "$source" "$target"
    chmod 644 "$target"
  else
    install -o root -g root -m 644 "$source" "$target"
  fi
}

authoritative_ip() {
  local nameserver=$1
  local addresses
  addresses=$(dig +short A "$HOSTNAME" "@$nameserver" | sed '/^[[:space:]]*$/d')
  [[ "$addresses" == "$TARGET_IP" ]]
}

probe() {
  local url=$1
  local expected_code=$2
  local expected_type=${3:-}
  local result
  result=$(curl --silent --show-error --output /dev/null \
    --write-out '%{http_code}|%{content_type}' "$url") || return
  [[ "$result" == "$expected_code|"* ]] || return
  [[ -z "$expected_type" || "$result" == "$expected_code|$expected_type"* ]]
}

wait_for_probe() {
  local url=$1
  local expected_code=$2
  local expected_type=${3:-}
  local attempt
  for attempt in $(seq 1 30); do
    if probe "$url" "$expected_code" "$expected_type"; then
      return 0
    fi
    [[ "$TEST_MODE" == 1 ]] || sleep 2
  done
  return 1
}

[[ "$TEST_MODE" == 1 || $EUID -eq 0 ]] || fail ROOT_REQUIRED
command -v dig >/dev/null 2>&1 || fail DIG_REQUIRED
[[ -d "$CADDY_SITES_DIR" ]] || fail CADDY_SITES_DIR_MISSING
authoritative_ip ns1.hosting.reg.ru || fail DNS_NS1_MISMATCH
authoritative_ip ns2.hosting.reg.ru || fail DNS_NS2_MISMATCH
curl --fail --silent --show-error "$READY_URL" >/dev/null ||
  fail LOOPBACK_READINESS_FAILED
docker exec caddy wget -qO- http://ksy-server:3000/health/ready >/dev/null ||
  fail CADDY_UPSTREAM_READINESS_FAILED

candidate="$WORK_DIR/ksy-deals.caddy"
cat > "$candidate" <<'CADDY'
ksy-deals.fedrbodr.com {
	reverse_proxy ksy-server:3000
	encode gzip
}
CADDY
chmod 644 "$candidate"

had_previous=0
changed=1
if [[ -f "$SITE_FILE" ]]; then
  had_previous=1
  cp -p "$SITE_FILE" "$WORK_DIR/previous.caddy"
  if cmp -s "$candidate" "$SITE_FILE"; then
    changed=0
  fi
fi

rollback() {
  if [[ "$had_previous" == 1 ]]; then
    install_site "$WORK_DIR/previous.caddy" "$SITE_FILE"
  else
    rm -f "$SITE_FILE"
  fi
  docker exec caddy caddy validate --config /etc/caddy/Caddyfile \
    --adapter caddyfile >/dev/null 2>&1 || true
  docker exec caddy caddy reload --config /etc/caddy/Caddyfile \
    --adapter caddyfile >/dev/null 2>&1 || true
}

if [[ "$changed" == 1 ]]; then
  install_site "$candidate" "$SITE_FILE"
fi

if ! docker exec caddy caddy validate --config /etc/caddy/Caddyfile \
    --adapter caddyfile >/dev/null; then
  rollback
  fail CADDY_VALIDATION_FAILED
fi
if ! docker exec caddy caddy reload --config /etc/caddy/Caddyfile \
    --adapter caddyfile >/dev/null; then
  rollback
  fail CADDY_RELOAD_FAILED
fi

if ! wait_for_probe https://ksy-deals.fedrbodr.com/ 200 ||
  ! probe https://vezdepost.ru/ 200 text/html ||
  ! probe https://vezdepost.ru/assets/vezdepost-og.png 200 image/png ||
  ! probe https://app.vezdepost.ru/api/user/self 401; then
  rollback
  fail PUBLIC_ACCEPTANCE_FAILED
fi

printf 'KSY_ROUTE_ENABLED host=%s target=%s ksy=200 vezdepost=200/200/401\n' \
  "$HOSTNAME" "$TARGET_IP"
