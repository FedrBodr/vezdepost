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

{
  echo "$(date -Is) deploying $DEPLOYED -> $REMOTE"
  # hard reset instead of pull: prod may be force-updated; untracked
  # server files (.env, max-extra-ca.pem) are not touched
  git reset --hard "$REMOTE"
  docker compose up -d --build
  "$READINESS_SCRIPT"
  echo "$REMOTE" > "$STATE"
  echo "$(date -Is) deploy finished"
} >> "$LOG" 2>&1
