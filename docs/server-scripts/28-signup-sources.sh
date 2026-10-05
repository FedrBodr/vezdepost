#!/bin/bash
# Откуда пришли зарегистрированные пользователи (read-only, почты замаскированы).
# Источник — first-touch cookie vp_first_touch, записанная в User.signupSource.
# Запуск:  ssh vezdepost 'bash -s' < docs/server-scripts/28-signup-sources.sh
set -euo pipefail

docker exec -i postiz-postgres psql -U postiz-user -d postiz-db-local \
  -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
\echo '=== регистрации и источник первого визита ==='
select u."createdAt"::date as registered,
       left(u.email, 2) || '***@' || split_part(u.email, '@', 2) as email,
       u."providerName" as login,
       u."signupSource"->>'src' as first_seen_on,
       case when u."signupSource" is null then '(нет данных)'
            else coalesce(nullif(u."signupSource"->>'ref', ''), '(direct)')
       end as referrer,
       u."signupSource"->'utm'->>'utm_source' as utm_source,
       u."signupSource"->'utm'->>'utm_campaign' as utm_campaign,
       u."signupSource"->>'path' as entry_path,
       u."signupSource"->>'at' as first_visit_at
  from "User" u
 where u."createdAt" > now() - interval '90 days'
 order by u."createdAt" desc;

\echo '=== сводка по источникам (90 дней) ==='
select coalesce(u."signupSource"->'utm'->>'utm_source',
                nullif(split_part(split_part(u."signupSource"->>'ref', '://', 2), '/', 1), ''),
                case when u."signupSource" is null then '(нет данных)' else '(direct)' end) as source,
       count(*) as users
  from "User" u
 where u."createdAt" > now() - interval '90 days'
 group by 1
 order by 2 desc;
SQL
