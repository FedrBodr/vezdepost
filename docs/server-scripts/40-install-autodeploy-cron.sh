#!/usr/bin/env bash
# 40-install-autodeploy-cron.sh
#
# Reproducibly installs the autodeploy poller cron: runs deploy/autodeploy.sh
# from the deployed checkout every 3 minutes, so prod tracks origin/prod.
#
# Why a script, not a manual `cp`: the cron file /etc/cron.d/vezdepost-autodeploy
# was absent after a Timeweb reboot (2026-10-24, VM restored from an older
# snapshot), silently stalling prod for two days. The other scheduled jobs
# (ops-alerts, pg-backup) each have an install script; this gives autodeploy the
# same. check-alerts.sh tells the owner to run this when it detects the poller
# missing. Idempotent.
#
# Run:  ssh vezdepost 'bash /root/postiz-app/docs/server-scripts/40-install-autodeploy-cron.sh'
set -euo pipefail

REPO_DIR=${REPO_DIR:-/root/postiz-app}
POLLER="$REPO_DIR/deploy/autodeploy.sh"
CRON=${AUTODEPLOY_CRON:-/etc/cron.d/vezdepost-autodeploy}

[[ -f "$POLLER" ]] || { echo "Missing $POLLER: deploy the commit first" >&2; exit 1; }
chmod 755 "$POLLER"

echo "=== cron -> $CRON (every 3 min) ==="
cat > "$CRON" <<CRONF
# Vezdepost autodeploy poller (docs/server-scripts/40-install-autodeploy-cron.sh).
# Polls origin/prod every 3 minutes and redeploys on new commits.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/3 * * * * root $POLLER
CRONF
chmod 644 "$CRON"

echo "installed $CRON"
