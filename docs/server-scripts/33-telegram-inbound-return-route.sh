#!/usr/bin/env bash
# Send replies to inbound connections back out of the uplink, not the
# Telegram egress tunnel.
#
# Why: the Telegram egress tunnel (interface `tg`) routes every Telegram
# prefix into WireGuard. That is right for connections we open to the Bot
# API, but it also captures replies to connections Telegram opens to us. When
# Telegram fetches https://app.vezdepost.ru/uploads/... for a rich message,
# the SYN arrives on the uplink and the SYN-ACK leaves through `tg`, where the
# EU peer drops it. sendRichMessage then fails with
# RICH_MESSAGE_PHOTO_NO_MEDIA_FOUND and the post falls back to the split
# photo + text transport.
#
# Connections whose first packet arrives on the uplink get a connmark; their
# reply-direction packets (host replies and Docker-forwarded replies alike)
# are routed by a table that only holds the uplink default route. Only the
# reply direction is marked: marking the inbound SYN as well routed it by
# that table too, so after Docker's DNAT the packet for Caddy (172.20.0.2)
# left through the uplink instead of the bridge and the site went dark. Outbound connections, the
# Telegram Bot API included, keep using the tunnel. rp_filter is not changed:
# the host already runs it in loose mode (2), which accepts the inbound SYN.
#
# Run with: ssh vezdepost 'bash -s' < docs/server-scripts/33-telegram-inbound-return-route.sh
# Undo with: ssh vezdepost 'systemctl disable --now vezdepost-inbound-return-route'
set -euo pipefail

MARK=0x177
PROBE_IP=149.154.167.220
HELPER=/usr/local/sbin/vezdepost-inbound-return-route
UNIT=vezdepost-inbound-return-route.service

fail() {
  printf 'INBOUND_RETURN_ROUTE_FAILED %s\n' "$1" >&2
  exit 1
}

route_dev() {
  awk '{for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit }}'
}

cat > "$HELPER" <<'HELPER_EOF'
#!/usr/bin/env bash
# Managed by docs/server-scripts/33-telegram-inbound-return-route.sh
set -euo pipefail
MARK=0x177
TABLE=177
PREF=1000
CHAIN=VEZ_INBOUND_RETURN

read -r UPLINK GATEWAY < <(ip -4 route show default table main |
  awk '{for (i = 1; i < NF; i++) { if ($i == "dev") d = $(i + 1); if ($i == "via") g = $(i + 1) } print d, g; exit}')

down() {
  while ip -4 rule del pref "$PREF" 2>/dev/null; do :; done
  ip -4 route flush table "$TABLE" 2>/dev/null || true
  for hook in PREROUTING OUTPUT; do
    while iptables -t mangle -D "$hook" -j "$CHAIN" 2>/dev/null; do :; done
  done
  iptables -t mangle -F "$CHAIN" 2>/dev/null || true
  iptables -t mangle -X "$CHAIN" 2>/dev/null || true
}

up() {
  [[ -n "${UPLINK:-}" && -n "${GATEWAY:-}" ]] || { echo "no IPv4 default route" >&2; exit 1; }
  down
  ip -4 route replace default via "$GATEWAY" dev "$UPLINK" table "$TABLE"
  ip -4 rule add fwmark "$MARK/$MARK" lookup "$TABLE" pref "$PREF"
  iptables -t mangle -N "$CHAIN"
  iptables -t mangle -A "$CHAIN" -i "$UPLINK" -m conntrack --ctstate NEW -j CONNMARK --set-xmark "$MARK/$MARK"
  iptables -t mangle -A "$CHAIN" -m connmark --mark "$MARK/$MARK" -m conntrack --ctdir REPLY -j MARK --set-xmark "$MARK/$MARK"
  iptables -t mangle -I PREROUTING 1 -j "$CHAIN"
  # OUTPUT has no input interface, so only the restore rule matches there.
  iptables -t mangle -I OUTPUT 1 -j "$CHAIN"
}

case "${1:-up}" in
  up) up ;;
  down) down ;;
  *) echo "usage: $0 up|down" >&2; exit 2 ;;
esac
HELPER_EOF
chmod 755 "$HELPER"

cat > "/etc/systemd/system/${UNIT}" <<EOF
[Unit]
Description=Route replies to inbound connections via the uplink, not the Telegram tunnel
After=network-online.target docker.service wg-quick@tg.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${HELPER} up
ExecStop=${HELPER} down

[Install]
WantedBy=multi-user.target
EOF

uplink=$(ip -4 route show default table main | route_dev)
[[ -n "$uplink" ]] || fail "no IPv4 default route"

systemctl daemon-reload
systemctl enable "$UNIT" >/dev/null
systemctl restart "$UNIT"
systemctl is-active --quiet "$UNIT" || fail "unit did not start"

# Replies to inbound connections must leave through the uplink...
reply_dev=$(ip -4 route get "$PROBE_IP" mark "$MARK" | route_dev)
[[ "$reply_dev" == "$uplink" ]] || fail "marked Telegram reply routes via '${reply_dev}', expected '${uplink}'"
# ...while our own Bot API traffic keeps using the tunnel.
egress_dev=$(ip -4 route get "$PROBE_IP" | route_dev)
[[ "$egress_dev" == "tg" ]] || fail "unmarked Telegram traffic routes via '${egress_dev}', expected 'tg'"

code=$(curl -sS -4 -m 12 -o /dev/null -w '%{http_code}' https://api.telegram.org/ || true)
[[ "$code" == "302" ]] || fail "host lost Bot API reachability (got '${code}')"

printf 'INBOUND_RETURN_ROUTE_OK uplink=%s reply_dev=%s egress_dev=%s botapi=%s\n' \
  "$uplink" "$reply_dev" "$egress_dev" "$code"
