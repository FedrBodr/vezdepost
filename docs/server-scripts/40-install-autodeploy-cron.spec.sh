#!/usr/bin/env bash
# Tests for 40-install-autodeploy-cron.sh: reproducibly (re)install the
# autodeploy poller cron, idempotently, pointing at the deployed checkout.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/40-install-autodeploy-cron.sh"
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

CRON="$TMP_DIR/cron.d/vezdepost-autodeploy"
mkdir -p "$(dirname "$CRON")"

REPO_DIR="$REPO_ROOT" AUTODEPLOY_CRON="$CRON" bash "$SCRIPT"

[[ -f "$CRON" ]] || fail 'cron file not written'
grep -Eq '^\*/3 \* \* \* \* root ' "$CRON" ||
  fail 'cron does not poll every 3 minutes as root'
grep -q "$REPO_ROOT/deploy/autodeploy.sh" "$CRON" ||
  fail 'cron does not point at the deployed autodeploy.sh'

# idempotent: a second run overwrites cleanly and still succeeds
REPO_DIR="$REPO_ROOT" AUTODEPLOY_CRON="$CRON" bash "$SCRIPT" ||
  fail 'second (idempotent) run failed'
[[ $(grep -c 'autodeploy.sh' "$CRON") -eq 1 ]] ||
  fail 'second run duplicated the cron line'

# refuses to install if the poller is not deployed yet
missing_repo="$TMP_DIR/empty"; mkdir -p "$missing_repo/deploy"
if REPO_DIR="$missing_repo" AUTODEPLOY_CRON="$TMP_DIR/cron2" bash "$SCRIPT" 2>/dev/null; then
  fail 'installed a cron pointing at a missing poller'
fi

echo '40-install-autodeploy-cron.spec.sh: all tests passed'
