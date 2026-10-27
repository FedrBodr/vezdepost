#!/usr/bin/env bash
# 41-docker-cleanup.sh — reclaim disk from Docker build cache (WOK-655).
#
# DRY RUN by default: prints what would be removed and changes nothing.
# Apply:  ssh vezdepost 'APPLY=1 bash -s' < docs/server-scripts/41-docker-cleanup.sh
# Dry:    ssh vezdepost 'bash -s' < docs/server-scripts/41-docker-cleanup.sh
#
# What it removes (APPLY=1 only):
#   - unshared BuildKit cache records (not a layer of any image) idle for
#     KEEP_HOURS (default 72h), and unshared postiz pnpm install/build records.
#     WARNING: after the 2026-10-27 run the next build missed the cache from
#     the apt step on (a compose-only commit became a ~35-minute full build),
#     although the live image's own records were kept. Run it right before a
#     planned code deploy, not before a cache-only one.
#   - Dangling images that no container (running or stopped) references.
# What it never touches:
#   - images used by any container, all postiz-max:* tags (rollback),
#   - tagged images of the other projects on this box (ksy-deals, studio, …):
#     unused ones are only LISTED for the owner to decide,
#   - volumes, containers, networks.
#
# Holds the autodeploy lock for the whole run, so it neither races an active
# build nor lets cron start one mid-cleanup. Supersedes 30-docker-reclaim-disk.sh,
# whose `image prune -a` would also delete other projects' unused rollback tags.
set -euo pipefail

APPLY=${APPLY:-0}
KEEP_HOURS=${KEEP_HOURS:-72}
LOCK=${AUTODEPLOY_LOCK:-/var/lock/vezdepost-autodeploy.lock}

exec 9>"$LOCK"
flock -n 9 || { echo "autodeploy is running (lock held); retry later" >&2; exit 1; }

echo "=== before: $(df -h / | tail -1)"
docker system df

echo
echo "=== build cache records to prune (unshared, i.e. not a layer of any image)"
# `builder prune --filter until=` proved unreliable here (containerd store: it
# freed 275 MB of ~10 GB and bumped "Last used" on records it walked), so pick
# records by id. Candidates: unshared records idle for KEEP_HOURS, plus every
# unshared postiz `pnpm install`/`pnpm run build` record — any code commit
# invalidates those anyway, and the live image's own layers are shared.
cache_ids=()
while read -r id size desc; do
  cache_ids+=("$id"); echo "$id $size $desc"
done < <(docker buildx du --verbose | awk -v keep="$KEEP_HOURS" '
  function hours(s,  n) { n = s + 0; if (n == 0) n = 1
    if (s ~ /minute|second/) return 0; if (s ~ /hour/) return n
    if (s ~ /day/) return n * 24; if (s ~ /week/) return n * 168
    if (s ~ /month/) return n * 720; return n * 8760 }
  /^ID:/ { id = $2; desc = "" }
  /^Shared:/ { shared = $2 }
  /^Size:/ { size = $2 }
  /^Description:/ { sub(/^Description: +/, ""); desc = substr($0, 1, 70) }
  /^Last used:/ { sub(/^Last used: +/, "")
    if (shared == "false" && (hours($0) >= keep || desc ~ /c pnpm (install|run build)/))
      print id, size, desc }')
[ ${#cache_ids[@]} -eq 0 ] && echo "(none)"

used_images=$(docker ps -aq | xargs -r docker inspect -f '{{.Image}}' | sort -u)
is_used() { grep -q "$(docker image inspect -f '{{.Id}}' "$1")" <<<"$used_images"; }

echo
echo "=== dangling images not used by any container (would be removed)"
dangling=()
for id in $(docker images -q -f dangling=true | sort -u); do
  is_used "$id" && continue
  # containerd store can list a tagged image as dangling too (seen with ksy's
  # banner-scraper rollback tag) — never remove an ID that still has a tag
  # (awk, not grep -q: under pipefail an early-exiting grep could SIGPIPE the
  # pipeline and skip exactly this guard)
  tags=$(docker images --format '{{.ID}} {{.Tag}}' | awk -v id="$id" '$1 == id && $2 != "<none>"')
  [ -n "$tags" ] && continue
  dangling+=("$id")
  docker images -f dangling=true --format '{{.ID}} {{.CreatedSince}} {{.Size}}' | awk -v id="$id" '$1 == id'
done
[ ${#dangling[@]} -eq 0 ] && echo "(none)"

echo
echo "=== tagged images not used by any container (KEPT, owner decides)"
docker images --format '{{.ID}} {{.Repository}}:{{.Tag}} {{.CreatedSince}} {{.Size}}' |
  while read -r id rest; do is_used "$id" || echo "$id $rest"; done

if [ "$APPLY" != 1 ]; then
  echo
  echo "DRY RUN: nothing removed. Re-run with APPLY=1 after review."
  exit 0
fi

echo
echo "=== applying"
for id in "${cache_ids[@]}"; do docker builder prune -f --filter "id=$id" | tail -n 1; done
for id in "${dangling[@]}"; do docker rmi "$id" || echo "WARN could not remove $id"; done

echo
echo "=== after: $(df -h / | tail -1)"
docker system df
