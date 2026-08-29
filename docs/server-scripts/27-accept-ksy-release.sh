#!/usr/bin/env bash
# Accept one running immutable KSY release without provider or state mutation.
set -euo pipefail
umask 077

KSY_ROOT=${KSY_ROOT:-/opt/ksy-deals}
EVIDENCE_FILE="$KSY_ROOT/deployment-evidence.json"
TEST_MODE=${KSY_RELEASE_TEST_MODE:-0}
WORK_PARENT=${KSY_RELEASE_WORK_PARENT:-/tmp}
WORK_DIR=$(mktemp -d "$WORK_PARENT/ksy-release-accept.XXXXXX")
chmod 700 "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT HUP INT TERM

fail() { printf 'KSY_RELEASE_ACCEPT_FAILED %s\n' "$1" >&2; exit 1; }
file_mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }

disk_used_percent() {
  if [[ "$TEST_MODE" == 1 ]]; then
    [[ "${KSY_RELEASE_TEST_DISK_USED_PERCENT:-}" =~ ^[0-9]+$ ]] ||
      fail TEST_DISK_PERCENT_INVALID
    printf '%s\n' "$KSY_RELEASE_TEST_DISK_USED_PERCENT"
  else
    df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }'
  fi
}

http_status() {
  local label=$1 url=$2
  shift 2
  curl --silent --show-error --output "$WORK_DIR/http-$label.body" \
    --write-out '%{http_code}' "$@" "$url" 2>"$WORK_DIR/http-$label.stderr"
}

