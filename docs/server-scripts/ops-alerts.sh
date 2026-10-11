#!/usr/bin/env bash
# Ops alerts for the Vezdepost owner, delivered through the assistant bot.
# Run by cron every 5 minutes (installed by 33-install-ops-alerts.sh).
#
# Each run reports what happened since the previous run: channels that need a
# refresh, failed and stuck posts, refresh failures from the logs, watchdog
# restarts, the postiz container being down outside a deploy and new signups.
# Nothing is sent when nothing happened. The window end is stored only after
# a successful send, so a failed delivery is retried on the next run.
set -uo pipefail

REPO_DIR=${REPO_DIR:-/root/postiz-app}
STATE_DIR=${STATE_DIR:-/var/lib/vezdepost-ops-alerts}
WATCHDOG_LOG=${WATCHDOG_LOG:-/var/log/vezdepost-orchestrator-watchdog.log}
LOG=${LOG:-/var/log/vezdepost-ops-alerts.log}
STUCK_MINUTES=15
MAX_TEXT=3900

log() { echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') $*" >> "$LOG"; }

env_value() {
  grep -E "^$1=" "$REPO_DIR/.env" 2>/dev/null | tail -n 1 | cut -d= -f2-
}

psql_query() {
  docker exec -i postiz-postgres psql -U postiz-user -d postiz-db-local \
    -At -v ON_ERROR_STOP=1 -v since="$since" -v until="$until" 2>> "$LOG"
}

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

token=$(env_value TELEGRAM_ASSISTANT_TOKEN)
if [[ -z "$token" ]]; then
  log 'TELEGRAM_ASSISTANT_TOKEN is missing in .env; nothing sent'
  exit 1
fi

until=$(date -u +'%Y-%m-%d %H:%M:%S')
since=$(cat "$STATE_DIR/last-run" 2>/dev/null || true)
first_run=false
if [[ ! "$since" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}$ ]]; then
  since=$until
  first_run=true
fi

db_up=true
docker exec postiz-postgres true 2>/dev/null || db_up=false

chat_id=$(env_value OPS_ALERT_CHAT_ID)
if [[ -z "$chat_id" && "$db_up" == true ]]; then
  chat_id=$(psql_query <<'SQL'
-- q:chat
select l."telegramUserId"
  from "TelegramAssistantLink" l
  join "User" u on u.id = l."userId"
 where u."isSuperAdmin"
 order by l."updatedAt" desc
 limit 1;
SQL
  )
fi
if [[ ! "$chat_id" =~ ^-?[0-9]+$ ]]; then
  log 'No owner chat: link the superadmin Telegram in the assistant or set OPS_ALERT_CHAT_ID'
  exit 1
fi

lines=()
add_line() { lines+=("$1" ""); }
add_section() {
  local title=$1 body=$2
  [[ -n "$body" ]] || return 0
  lines+=("$title" "$body" "")
}

# --- the app itself -------------------------------------------------------
deploying=false
pgrep -f '^/bin/bash .*/deploy/autodeploy.sh' > /dev/null 2>&1 && deploying=true

# Down/up transitions are reported once; the flag changes only after delivery.
down_flag=keep
if docker exec postiz true 2>/dev/null; then
  if [[ -f "$STATE_DIR/postiz-down" ]]; then
    add_line '✅ Контейнер postiz снова работает'
    down_flag=clear
  fi
elif [[ "$deploying" == false && ! -f "$STATE_DIR/postiz-down" ]]; then
  add_line '🚨 Контейнер postiz не запущен (деплой не идёт)'
  down_flag=set
fi

if [[ "$db_up" == false ]]; then
  add_line '🚨 База postiz-postgres недоступна'
fi

