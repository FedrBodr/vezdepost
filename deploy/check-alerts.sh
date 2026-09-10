#!/usr/bin/env bash
# Vezdepost ops alerts — Telegram notifications when production signals drift.
# Installed as a root cron job (*/15 * * * *). State file prevents repeat alerts
# within the cooldown window. All thresholds are tuned at the top.
#
# Checks:
#   1. postiz app container is running and backend answers 200
#   2. root filesystem disk usage
#   3. uploads docker volume size (media accumulation)
#   4. rich-message fallback warnings in the app logs (rich transport failing)
#   5. /uploads request volume in Caddy logs over the last 24h (bandwidth proxy)
set -u

REPO_DIR="${REPO_DIR:-/root/postiz-app}"
STATE_DIR="/var/lib/vezdepost-alerts"
mkdir -p "$STATE_DIR"

# --- tuning -----------------------------------------------------------------
ROOT_DISK_PERCENT=85
UPLOADS_GB=5
UPLOADS_REQUESTS_PER_DAY=50000
RICH_FALLBACK_MAX_PER_WINDOW=10
COOLDOWN_MINUTES=180

# --- alert transport --------------------------------------------------------
if [ -f "$REPO_DIR/.env" ]; then
  # shellcheck disable=SC1091
  set -a; . "$REPO_DIR/.env"; set +a
fi
BOT_TOKEN="${TELEGRAM_TOKEN:-}"
CHAT_ID="${TELEGRAM_ALERT_CHAT_ID:-}"

send_alert() {
  local message="$1"
  echo "$(date -Is) ALERT: $message" >>"$STATE_DIR/alerts.log"
  if [ -n "$BOT_TOKEN" ] && [ -n "$CHAT_ID" ]; then
    curl -s -m 10 -o /dev/null \
      "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${CHAT_ID}" \
      --data-urlencode "text=[vezdepost] ${message}" >/dev/null
  fi
}

in_cooldown() {
  local key="$1"
  local marker="$STATE_DIR/${key}.last"
  if [ -f "$marker" ]; then
    local last now
    last=$(cat "$marker" 2>/dev/null || echo 0)
    now=$(date +%s)
    [ $((now - last)) -lt $((COOLDOWN_MINUTES * 60)) ] && return 0
  fi
  date +%s >"$marker"
  return 1
}

# --- 1. app container + backend --------------------------------------------
if ! docker ps --format '{{.Names}}' | grep -qx 'postiz'; then
  in_cooldown app_down && exit 0
  send_alert "postiz container is NOT running"
elif ! docker exec postiz node -e \
  "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))" \
  >/dev/null 2>&1; then
  in_cooldown backend_down && exit 0
  send_alert "postiz backend is not answering inside the container"
fi

# --- 2. root filesystem ------------------------------------------------------
root_used=$(df -P / | awk 'NR==2 {gsub("%",""); print $5}')
if [ "${root_used:-100}" -ge "$ROOT_DISK_PERCENT" ]; then
  in_cooldown disk_root && exit 0
  send_alert "root filesystem at ${root_used}% (threshold ${ROOT_DISK_PERCENT}%)"
fi

# --- 3. uploads volume size ---------------------------------------------------
uploads_volume="/var/lib/docker/volumes/postiz-app_postiz-uploads/_data"
if [ -d "$uploads_volume" ]; then
  uploads_gb=$(du -sg "$uploads_volume" 2>/dev/null | awk '{print $1}')
  if [ "${uploads_gb:-0}" -ge "$UPLOADS_GB" ]; then
    in_cooldown uploads_size && exit 0
    send_alert "uploads volume at ${uploads_gb}GB (threshold ${UPLOADS_GB}GB) — plan media retention or a CDN"
  fi
fi

# --- 4. rich-message fallback warnings ---------------------------------------
rich_fallbacks=$(docker logs postiz --since 15m 2>&1 | grep -c 'rich message failed' || true)
if [ "${rich_fallbacks:-0}" -gt "$RICH_FALLBACK_MAX_PER_WINDOW" ]; then
  in_cooldown rich_fallback && exit 0
  send_alert "rich-message fallback fired ${rich_fallbacks}x in 15m (threshold ${RICH_FALLBACK_MAX_PER_WINDOW}) — check rich payload/API status"
fi

# --- 5. media request volume (Caddy, last 24h) --------------------------------
media_requests=$(docker logs caddy --since 24h 2>&1 | grep -c 'GET /uploads/' || true)
if [ "${media_requests:-0}" -ge "$UPLOADS_REQUESTS_PER_DAY" ]; then
  in_cooldown media_traffic && exit 0
  send_alert "/uploads served ${media_requests}x in 24h (threshold ${UPLOADS_REQUESTS_PER_DAY}) — consider moving media off the app origin"
fi

exit 0
