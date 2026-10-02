#!/bin/bash
# Диагностика протухания VK-токенов (read-only). Токены не выводятся:
# только короткие хэши, чтобы увидеть общий refresh token или device_id.
# Запуск:  ssh vezdepost 'bash -s' < docs/server-scripts/31-vk-token-diagnostics.sh
set -euo pipefail

docker exec -i postiz-postgres psql -U postiz-user -d postiz-db-local \
  -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
\echo '=== VK-каналы: токены и состояние ==='
select left(md5(i."organizationId"), 6) as org,
       i."providerIdentifier" as provider,
       left(i.name, 28) as name,
       left(coalesce(i."rootInternalId", ''), 26) as root,
       to_char(i."createdAt", 'MM-DD HH24:MI') as created,
       to_char(i."updatedAt", 'MM-DD HH24:MI') as updated,
       to_char(i."tokenExpiration", 'MM-DD HH24:MI') as token_exp,
       i."refreshNeeded" as refresh_needed,
       i."inBetweenSteps" as between,
       i."deletedAt" is not null as deleted,
       left(md5(split_part(i."refreshToken", '&&&&', 1)), 8) as refresh_hash,
       left(md5(split_part(i."refreshToken", '&&&&', 2)), 8) as device_hash,
       left(md5(i.token), 8) as access_hash
  from "Integration" i
 where i."providerIdentifier" in ('vk', 'vk-group')
 order by org, i."createdAt";

\echo '=== VK-ошибки по времени ==='
select left(md5(p."organizationId"), 6) as org,
       i."providerIdentifier" as provider,
       left(i.name, 28) as name,
       to_char(p."publishDate", 'MM-DD HH24:MI') as publish,
       left(regexp_replace(coalesce(p.error, ''), '\s+', ' ', 'g'), 90) as error
  from "Post" p
  join "Integration" i on i.id = p."integrationId"
 where p."deletedAt" is null and p.state = 'ERROR'
   and i."providerIdentifier" in ('vk', 'vk-group')
 order by p."publishDate" desc
 limit 25;
SQL
