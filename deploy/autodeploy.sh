#!/bin/bash
# Polls origin/prod and redeploys on new commits. Installed on the server via:
#   cp deploy/vezdepost-autodeploy.cron /etc/cron.d/vezdepost-autodeploy
# Logs to /var/log/vezdepost-autodeploy.log.
set -euo pipefail

REPO_DIR=${REPO_DIR:-/root/postiz-app}
LOG=${AUTODEPLOY_LOG:-/var/log/vezdepost-autodeploy.log}
LOCK=${AUTODEPLOY_LOCK:-/var/lock/vezdepost-autodeploy.lock}
STATE=${AUTODEPLOY_STATE:-/var/lib/vezdepost-deployed-rev}
READINESS_SCRIPT=${READINESS_SCRIPT:-$REPO_DIR/deploy/check-readiness.sh}

# a build takes ~10 min; skip silently if a previous run is still going
exec 9>"$LOCK"
flock -n 9 || exit 0

cd "$REPO_DIR"
git fetch --no-recurse-submodules origin prod

# compare against the last SUCCESSFUL deploy, not HEAD: a failed deploy
# (e.g. image pull error) already moved HEAD and would never be retried
REMOTE=$(git rev-parse origin/prod)
DEPLOYED=$(cat "$STATE" 2>/dev/null || echo none)
[ "$DEPLOYED" = "$REMOTE" ] && exit 0

# landing/blog/short links are caddy bind-mounts and docs/*.md are in
# .dockerignore, so such a change needs no app image. Skipping compose also
# keeps postiz running: even a fully cached rebuild gets a new image id (its
# attestation manifest) and compose recreates the container (WOK-655).
# Unknown history (first deploy, force-push) always rebuilds.
needs_image() {
  local changed
  [ "$DEPLOYED" = none ] && return 0
  # --no-renames: a move out of apps/ into docs/ must list the old path too
  changed=$(git diff --no-renames --name-only "$DEPLOYED" "$REMOTE") || return 0
  grep -qvE '^(deploy/(landing|blog|links)/|docs/)|\.md$' <<<"$changed"
}

{
  echo "$(date -Is) deploying $DEPLOYED -> $REMOTE"
  # hard reset instead of pull: prod may be force-updated; untracked
  # server files (.env, max-extra-ca.pem) are not touched
  git reset --hard "$REMOTE"
  if needs_image; then
    # containerd image store drops the old image when the tag moves; keep the
    # running one as :prev so a rollback is a retag, not a 30-minute rebuild
    docker tag postiz-max:local postiz-max:prev 2>/dev/null || true
    docker compose up -d --build
  else
    echo "$(date -Is) static-only change: app image rebuild skipped"
  fi
  # re-read deploy/links (short links) without restarting caddy; a broken
  # links file keeps the previous config and must not block the app deploy
  docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile ||
    echo "$(date -Is) WARN caddy reload failed, short links not applied"
  # the Caddyfile itself is a single-file mount that keeps the old inode
  # after git reset; script 29 recreates caddy only when the file changed
  bash "$REPO_DIR/docs/server-scripts/29-apply-caddyfile.sh" ||
    echo "$(date -Is) WARN Caddyfile not applied"
  "$READINESS_SCRIPT"
  echo "$REMOTE" > "$STATE"
  echo "$(date -Is) deploy finished"
} >> "$LOG" 2>&1
