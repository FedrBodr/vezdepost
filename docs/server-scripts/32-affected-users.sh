#!/bin/bash
# Пользователи, у которых отвалились каналы или падали публикации (read-only).
# Выводит почты: нужен для личной связи с пострадавшими, вывод не публиковать.
# Запуск:  ssh vezdepost 'bash -s' < docs/server-scripts/32-affected-users.sh
set -euo pipefail

docker exec -i postiz-postgres psql -U postiz-user -d postiz-db-local \
  -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
\echo '=== отвалившиеся и зависшие каналы (все провайдеры) ==='
-- died_on_refresh: канал умер на плановом обновлении (updatedAt ~ tokenExpiration)
select u.email,
       u."isSuperAdmin" as sa,
       i."providerIdentifier" as provider,
       left(i.name, 28) as name,
       i."createdAt"::date as connected,
       case
         when i."refreshNeeded" then 'refresh_needed'
         when i."inBetweenSteps" then 'between_steps'
         else 'disabled'
       end as state,
       to_char(i."updatedAt", 'YYYY-MM-DD HH24:MI') as broke_at,
       round(extract(epoch from i."updatedAt" - i."createdAt") / 86400, 1) as lived_days,
       i."tokenExpiration" is not null
         and abs(extract(epoch from i."updatedAt" - i."tokenExpiration")) < 120
         as died_on_refresh,
       (select count(*) from "Post" p
         where p."integrationId" = i.id and p."deletedAt" is null
           and p.state = 'PUBLISHED') as published
  from "Integration" i
  left join lateral (
        select uo."userId" from "UserOrganization" uo
         where uo."organizationId" = i."organizationId"
         order by uo."createdAt" limit 1) owner on true
  left join "User" u on u.id = owner."userId"
 where i."deletedAt" is null
   and (i."refreshNeeded" or i."inBetweenSteps" or i.disabled)
 order by u.email, i."updatedAt";

\echo '=== сводка по пользователям ==='
select u.email,
       u."isSuperAdmin" as sa,
       u."createdAt"::date as registered,
       count(distinct i.id) filter (where i."deletedAt" is null) as channels,
       count(distinct i.id) filter (
         where i."deletedAt" is null
           and (i."refreshNeeded" or i."inBetweenSteps" or i.disabled)) as broken,
       count(distinct i.id) filter (where i."deletedAt" is not null) as removed,
       count(distinct p.id) filter (where p.state = 'PUBLISHED') as published,
       count(distinct p.id) filter (where p.state = 'ERROR') as errors,
       max(p."createdAt")::date as last_post
  from "User" u
  join "UserOrganization" uo on uo."userId" = u.id
  left join "Integration" i on i."organizationId" = uo."organizationId"
  left join "Post" p on p."organizationId" = uo."organizationId"
                     and p."deletedAt" is null
 group by u.email, u."isSuperAdmin", u."createdAt"
having count(distinct i.id) > 0
 order by broken desc, errors desc, u."createdAt";
SQL
