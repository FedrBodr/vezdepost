#!/bin/bash
# 09-build-benchmark.sh — validate the pnpm-fetch Dockerfile (deploy/Dockerfile)
# before switching prod deploys to it.
#
# Run on the server as root:
#   nohup bash 09-build-benchmark.sh > /root/build-benchmark.log 2>&1 &
#
# Steps:
#   1. prune the buildkit cache (stale Dockerfile.dev-era layers) and
#      dangling images, report reclaimed disk
#   2. fresh clone of the build-speedup branch into /root/postiz-build-test
#      (separate dir — never touches /root/postiz-app that autodeploy manages)
#   3. COLD build, timed (also pre-warms the daemon-wide layer cache, so the
#      first real prod deploy after the switch is warm too)
#   4. code-only change -> WARM build, timed; target: <= 8 min with the
#      dependency layer coming from cache
set -euo pipefail

MAIN_REPO=/root/postiz-app
TEST_DIR=/root/postiz-build-test
BRANCH=build-speedup
TAG=postiz-max:benchmark

echo "=== disk before ==="; df -h /; docker system df

echo "=== pruning build cache + dangling images ==="
docker builder prune -af
docker image prune -f
echo "=== disk after prune ==="; df -h /; docker system df

ORIGIN=$(git -C "$MAIN_REPO" remote get-url origin)
rm -rf "$TEST_DIR"
git clone --branch "$BRANCH" --single-branch "$ORIGIN" "$TEST_DIR"

# same build arg the real deploy passes (empty is fine for timing)
GTM=$(grep -E '^NEXT_PUBLIC_GTM_ID=' "$MAIN_REPO/.env" 2>/dev/null | cut -d= -f2- || true)

cd "$TEST_DIR"
echo "=== COLD build start $(date -Is) ==="
time docker build -f deploy/Dockerfile --build-arg NEXT_PUBLIC_GTM_ID="${GTM:-}" -t "$TAG" .
echo "=== COLD build done $(date -Is) ==="

# code-only change: the deps layer must stay cached
echo "// build-benchmark warm-build probe" >> apps/backend/src/main.ts
echo "=== WARM build start $(date -Is) ==="
time docker build -f deploy/Dockerfile --build-arg NEXT_PUBLIC_GTM_ID="${GTM:-}" -t "$TAG" .
echo "=== WARM build done $(date -Is) ==="

echo "=== disk final ==="; df -h /; docker system df
echo "BENCHMARK COMPLETE"
