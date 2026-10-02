#!/bin/bash
# Применить deploy/Caddyfile из репозитория к работающему caddy.
#
# Caddyfile смонтирован в контейнер как один файл: git reset/checkout
# заменяет файл новым inode, и контейнер продолжает видеть старую версию
# (--watch тоже). Поэтому: валидируем новый файл в одноразовом контейнере,
# пересоздаём только caddy (несколько секунд простоя всех сайтов за ним),
# проверяем HTTPS.
# Запуск:  ssh vezdepost 'bash -s' < docs/server-scripts/29-apply-caddyfile.sh
set -euo pipefail

REPO_DIR=${REPO_DIR:-/root/postiz-app}
cd "$REPO_DIR"

if docker exec caddy cat /etc/caddy/Caddyfile | cmp -s - deploy/Caddyfile; then
  echo "caddy already runs the repository Caddyfile"
  exit 0
fi

docker run --rm \
  -v "$REPO_DIR/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v /etc/caddy/sites:/etc/caddy/sites:ro \
  caddy:2 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
  2>&1 | tail -1

docker compose up -d --no-deps --force-recreate caddy

for i in $(seq 1 30); do
  if curl -fsS -o /dev/null https://vezdepost.ru/ &&
     curl -fsS -o /dev/null https://app.vezdepost.ru/auth; then
    break
  fi
  sleep 2
done

docker exec caddy cat /etc/caddy/Caddyfile | cmp -s - deploy/Caddyfile
for url in https://vezdepost.ru/ https://app.vezdepost.ru/auth; do
  echo "$url -> $(curl -s -o /dev/null -w '%{http_code}' "$url")"
done
ls /etc/caddy/sites/*.caddy 2>/dev/null | while read -r site; do
  host=$(grep -m1 -E '^[A-Za-z0-9.-]+\.[A-Za-z]+[ ,{]' "$site" | awk '{print $1}' | tr -d ',{' || true)
  [ -n "$host" ] && echo "https://$host -> $(curl -s -o /dev/null -w '%{http_code}' "https://$host/")"
done
