#!/usr/bin/env bash
# Carry the Telegram egress tunnel (`tg`, AmneziaWG) over fake TCP (udp2raw).
#
# Why: on 2026-11-20 ~15:50 UTC every UDP datagram from the EU relay
# (185.158.249.84) to the Timeweb box started being dropped on the way in,
# whatever the port or payload (a 4-byte UDP echo on 443/udp got no reply,
# while DNS replies from 1.1.1.1/8.8.8.8 still arrived and TCP to the relay
# still worked). AmneziaWG handshakes therefore never completed and every
# Telegram call (posts, stories getBusinessConnection, the assistant bot's
# getUpdates) timed out. Script 44's obfuscation can't help against an
# IP-level UDP block, so the tunnel's UDP is wrapped into fake-TCP packets by
# udp2raw. The `tg` interface, its AllowedIPs (Telegram + LinkedIn), routing
# and the inbound return route (script 33) stay exactly as they are; only the
# peer endpoint moves to a local udp2raw client.
#
#   tg (awg) -> 127.0.0.1:51821/udp -> udp2raw client -> relay:8443 fake TCP
#   -> udp2raw server -> 127.0.0.1:51821/udp -> awg0
#
# Usage:
#   On the relay (eu-vps):     bash 45-telegram-egress-udp2raw.sh relay
#     installs udp2raw, creates /etc/udp2raw/key (shared secret, never print
#     it), starts udp2raw-tg-server, allows 8443/tcp from the vezdepost IP.
#   Copy the key to the vezdepost host (scp via the operator machine) to
#   /etc/udp2raw/key, mode 600.
#   On the vezdepost host:     bash 45-telegram-egress-udp2raw.sh host
#     installs udp2raw, starts udp2raw-tg-client, points the tg peer at it,
#     lowers MTU for the TCP framing, probes Telegram from the host and the
#     postiz container; on failure restores the direct endpoint and exits 1.
#   UNDO on the vezdepost host: bash 45-telegram-egress-udp2raw.sh undo
set -euo pipefail

RELAY_IP=185.158.249.84
HOST_IP=201.51.7.50
FAKE_TCP_PORT=8443
AWG_PORT=51821
IFACE=tg
CONF=/etc/amnezia/amneziawg/$IFACE.conf
DIRECT_ENDPOINT=$RELAY_IP:$AWG_PORT
LOCAL_ENDPOINT=127.0.0.1:$AWG_PORT
TUNNEL_MTU=1300
DIRECT_MTU=1420
BIN=/usr/local/bin/udp2raw
KEY=/etc/udp2raw/key
RELEASE_URL=https://github.com/wangyu-/udp2raw/releases/download/20230206.0/udp2raw_binaries.tar.gz
RELEASE_SHA256=503cf5781aa97e50b4954c6bc4622c3ea6be02f6a35def4bb3b3eaf95bd2c7e8
CONTAINER=postiz
PROBE_URL=https://api.telegram.org/

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail 'run as root'

install_binary() {
  [ -x "$BIN" ] && return
  local tmp
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/u2r.tgz" "$RELEASE_URL"
  echo "$RELEASE_SHA256  $tmp/u2r.tgz" | sha256sum -c - >/dev/null || fail 'udp2raw checksum mismatch'
  tar xzf "$tmp/u2r.tgz" -C "$tmp" udp2raw_amd64
  install -m 755 "$tmp/udp2raw_amd64" "$BIN"
  rm -rf "$tmp"
}

write_unit() { # name, args
  cat >"/etc/systemd/system/$1.service" <<EOF
[Unit]
Description=udp2raw fake-TCP transport for the Telegram egress tunnel
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/bin/sh -c 'exec $BIN $2 -k "\$(cat $KEY)" --raw-mode faketcp -a --cipher-mode xor --auth-mode simple --log-level 3'
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now "$1"
  systemctl restart "$1"
}

relay_peer() { awg show "$IFACE" peers | head -1; }

set_endpoint() { # endpoint, mtu
  awg set "$IFACE" peer "$(relay_peer)" endpoint "$1"
  ip link set "$IFACE" mtu "$2"
  sed -i -E "s|^Endpoint = .*|Endpoint = $1|" "$CONF"
  if grep -q '^MTU = ' "$CONF"; then
    sed -i -E "s|^MTU = .*|MTU = $2|" "$CONF"
  else
    sed -i -E "0,/^\[Interface\]/s||[Interface]\nMTU = $2|" "$CONF"
  fi
}

probe_host() {
  curl -4 -sS -o /dev/null --connect-timeout 10 -m 20 -w '%{http_code}' "$PROBE_URL" 2>/dev/null || echo TIMEOUT
}

probe_container() {
  docker exec "$CONTAINER" node -e '
    fetch(process.argv[1], { signal: AbortSignal.timeout(15000) })
      .then((r) => console.log(r.status))
      .catch((e) => console.log("TIMEOUT", e.cause ? e.cause.code : e.message));
  ' "$PROBE_URL" 2>/dev/null || echo TIMEOUT
}

case "${1:-}" in
  relay)
    install_binary
    mkdir -p /etc/udp2raw && chmod 700 /etc/udp2raw
    [ -s "$KEY" ] || (umask 077; head -c 32 /dev/urandom | base64 | tr -d '/+=' >"$KEY")
    write_unit udp2raw-tg-server "-s -l0.0.0.0:$FAKE_TCP_PORT -r127.0.0.1:$AWG_PORT"
    ufw allow from "$HOST_IP" to any port "$FAKE_TCP_PORT" proto tcp comment 'udp2raw tg vezdepost' >/dev/null
    systemctl is-active udp2raw-tg-server
    ;;
  host)
    [ -s "$KEY" ] || fail "copy the relay's $KEY here first"
    install_binary
    write_unit udp2raw-tg-client "-c -l127.0.0.1:$AWG_PORT -r$RELAY_IP:$FAKE_TCP_PORT"
    set_endpoint "$LOCAL_ENDPOINT" "$TUNNEL_MTU"
    sleep 8
    host_status=$(probe_host)
    container_status=$(probe_container)
    echo "probe host: $host_status, container: $container_status"
    if [[ "$host_status" =~ ^[0-9]{3}$ && "$host_status" != 000 && "$container_status" =~ ^[0-9]{3}$ ]]; then
      echo 'Telegram reachable over udp2raw'
    else
      set_endpoint "$DIRECT_ENDPOINT" "$DIRECT_MTU"
      systemctl disable --now udp2raw-tg-client
      fail 'Telegram still unreachable; restored the direct endpoint'
    fi
    ;;
  undo)
    set_endpoint "$DIRECT_ENDPOINT" "$DIRECT_MTU"
    systemctl disable --now udp2raw-tg-client 2>/dev/null || true
    echo "tg uses $DIRECT_ENDPOINT again"
    ;;
  *) fail 'usage: 45-telegram-egress-udp2raw.sh relay|host|undo' ;;
esac
