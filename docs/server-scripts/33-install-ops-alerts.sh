#!/usr/bin/env bash
# 33-install-ops-alerts.sh
#
# Installs the owner's ops alerts: cron runs docs/server-scripts/ops-alerts.sh
# from the deployed checkout every 5 minutes, so autodeploy keeps it current.
# Alerts go through the assistant bot (TELEGRAM_ASSISTANT_TOKEN) to the
# Telegram account linked to the superadmin in the assistant, or to
# OPS_ALERT_CHAT_ID from .env when set.
#
# Idempotent. The first run sends a "alerts enabled" message and starts the
# window from now; history is not replayed.
# Run:  ssh vezdepost 'bash /root/postiz-app/docs/server-scripts/33-install-ops-alerts.sh'
set -euo pipefail

REPO_DIR=${REPO_DIR:-/root/postiz-app}
ALERTS="$REPO_DIR/docs/server-scripts/ops-alerts.sh"
CRON=/etc/cron.d/vezdepost-ops-alerts
LOG=/var/log/vezdepost-ops-alerts.log

[[ -f "$ALERTS" ]] || { echo "Missing $ALERTS: deploy the commit first" >&2; exit 1; }
chmod 755 "$ALERTS"
touch "$LOG"; chmod 640 "$LOG"

echo "=== cron -> $CRON (every 5 min) ==="
cat > "$CRON" <<CRONF
# Vezdepost ops alerts to the owner's Telegram (docs/server-scripts/33-install-ops-alerts.sh).
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/5 * * * * root $ALERTS
CRONF
chmod 644 "$CRON"

echo "=== first run (sends the 'alerts enabled' message) ==="
if bash "$ALERTS"; then
  echo 'OK: check Telegram for the message from the assistant bot'
else
  echo 'FAILED: see the log below' >&2
fi
tail -n 3 "$LOG" 2>/dev/null || true