memory_to_bytes() {
  local value=${1//[[:space:]]/}
  [[ "$value" =~ ^([0-9]+([.][0-9]+)?)(B|KiB|MiB|GiB)$ ]] || return 1
  awk -v amount="${BASH_REMATCH[1]}" -v unit="${BASH_REMATCH[3]}" '
    BEGIN {
      multiplier = unit == "GiB" ? 1073741824 : unit == "MiB" ? 1048576 : unit == "KiB" ? 1024 : 1
      printf "%.0f\n", amount * multiplier
    }'
}

[[ $# -eq 0 ]] || fail ARGUMENTS_INVALID
[[ "$TEST_MODE" == 1 || $EUID -eq 0 ]] || fail ROOT_REQUIRED
[[ -f "$EVIDENCE_FILE" && ! -L "$EVIDENCE_FILE" ]] || fail DEPLOYMENT_EVIDENCE_INVALID
[[ "$(file_mode "$EVIDENCE_FILE")" == 600 ]] || fail DEPLOYMENT_EVIDENCE_MODE_INVALID
if [[ "$TEST_MODE" != 1 ]]; then
  [[ "$(stat -c '%U:%G' "$EVIDENCE_FILE")" == root:root ]] ||
    fail DEPLOYMENT_EVIDENCE_OWNER_INVALID
fi
command -v jq >/dev/null 2>&1 || fail JQ_REQUIRED

expected_image=$(jq -er '.image | select(test("^ghcr\\.io/fedrbodr/ksy-deals@sha256:[a-f0-9]{64}$"))' \
  "$EVIDENCE_FILE" 2>"$WORK_DIR/jq.stderr") || fail DEPLOYMENT_EVIDENCE_INVALID
used=$(disk_used_percent)
[[ "$used" =~ ^[0-9]+$ && "$used" -lt 85 ]] || fail DISK_USAGE_LIMIT

docker_cmd=(docker --host unix:///var/run/docker.sock)
server_id=$("${docker_cmd[@]}" ps \
  --filter label=com.docker.compose.project=ksy-deals \
  --filter label=com.docker.compose.service=server --format '{{.ID}}') ||
  fail CONTAINER_ID_MISSING
db_id=$("${docker_cmd[@]}" ps \
  --filter label=com.docker.compose.project=ksy-deals \
  --filter label=com.docker.compose.service=db --format '{{.ID}}') ||
  fail CONTAINER_ID_MISSING
[[ "$server_id" =~ ^[A-Za-z0-9_.-]+$ && "$db_id" =~ ^[A-Za-z0-9_.-]+$ ]] ||
  fail CONTAINER_ID_MISSING

container_image=$("${docker_cmd[@]}" inspect --format '{{.Config.Image}}' "$server_id") ||
  fail IMAGE_INSPECTION_FAILED
container_image_id=$("${docker_cmd[@]}" inspect --format '{{.Image}}' "$server_id") ||
  fail IMAGE_INSPECTION_FAILED
resolved_image_id=$("${docker_cmd[@]}" image inspect --format '{{.Id}}' "$expected_image") ||
  fail IMAGE_INSPECTION_FAILED
[[ "$container_image" == "$expected_image" ]] || fail IMAGE_REFERENCE_MISMATCH
[[ "$container_image_id" == "$resolved_image_id" ]] || fail IMAGE_ID_MISMATCH

root_status=$(http_status root http://127.0.0.1:4300/) || fail ROOT_FAILED
[[ "$root_status" == 200 ]] || fail ROOT_FAILED
live_status=$(http_status live http://127.0.0.1:4300/health/live) || fail LIVE_FAILED
[[ "$live_status" == 200 ]] || fail LIVE_FAILED
ready_status=$(http_status ready http://127.0.0.1:4300/health/ready) || fail READY_FAILED
[[ "$ready_status" == 200 ]] || fail READY_FAILED
admin_status=$(http_status admin http://127.0.0.1:4300/api/admin/auth/session) ||
  fail ADMIN_AUTH_BOUNDARY_FAILED
[[ "$admin_status" == 401 ]] || fail ADMIN_AUTH_BOUNDARY_FAILED
invalid_feed_status=$(http_status invalid-feed http://127.0.0.1:4300/public/store/v1/feed.json \
  --header 'Authorization: Bearer ksy-release-invalid-token') ||
  fail FEED_INVALID_TOKEN_BOUNDARY_FAILED
[[ "$invalid_feed_status" == 401 ]] || fail FEED_INVALID_TOKEN_BOUNDARY_FAILED

feed_probe='// KSY_RELEASE_FEED_PROBE_V1
const token = process.env.FEED_TOKEN;
if (!token) process.exit(71);
const response = await fetch("http://127.0.0.1:3000/public/store/v1/feed.json", {
  headers: { authorization: `Bearer ${token}` }
});
let version = null;
try { version = (await response.json()).version; } catch {}
process.stdout.write(JSON.stringify({ status: response.status, version }));'
if ! "${docker_cmd[@]}" exec "$server_id" node --input-type=module -e "$feed_probe" \
  >"$WORK_DIR/feed.json" 2>"$WORK_DIR/feed.stderr"; then
  fail FEED_CONFIGURED_TOKEN_FAILED
fi
feed_status=$(jq -er '.status | select(type == "number")' "$WORK_DIR/feed.json" 2>/dev/null) ||
  fail FEED_CONFIGURED_TOKEN_FAILED
[[ "$feed_status" == 200 ]] || fail FEED_CONFIGURED_TOKEN_FAILED
feed_version=$(jq -er '.version | select(type == "number")' "$WORK_DIR/feed.json" 2>/dev/null) ||
  fail FEED_VERSION_INVALID
[[ "$feed_version" == 1 ]] || fail FEED_VERSION_INVALID

database_probe='// KSY_RELEASE_DATABASE_PROBE_V1
import pg from "pg";
import { migrationNames } from "./packages/db/dist/migrate.js";
const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const migrations = await client.query("SELECT name FROM schema_migrations ORDER BY name");
  const applied = migrations.rows.map(({ name }) => name);
  const expected = [...migrationNames].sort();
  const unique = new Set(applied);
  const migrationSet = unique.size === applied.length && applied.length === expected.length &&
    applied.every((name, index) => name === expected[index]) ? "MATCH" : "MISMATCH";
  const formats = await client.query("SELECT format FROM deal_post_format_settings WHERE singleton=true");
  const postFormat = formats.rowCount === 1 ? formats.rows[0].format : null;
  process.stdout.write(JSON.stringify({ migrationSet, postFormat }));
} finally {
  await client.end().catch(() => undefined);
}'
if ! "${docker_cmd[@]}" exec "$server_id" node --input-type=module -e "$database_probe" \
  >"$WORK_DIR/database.json" 2>"$WORK_DIR/database.stderr"; then
  fail DATABASE_EVIDENCE_FAILED
fi
migration_set=$(jq -er '.migrationSet | select(. == "MATCH")' "$WORK_DIR/database.json" 2>/dev/null) ||
  fail DATABASE_EVIDENCE_INVALID
post_format=$(jq -er '.postFormat | select(. == "ONE_LINE" or . == "TWO_LINES" or . == "THREE_LINES")' \
  "$WORK_DIR/database.json" 2>/dev/null) || fail DATABASE_EVIDENCE_INVALID

state_format='{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.Health.Status}}|{{.HostConfig.Memory}}'
server_state=$("${docker_cmd[@]}" inspect --format "$state_format" "$server_id") ||
  fail CONTAINER_STATE_UNHEALTHY
db_state=$("${docker_cmd[@]}" inspect --format "$state_format" "$db_id") ||
  fail CONTAINER_STATE_UNHEALTHY
[[ "$server_state" == '0|false|healthy|1073741824' &&
  "$db_state" == '0|false|healthy|536870912' ]] || fail CONTAINER_STATE_UNHEALTHY

server_usage=$("${docker_cmd[@]}" stats --no-stream --format '{{.MemUsage}}' "$server_id") ||
  fail CONTAINER_MEMORY_INVALID
db_usage=$("${docker_cmd[@]}" stats --no-stream --format '{{.MemUsage}}' "$db_id") ||
  fail CONTAINER_MEMORY_INVALID
server_memory=$(memory_to_bytes "${server_usage%%/*}") || fail CONTAINER_MEMORY_INVALID
db_memory=$(memory_to_bytes "${db_usage%%/*}") || fail CONTAINER_MEMORY_INVALID
((server_memory < 1073741824 && db_memory < 536870912)) || fail CONTAINER_MEMORY_INVALID

candidate="$WORK_DIR/evidence.txt"
printf 'KSY_RELEASE_ACCEPTED image=%s root=200 live=200 ready=200 admin=401 feedInvalid=401 feedConfigured=200 feedVersion=1 migrations=%s postFormat=%s\n' \
  "$expected_image" "$migration_set" "$post_format" > "$candidate"
printf 'KSY_RELEASE_RESOURCE_EVIDENCE server_restart=0 server_oom=false server_health=healthy server_limit=1g server_memory_bytes=%s db_restart=0 db_oom=false db_health=healthy db_limit=512m db_memory_bytes=%s disk_used_percent=%s\n' \
  "$server_memory" "$db_memory" "$used" >> "$candidate"
chmod 600 "$candidate"
if grep -Eiq 'Authorization|Bearer|FEED_TOKEN|DATABASE_URL|POSTGRES_PASSWORD|SESSION_COOKIE_KEY|TELEGRAM_|PLATPRICES_|BACKUP_ENCRYPTION_PASSPHRASE|postgres(ql)?://|https?://[^/@[:space:]]+:[^/@[:space:]]+@' "$candidate"; then
  fail EVIDENCE_SECRET_DETECTED
fi
cat "$candidate"
