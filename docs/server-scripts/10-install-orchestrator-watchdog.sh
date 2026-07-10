#!/usr/bin/env bash
# 10-install-orchestrator-watchdog.sh
#
# Installs a host watchdog that auto-recovers the recurring "startup hang":
# after a container restart/redeploy any of the three Postiz NestJS processes
# can hang during bootstrap (temporal-connection startup race) and never
# finish coming up. Symptoms seen in prod:
#   - orchestrator hangs  -> no poller on task queue 'main' -> posts stuck QUEUE
#   - backend hangs       -> never binds :3000 -> nginx 502 on API -> black screen
#   - frontend hangs      -> never binds :4200 -> app not served
# In every case pm2 still shows the process "online" (it doesn't crash-loop),
# so pm2's own restart doesn't help — we detect the missing readiness signal.
#
# The watchdog runs every 2 min via cron and restarts ONLY the unhealthy
# process, with guards (skip during deploy / temporal down) and a per-process
# 6-min cooldown to avoid thrash while a process is booting.
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
# Auto-recover hung Postiz processes (backend/frontend/orchestrator not ready).
# Installed by docs/server-scripts/10-install-orchestrator-watchdog.sh
set -uo pipefail

LOG=/var/log/vezdepost-orchestrator-watchdog.log
COOLDOWN_SECS=360
TQ=main

log() { echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') $*" >> "$LOG"; }

# Guard: postiz container must be up (skip during deploy / down).
docker exec postiz true 2>/dev/null || exit 0

# Restart a pm2 process with a per-process cooldown.
restart_proc() {
  local name=$1 cd="/run/vezdepost-wd-$1.cooldown" now last
  now=$(date +%s)
  if [ -f "$cd" ]; then
    last=$(cat "$cd" 2>/dev/null || echo 0)
    if [ $(( now - last )) -lt "$COOLDOWN_SECS" ]; then
      log "$name unhealthy but within cooldown ($(( now - last ))s) — waiting"
      return
    fi
  fi
  log "ALERT: $name unhealthy — restarting"
  echo "$now" > "$cd"
  if docker exec postiz pm2 restart "$name" >/dev/null 2>&1; then
    log "$name restarted"
  else
    log "ERROR: 'pm2 restart $name' failed"
  fi
}
clear_cd() { rm -f "/run/vezdepost-wd-$1.cooldown"; }

# Is a TCP port LISTENING inside the postiz container?
port_up() {
  docker exec postiz sh -c \
    "(ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -qE ':$1[[:space:]]'" 2>/dev/null
}

# --- backend: binds :3000 only after full NestJS bootstrap ---
if port_up 3000; then clear_cd backend; else restart_proc backend; fi

# --- frontend: Next.js listens on :4200 ---
if port_up 4200; then clear_cd frontend; else restart_proc frontend; fi

# --- orchestrator: Temporal worker must poll task queue 'main' ---
# Only evaluate if temporal is reachable (describe exits non-zero on conn error);
# a temporal outage is not an orchestrator fault and restarting won't help.
if DESC=$(docker exec temporal-admin-tools temporal task-queue describe \
            --task-queue "$TQ" --task-queue-type workflow \
            --address temporal:7233 2>/dev/null); then
  if grep -qE '[0-9]+@[a-z0-9]+' <<<"$DESC"; then
    clear_cd orchestrator
  else
    restart_proc orchestrator
  fi
fi
WD
chmod 700 "$WATCHDOG"
touch "$LOG"; chmod 640 "$LOG"

echo "=== writing cron -> $CRON (every 2 min) ==="
cat > "$CRON" <<CRONF
# Vezdepost process watchdog — auto-recover hung backend/frontend/orchestrator.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/2 * * * * root $WATCHDOG
CRONF
chmod 644 "$CRON"

echo "=== dry-run (should no-op: all three processes currently healthy) ==="
"$WATCHDOG"; echo "exit=$?"

echo
echo "=== verify install ==="
echo "- watchdog:"; ls -l "$WATCHDOG"
echo "- cron:";     ls -l "$CRON"
echo "- port check backend :3000:";  port_up() { docker exec postiz sh -c "(ss -ltn 2>/dev/null||netstat -ltn 2>/dev/null)|grep -qE ':$1[[:space:]]'" 2>/dev/null; }; port_up 3000 && echo "  LISTENING" || echo "  DOWN"
echo "- port check frontend :4200:"; port_up 4200 && echo "  LISTENING" || echo "  DOWN"
echo "- log tail:"; tail -n 5 "$LOG" 2>/dev/null || echo "(log empty — expected on a healthy run)"
echo
echo "Done. Watchdog live (backend/frontend/orchestrator); runs every 2 min."
echo "Manual recovery still: docs/server-scripts/09-restart-hung-orchestrator.sh"