# --- database events ------------------------------------------------------
if [[ "$db_up" == true && "$first_run" == false ]]; then
  broken=$(psql_query <<'SQL'
-- q:broken
select '• ' || i."providerIdentifier" || ' «' || left(i.name, 40) || '» — '
       || coalesce(u.email, '?')
       || case when i."tokenExpiration" is not null
                and abs(extract(epoch from i."updatedAt" - i."tokenExpiration")) < 120
               then ' (на плановом обновлении)' else '' end
  from "Integration" i
  left join lateral (
        select uo."userId" from "UserOrganization" uo
         where uo."organizationId" = i."organizationId"
         order by uo."createdAt" limit 1) owner on true
  left join "User" u on u.id = owner."userId"
 where i."deletedAt" is null and i."refreshNeeded"
   and i."updatedAt" > :'since'::timestamp and i."updatedAt" <= :'until'::timestamp
 order by i."updatedAt";
SQL
  )
  add_section '🔌 Отвалились каналы (нужно переподключение):' "$broken"

  failed=$(psql_query <<'SQL'
-- q:failed
select '• ' || provider || ' — ' || email || ': ' || cnt || ' шт. — ' || reason
  from (
    select i."providerIdentifier" as provider,
           coalesce(u.email, '?') as email,
           left(regexp_replace(
             coalesce(substring(p.error from '"message":"([^"]{1,160})'),
                      p.error, 'без текста ошибки'),
             '\s+', ' ', 'g'), 160) as reason,
           count(*) as cnt
      from "Post" p
      join "Integration" i on i.id = p."integrationId"
      left join lateral (
            select uo."userId" from "UserOrganization" uo
             where uo."organizationId" = p."organizationId"
             order by uo."createdAt" limit 1) owner on true
      left join "User" u on u.id = owner."userId"
     where p."deletedAt" is null and p.state = 'ERROR'
       and p."updatedAt" > :'since'::timestamp and p."updatedAt" <= :'until'::timestamp
     group by 1, 2, 3
  ) failures
 order by cnt desc
 limit 15;
SQL
  )
  add_section '❌ Ошибки публикации:' "$failed"

  stuck=$(psql_query <<SQL
-- q:stuck
select '• ' || i."providerIdentifier" || ' — ' || coalesce(u.email, '?')
       || ': ' || count(*) || ' шт., должны были выйти с '
       || to_char(min(p."publishDate"), 'DD.MM HH24:MI') || ' UTC'
  from "Post" p
  join "Integration" i on i.id = p."integrationId"
  left join lateral (
        select uo."userId" from "UserOrganization" uo
         where uo."organizationId" = p."organizationId"
         order by uo."createdAt" limit 1) owner on true
  left join "User" u on u.id = owner."userId"
 where p."deletedAt" is null and p.state = 'QUEUE' and p."parentPostId" is null
   and p."publishDate" > :'since'::timestamp - interval '$STUCK_MINUTES minutes'
   and p."publishDate" <= :'until'::timestamp - interval '$STUCK_MINUTES minutes'
 group by i."providerIdentifier", u.email;
SQL
  )
  add_section "⏳ Посты не ушли вовремя (в очереди дольше $STUCK_MINUTES мин):" "$stuck"

  signups=$(psql_query <<'SQL'
-- q:signups
select '• ' || email || coalesce(' (' || "providerName"::text || ')', '')
  from "User"
 where "createdAt" > :'since'::timestamp and "createdAt" <= :'until'::timestamp
 order by "createdAt";
SQL
  )
  add_section '🎉 Новые регистрации:' "$signups"
fi

# --- logs -----------------------------------------------------------------
if [[ "$first_run" == false ]]; then
  refresh_failures=$(docker logs --since "${since/ /T}Z" --until "${until/ /T}Z" postiz 2>&1 |
    grep -o 'Refresh failed for .*' | cut -c1-220 | sort | uniq -c | sort -rn | head -n 10 |
    sed -E 's/^ *([0-9]+) /• ×\1 /')
  add_section '⚠️ Сбои обновления токенов:' "$refresh_failures"

  if [[ -f "$WATCHDOG_LOG" ]]; then
    restarts=$(awk -v s="${since/ /T}Z" -v u="${until/ /T}Z" \
      '$1 > s && $1 <= u && /ALERT:/ { sub(/^[^ ]+ ALERT: /, "• "); print }' \
      "$WATCHDOG_LOG" | sort | uniq -c | sed -E 's/^ *1 //; s/^ *([0-9]+) (.*)/\2 ×\1/')
    add_section '🔁 Watchdog перезапускал процессы:' "$restarts"
  fi
fi

if [[ "$first_run" == true ]]; then
  lines=('🔔 Ops-алерты Вездепоста включены. Буду писать сюда о сбоях каналов, ошибках и зависших постах, новых регистрациях.' '' ${lines[@]+"${lines[@]}"})
fi

if [[ ${#lines[@]} -eq 0 ]]; then
  echo "$until" > "$STATE_DIR/last-run"
  exit 0
fi

message_file=$(mktemp)
trap 'rm -f "$message_file"' EXIT
{
  printf '%s\n' "${lines[@]}"
  [[ "$first_run" == true ]] || printf '%s — %s UTC\n' "${since:5:11}" "${until:11:5}"
} | head -c "$MAX_TEXT" > "$message_file"

# The URL with the token goes to curl through stdin, not argv.
response=$(printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$token" |
  curl -sS --max-time 20 -K - \
    --data-urlencode "chat_id=$chat_id" \
    --data-urlencode "text@$message_file" \
    --data-urlencode 'disable_web_page_preview=true' 2>> "$LOG")

if [[ "$response" == *'"ok":true'* ]]; then
  echo "$until" > "$STATE_DIR/last-run"
  case $down_flag in
    set) touch "$STATE_DIR/postiz-down" ;;
    clear) rm -f "$STATE_DIR/postiz-down" ;;
  esac
  log "sent alert for $since .. $until"
else
  log "Telegram send failed: $(printf '%s' "$response" | tr -d '\n' | cut -c1-200)"
  exit 1
fi
