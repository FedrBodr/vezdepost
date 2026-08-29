#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/27-accept-ksy-release.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

make_case() {
  local case_dir=$1
  mkdir -p "$case_dir/opt/ksy-deals" "$case_dir/bin"
  cat > "$case_dir/opt/ksy-deals/deployment-evidence.json" <<'JSON'
{"hostname":"ksy-deals.fedrbodr.com","image":"ghcr.io/fedrbodr/ksy-deals@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","rollbackImage":null,"deployedAt":"2026-08-29T12:00:00Z","loopbackLive":true,"loopbackReady":true}
JSON
  chmod 600 "$case_dir/opt/ksy-deals/deployment-evidence.json"
  printf 'FEED_TOKEN=host-must-not-read-feed-secret\nDATABASE_URL=postgresql://secret:secret@db/ksy_deals\n' > "$case_dir/opt/ksy-deals/.env"
  chmod 000 "$case_dir/opt/ksy-deals/.env"
  printf 'phase=COMPLETE\n' > "$case_dir/opt/ksy-deals/live-acceptance.state"
  chmod 000 "$case_dir/opt/ksy-deals/live-acceptance.state"

  cat > "$case_dir/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CURL_CALLS"
url=${!#}
case "$url" in
  http://127.0.0.1:4300/)
    [[ "${KSY_TEST_ROOT_BAD:-0}" == 1 ]] && printf 503 || printf 200
    ;;
  http://127.0.0.1:4300/health/live)
    [[ "${KSY_TEST_LIVE_BAD:-0}" == 1 ]] && printf 503 || printf 200
    ;;
  http://127.0.0.1:4300/health/ready)
    [[ "${KSY_TEST_READY_BAD:-0}" == 1 ]] && printf 503 || printf 200
    ;;
  http://127.0.0.1:4300/api/admin/auth/session)
    [[ "${KSY_TEST_ADMIN_BAD:-0}" == 1 ]] && printf 200 || printf 401
    ;;
  http://127.0.0.1:4300/public/store/v1/feed.json)
    [[ "$*" == *'Authorization: Bearer ksy-release-invalid-token'* ]] || exit 81
    [[ "${KSY_TEST_INVALID_FEED_BAD:-0}" == 1 ]] && printf 200 || printf 401
    ;;
  *) exit 82 ;;
esac
STUB

  cat > "$case_dir/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_CALLS"
case "$*" in
  *'ps --filter label=com.docker.compose.project=ksy-deals --filter label=com.docker.compose.service=server --format {{.ID}}'*)
    printf 'server-container\n'
    ;;
  *'ps --filter label=com.docker.compose.project=ksy-deals --filter label=com.docker.compose.service=db --format {{.ID}}'*)
    printf 'db-container\n'
    ;;
  *'inspect --format {{.Config.Image}} server-container'*)
    if [[ "${KSY_TEST_IMAGE_REFERENCE_BAD:-0}" == 1 ]]; then
      printf 'ghcr.io/fedrbodr/ksy-deals@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n'
    else
      printf 'ghcr.io/fedrbodr/ksy-deals@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n'
    fi
    ;;
  *'inspect --format {{.Image}} server-container'*)
    [[ "${KSY_TEST_IMAGE_ID_BAD:-0}" == 1 ]] && printf 'sha256:cccccccc\n' || printf 'sha256:dddddddd\n'
    ;;
  *'image inspect --format {{.Id}} ghcr.io/fedrbodr/ksy-deals@sha256:'*)
    printf 'sha256:dddddddd\n'
    ;;
  *'exec server-container node --input-type=module -e '*'KSY_RELEASE_FEED_PROBE_V1'*)
    [[ "$*" != *'configured-feed-secret-sentinel'* ]] || exit 83
    if [[ "${KSY_TEST_CONFIGURED_FEED_BAD:-0}" == 1 ]]; then
      printf '{"status":401,"version":null}\n'
    elif [[ "${KSY_TEST_FEED_VERSION_BAD:-0}" == 1 ]]; then
      printf '{"status":200,"version":2}\n'
    else
      printf '{"status":200,"version":1}\n'
    fi
    ;;
  *'exec server-container node --input-type=module -e '*'KSY_RELEASE_DATABASE_PROBE_V1'*)
    if [[ "${KSY_TEST_DATABASE_BAD:-0}" == 1 ]]; then
      printf '{"migrationSet":"MISMATCH","postFormat":"THREE_LINES"}\n'
    elif [[ "${KSY_TEST_FORMAT_BAD:-0}" == 1 ]]; then
      printf '{"migrationSet":"MATCH","postFormat":"https://user:password@invalid"}\n'
    else
      printf '{"migrationSet":"MATCH","postFormat":"THREE_LINES"}\n'
    fi
    ;;
  *'inspect --format {{.RestartCount}}|{{.State.OOMKilled}}|{{.State.Health.Status}}|{{.HostConfig.Memory}} server-container'*)
    [[ "${KSY_TEST_RESOURCE_BAD:-0}" == 1 ]] && printf '1|false|healthy|1073741824\n' || printf '0|false|healthy|1073741824\n'
    ;;
  *'inspect --format {{.RestartCount}}|{{.State.OOMKilled}}|{{.State.Health.Status}}|{{.HostConfig.Memory}} db-container'*)
    printf '0|false|healthy|536870912\n'
    ;;
  *'stats --no-stream --format {{.MemUsage}} server-container'*)
    printf '256MiB / 1GiB\n'
    ;;
  *'stats --no-stream --format {{.MemUsage}} db-container'*)
    printf '128MiB / 512MiB\n'
    ;;
  *) exit 84 ;;
