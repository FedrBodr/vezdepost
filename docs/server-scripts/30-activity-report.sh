#!/bin/bash
# Активность пользователей и ошибки публикации (read-only, почты замаскированы).
# Запуск:  ssh vezdepost 'bash -s' < docs/server-scripts/30-activity-report.sh
set -euo pipefail

docker exec -i postiz-postgres psql -U postiz-user -d postiz-db-local \
  -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
\echo '=== активность по организациям ==='
select left(u.email, 2) || '***@' || split_part(u.email, '@', 2) as owner,
       u."isSuperAdmin" as sa,
       o."createdAt"::date as registered,
       (select string_agg(distinct i."providerIdentifier", ',')
          from "Integration" i
         where i."organizationId" = o.id and i."deletedAt" is null) as channels,
       count(p.id) as posts_total,
       count(p.id) filter (where p."createdAt" > now() - interval '7 days') as posts_7d,
       count(p.id) filter (where p."createdAt" > now() - interval '30 days') as posts_30d,
       count(p.id) filter (where p.state = 'PUBLISHED') as published,
       count(p.id) filter (where p.state = 'ERROR') as errors,
       max(p."createdAt")::date as last_post
  from "Organization" o
  left join lateral (
        select uo."userId" from "UserOrganization" uo
         where uo."organizationId" = o.id
         order by uo."createdAt" limit 1) first_member on true
  left join "User" u on u.id = first_member."userId"
  left join "Post" p on p."organizationId" = o.id and p."deletedAt" is null
 group by o.id, u.email, u."isSuperAdmin", o."createdAt"
 order by posts_30d desc, o."createdAt";

\echo '=== посты по провайдерам ==='
select i."providerIdentifier" as provider,
       count(*) filter (where p.state = 'PUBLISHED') as published,
       count(*) filter (where p.state = 'ERROR') as errors,
       round(100.0 * count(*) filter (where p.state = 'ERROR') / count(*), 1) as error_pct
  from "Post" p
  join "Integration" i on i.id = p."integrationId"
 where p."deletedAt" is null
 group by 1
 order by errors desc, published desc;

\echo '=== частые ошибки публикации ==='
select i."providerIdentifier" as provider,
       left(regexp_replace(coalesce(p.error, '(пусто)'), '\s+', ' ', 'g'), 140) as error,
       count(*) as cnt,
       max(p."createdAt")::date as last_seen
  from "Post" p
  join "Integration" i on i.id = p."integrationId"
 where p."deletedAt" is null and p.state = 'ERROR'
 group by 1, 2
 order by cnt desc
 limit 20;

\echo '=== каналы, требующие переподключения ==='
select "providerIdentifier" as provider,
       count(*) filter (where "refreshNeeded") as refresh_needed,
       count(*) filter (where disabled) as disabled
  from "Integration"
 where "deletedAt" is null
 group by 1
having count(*) filter (where "refreshNeeded" or disabled) > 0;
SQL
