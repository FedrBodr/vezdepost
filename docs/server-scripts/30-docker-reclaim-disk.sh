#!/bin/bash
# Освободить диск: образы, не используемые ни одним контейнером (в т.ч.
# остановленным), и build cache старше KEEP_HOURS. Свежий кэш остаётся,
# чтобы следующая сборка не шла с нуля. Не трогает volumes и контейнеры.
# Отказывается работать во время активной сборки автодеплоя.
# Запуск:  ssh vezdepost 'bash -s' < docs/server-scripts/30-docker-reclaim-disk.sh
set -euo pipefail

KEEP_HOURS=${KEEP_HOURS:-72}

if pgrep -f '^docker compose up -d --build$' >/dev/null; then
  echo "active compose build in progress; retry later" >&2
  exit 1
fi

echo "before: $(df -h / | tail -1)"
docker system df

docker image prune -a -f --filter "until=${KEEP_HOURS}h" | tail -1
docker builder prune -f --filter "until=${KEEP_HOURS}h" | tail -1

echo "after: $(df -h / | tail -1)"
docker system df
