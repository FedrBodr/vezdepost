#!/usr/bin/env bash
# 10-install-orchestrator-watchdog.sh
#
# Installs a host watchdog that auto-recovers the recurring "orchestrator
# poller hang" (see 09-restart-hung-orchestrator.sh + memory). After a
# container restart/redeploy the Temporal worker can hang at bootstrap and
# never register a poller on task queue 'main' -> posts stuck in QUEUE forever.
#
# The watchdog runs every 2 min via cron and restarts ONLY the orchestrator
# process when it detects the hang signature, with guards against false
# positives (deploy in progress, temporal itself down) and a cooldown.
#
# Idempotent: re-running overwrites the watchdog script + cron cleanly.
# Run:  ssh vezdepost 'bash -s' < docs/server-scripts/10-install-orchestrator-watchdog.sh
set -euo pipefail

WATCHDOG=/root/vezdepost-orchestrator-watchdog.sh
CRON=/etc/cron.d/vezdepost-orchestrator-watchdog
LOG=/var/log/vezdepost-orchestrator-watchdog.log

echo "=== writing watchdog script -> $WATCHDOG ==="
cat > "$WATCHDOG" <<'WD'
#!/usr/bin/env bash
# Auto-recover a hung Postiz orchestrator (Temporal worker not polling).
# Installed by docs/server-scripts/10-install-orchestrator-watchdog.sh
set -uo pipefail

LOG=/var/log/vezdepost-orchestrator-watchdog.log
COOLDOWN=/run/vezdepost-orch-watchdog.cooldown
COOLDOWN_SECS=360
TQ=main

log() { echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') $*" >> "$LOG"; }

# Guard 1: postiz container must be up (skip during deploy / down).
docker exec postiz true 2>/dev/null || exit 0

# Guard 2: temporal must be reachable. `describe` exits non-zero only on a
# connection error; empty-poller result still exits 0. If temporal is down,
# restarting the orchestrator won't help — skip.
DESC=$(docker exec temporal-admin-tools temporal task-queue describe \
        --task-queue "$TQ" --task-queue-type workflow \
        --address temporal:7233 2>/dev/null) || exit 0

# Healthy: a poller identity line "PID@host" is present.
if grep -qE '[0-9]+@[a-z0-9]+' <<<"$DESC"; then
  rm -f "$COOLDOWN"
  exit 0
fi

# No poller -> orchestrator hung. Respect cooldown so we don't thrash while it boots.
now=$(date +%s)
if [ -f "$COOLDOWN" ]; then
  last=$(cat "$COOLDOWN" 2>/dev/null || echo 0)
  if [ $(( now - last )) -lt "$COOLDOWN_SECS" ]; then
    log "no poller on '$TQ' but within cooldown ($(( now - last ))s) — waiting"
    exit 0
  fi
fi

log "ALERT: no workflow poller on task queue '$TQ' — orchestrator hung; restarting"
echo "$now" > "$COOLDOWN"
if docker exec postiz pm2 restart orchestrator >/dev/null 2>&1; then
  log "orchestrator restarted"
else
  log "ERROR: 'pm2 restart orchestrator' failed"
fi
WD
chmod 700 "$WATCHDOG"
touch "$LOG"; chmod 640 "$LOG"

echo "=== writing cron -> $CRON (every 2 min) ==="
cat > "$CRON" <<CRONF
# Vezdepost orchestrator watchdog — auto-recover hung Temporal worker.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/2 * * * * root $WATCHDOG
CRONF
chmod 644 "$CRON"

echo "=== dry-run (should no-op: orchestrator is currently healthy) ==="
"$WATCHDOG"; echo "exit=$?"

echo
echo "=== verify install ==="
echo "- watchdog:"; ls -l "$WATCHDOG"
echo "- cron:";     ls -l "$CRON"
echo "- log tail:"; tail -n 5 "$LOG" 2>/dev/null || echo "(log empty — expected on a healthy run)"
echo
echo "Done. Watchdog live; runs every 2 min. Manual recovery still: docs/server-scripts/09-*.sh"