esac
STUB
  chmod +x "$case_dir/bin/curl" "$case_dir/bin/docker"
  : > "$case_dir/curl.calls"
  : > "$case_dir/docker.calls"
}

run_case() {
  local case_dir=$1 output=$2
  PATH="$case_dir/bin:/opt/homebrew/bin:/usr/bin:/bin" \
    KSY_RELEASE_TEST_MODE=1 KSY_RELEASE_TEST_DISK_USED_PERCENT="${KSY_RELEASE_TEST_DISK_USED_PERCENT:-42}" \
    KSY_ROOT="$case_dir/opt/ksy-deals" KSY_RELEASE_WORK_PARENT="$case_dir" \
    CURL_CALLS="$case_dir/curl.calls" DOCKER_CALLS="$case_dir/docker.calls" \
    CONFIGURED_FEED_TOKEN_SENTINEL=configured-feed-secret-sentinel \
    bash "$SCRIPT" > "$output" 2>&1
}

expect_failure() {
  local name=$1 knob=$2 reason=$3
  local case_dir="$TMP_DIR/$name" output="$TMP_DIR/$name.out"
  make_case "$case_dir"
  printf -v "$knob" '%s' 1
  export "$knob"
  if run_case "$case_dir" "$output"; then
    unset "$knob"
    fail "$name unexpectedly passed"
  fi
  unset "$knob"
  grep -q "^KSY_RELEASE_ACCEPT_FAILED $reason$" "$output" || {
    cat "$output" >&2
    fail "$name returned the wrong failure"
  }
  ! grep -Eiq 'configured-feed-secret-sentinel|host-must-not-read|DATABASE_URL|postgresql://|Authorization|Bearer' "$output" ||
    fail "$name leaked sensitive evidence"
}

test_accepts_allowlisted_release_evidence() {
  local case_dir="$TMP_DIR/success" output="$TMP_DIR/success.out"
  make_case "$case_dir"
  run_case "$case_dir" "$output" || { cat "$output" >&2; cat "$case_dir/docker.calls" >&2; fail 'success case failed'; }
  grep -q '^KSY_RELEASE_ACCEPTED image=ghcr.io/fedrbodr/ksy-deals@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa root=200 live=200 ready=200 admin=401 feedInvalid=401 feedConfigured=200 feedVersion=1 migrations=MATCH postFormat=THREE_LINES$' "$output" ||
    fail 'safe release evidence missing'
  grep -q '^KSY_RELEASE_RESOURCE_EVIDENCE server_restart=0 server_oom=false server_health=healthy server_limit=1g server_memory_bytes=268435456 db_restart=0 db_oom=false db_health=healthy db_limit=512m db_memory_bytes=134217728 disk_used_percent=42$' "$output" ||
    fail 'safe resource evidence missing'
  for forbidden in configured-feed-secret-sentinel host-must-not-read-feed-secret DATABASE_URL postgresql:// Authorization Bearer; do
    ! grep -Fq "$forbidden" "$output" || fail "output leaked $forbidden"
  done
  for forbidden in configured-feed-secret-sentinel host-must-not-read-feed-secret postgresql://; do
    ! grep -Fq "$forbidden" "$case_dir/docker.calls" || fail "Docker argv leaked $forbidden"
  done
  [[ ! -e "$case_dir/ksy-release-accept."* ]] || fail 'private work directory survived success'
}

