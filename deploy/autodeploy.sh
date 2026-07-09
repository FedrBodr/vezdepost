#!/bin/bash
# Polls origin/prod and redeploys on new commits. Installed on the server via:
#   cp deploy/vezdepost-autodeploy.cron /etc/cron.d/vezdepost-autodeploy
# Logs to /var/log/vezdepost-autodeploy.log.
set -euo pipefail

REPO_DIR=/root/postiz-app
LOG=/var/log/vezdepost-autodeploy.log

# a build takes ~10 min; skip silently if a previous run is still going
exec 9>/var/lock/vezdepost-autodeploy.lock
flock -n 9 || exit 0

cd "$REPO_DIR"
git fetch --no-recurse-submodules origin prod

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/prod)
[ "$LOCAL" = "$REMOTE" ] && exit 0

{
  echo "$(date -Is) deploying $LOCAL -> $REMOTE"
  # hard reset instead of pull: prod may be force-updated; untracked
  # server files (.env, max-extra-ca.pem) are not touched
  git reset --hard "$REMOTE"
  docker compose up -d --build
  echo "$(date -Is) deploy finished"
} >> "$LOG" 2>&1
