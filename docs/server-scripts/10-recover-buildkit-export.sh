#!/usr/bin/env bash
set -euo pipefail

MIN_AGE_SECONDS=${MIN_AGE_SECONDS:-600}
mapfile -t build_pids < <(pgrep -f '^docker compose up -d --build$' || true)

if [ ${#build_pids[@]} -eq 0 ]; then
  echo 'No active Docker Compose build found; nothing to recover'
  exit 0
fi

for pid in "${build_pids[@]}"; do
  age=$(ps -o etimes= -p "$pid" | tr -d ' ')
  if [ -z "$age" ] || [ "$age" -lt "$MIN_AGE_SECONDS" ]; then
    echo "Refusing to stop build process $pid younger than ${MIN_AGE_SECONDS}s" >&2
    exit 1
  fi
done

kill "${build_pids[@]}"

for _ in $(seq 1 20); do
  alive=false
  for pid in "${build_pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      alive=true
    fi
  done
  if [ "$alive" = false ]; then
    break
  fi
  sleep 1
done

for pid in "${build_pids[@]}"; do
  if kill -0 "$pid" 2>/dev/null; then
    echo "Build process $pid did not stop after SIGTERM" >&2
    exit 1
  fi
done

systemctl restart docker
systemctl is-active --quiet docker

echo 'Docker restarted; autodeploy can retry the unchanged successful target'
