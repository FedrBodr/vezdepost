#!/usr/bin/env bash
# 09-restart-hung-orchestrator.sh
#
# Recovery for: posts stuck in QUEUE, never publishing.
#
# Root cause: after a container restart/redeploy the orchestrator (Temporal
# worker) can hang during bootstrap and never register a poller on any task
# queue. Symptom: `pm2 list` shows orchestrator "online" but its pm2 log is
# empty past the `npm start` banner, and `temporal task-queue describe` shows
# ZERO pollers. Backend keeps starting post workflows (they show "Running" in
# temporal forever) but nobody executes them -> posts stay QUEUE.
#
# Fix: restart just the orchestrator process now that temporal is healthy.
# Stuck "Running" post workflows resume and publish immediately (including any
# that are past their publishDate).
#
# Safe to re-run. Read-only checks first, then the restart.
set -euo pipefail

echo "=== BEFORE: pollers on task queue 'post' ==="
docker exec temporal-admin-tools temporal task-queue describe \
  --task-queue post --address temporal:7233 2>&1 | sed -n '/Pollers:/,$p' || true

echo
echo "=== restarting orchestrator ==="
docker exec postiz pm2 restart orchestrator

echo
echo "waiting for orchestrator to register a poller (condition-based, max 60s)..."
for i in $(seq 1 20); do
  sleep 3
  if docker exec temporal-admin-tools temporal task-queue describe \
       --task-queue post --address temporal:7233 2>/dev/null \
     | sed -n '/Pollers:/,$p' | grep -qE '@|[0-9]{4}-[0-9]{2}-[0-9]{2}'; then
    echo "poller registered after ~$((i*3))s"
    break
  fi
  echo "  ...still no poller (${i}/20)"
done

echo
echo "=== AFTER: pollers on task queue 'post' ==="
docker exec temporal-admin-tools temporal task-queue describe \
  --task-queue post --address temporal:7233 2>&1 | sed -n '/Pollers:/,$p' || true

echo
echo "=== orchestrator log tail (expect NestJS bootstrap now) ==="
docker exec postiz pm2 logs orchestrator --lines 15 --nostream 2>/dev/null | tail -15