test_rejects_unsafe_evidence_before_docker() {
  local case_dir="$TMP_DIR/evidence-mode" output="$TMP_DIR/evidence-mode.out"
  make_case "$case_dir"
  chmod 644 "$case_dir/opt/ksy-deals/deployment-evidence.json"
  if run_case "$case_dir" "$output"; then fail 'public evidence was accepted'; fi
  grep -q '^KSY_RELEASE_ACCEPT_FAILED DEPLOYMENT_EVIDENCE_MODE_INVALID$' "$output" ||
    fail 'public evidence returned the wrong failure'
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'public evidence reached Docker'
}

test_rejects_disk_limit() {
  local case_dir="$TMP_DIR/disk" output="$TMP_DIR/disk.out"
  make_case "$case_dir"
  if KSY_RELEASE_TEST_DISK_USED_PERCENT=85 run_case "$case_dir" "$output"; then
    fail 'disk usage 85 was accepted'
  fi
  grep -q '^KSY_RELEASE_ACCEPT_FAILED DISK_USAGE_LIMIT$' "$output" ||
    fail 'disk limit returned the wrong failure'
}

test_static_non_mutating_boundary() {
  for forbidden in live-acceptance.state setWebhook getWebhookInfo provision-approved-watchlist platprices.com; do
    ! grep -Fq "$forbidden" "$SCRIPT" || fail "release smoke contains $forbidden"
  done
  ! grep -Eiq '\b(INSERT|UPDATE|DELETE|TRUNCATE)\b' "$SCRIPT" ||
    fail 'release smoke contains a SQL mutation'
  ! grep -Eq '(^|[[:space:]])\.[[:space:]]+.*\.env|source[[:space:]]+.*\.env' "$SCRIPT" ||
    fail 'release smoke sources the host env file'
}

test_accepts_allowlisted_release_evidence
test_rejects_unsafe_evidence_before_docker
expect_failure image-reference KSY_TEST_IMAGE_REFERENCE_BAD IMAGE_REFERENCE_MISMATCH
expect_failure image-id KSY_TEST_IMAGE_ID_BAD IMAGE_ID_MISMATCH
expect_failure root KSY_TEST_ROOT_BAD ROOT_FAILED
expect_failure live KSY_TEST_LIVE_BAD LIVE_FAILED
expect_failure ready KSY_TEST_READY_BAD READY_FAILED
expect_failure admin KSY_TEST_ADMIN_BAD ADMIN_AUTH_BOUNDARY_FAILED
expect_failure invalid-feed KSY_TEST_INVALID_FEED_BAD FEED_INVALID_TOKEN_BOUNDARY_FAILED
expect_failure configured-feed KSY_TEST_CONFIGURED_FEED_BAD FEED_CONFIGURED_TOKEN_FAILED
expect_failure feed-version KSY_TEST_FEED_VERSION_BAD FEED_VERSION_INVALID
expect_failure database KSY_TEST_DATABASE_BAD DATABASE_EVIDENCE_INVALID
expect_failure format KSY_TEST_FORMAT_BAD DATABASE_EVIDENCE_INVALID
expect_failure resource KSY_TEST_RESOURCE_BAD CONTAINER_STATE_UNHEALTHY
test_rejects_disk_limit
test_static_non_mutating_boundary
bash -n "$SCRIPT"
printf 'KSY release acceptance tests passed\n'
