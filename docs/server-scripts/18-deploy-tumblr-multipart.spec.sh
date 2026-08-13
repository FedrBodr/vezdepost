#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/18-deploy-tumblr-multipart.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

make_stubs() {
  local bin_dir=$1
  mkdir -p "$bin_dir"

  cat > "$bin_dir/git" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$GIT_CALLS"
case "$*" in
  'rev-parse HEAD') printf '%s\n' "$CURRENT_REV" ;;
  'rev-parse refs/remotes/origin/prod') printf '%s\n' "$EXPECTED_REV" ;;
esac
STUB

  cat > "$bin_dir/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_CALLS"
if [[ "${FAIL_BUILD:-0}" == 1 && "$*" == 'compose build postiz' ]]; then
  exit 1
fi
case "$*" in
  'exec temporal-admin-tools temporal task-queue describe '*)
    printf '%s\n' 'Pollers: Identity worker@postiz'
    ;;
  *"pg_attribute"*"mastra_ai_spans"*)
    printf '%s\n' '43|5|48'
    ;;
esac
STUB

  cat > "$bin_dir/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CURL_CALLS"
printf '%s' '401'
STUB

  cat > "$bin_dir/flock" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB

  cat > "$bin_dir/sleep" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB

  cat > "$bin_dir/systemctl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$SYSTEMCTL_CALLS"
STUB

  chmod +x "$bin_dir/git" "$bin_dir/docker" "$bin_dir/curl" \
    "$bin_dir/flock" "$bin_dir/sleep" "$bin_dir/systemctl"
}

run_success_case() {
  local case_dir="$TMP_DIR/success"
  local repo="$case_dir/repo"
  local bin_dir="$case_dir/bin"
  local git_calls="$case_dir/git.calls"
  local docker_calls="$case_dir/docker.calls"
  local curl_calls="$case_dir/curl.calls"
  local deployed_rev_file="$case_dir/deployed-rev"
  local systemctl_calls="$case_dir/systemctl.calls"
  local expected_rev='2222222222222222222222222222222222222222'

  mkdir -p "$repo"
  make_stubs "$bin_dir"
  : > "$git_calls"
  : > "$docker_calls"
  : > "$curl_calls"
  : > "$systemctl_calls"

  PATH="$bin_dir:$PATH" \
    GIT_CALLS="$git_calls" \
    DOCKER_CALLS="$docker_calls" \
    CURL_CALLS="$curl_calls" \
    SYSTEMCTL_CALLS="$systemctl_calls" \
    CURRENT_REV='1111111111111111111111111111111111111111' \
    EXPECTED_REV="$expected_rev" \
    REPO_DIR="$repo" \
    DEPLOYED_REV_FILE="$deployed_rev_file" \
    AUTODEPLOY_LOCK="$case_dir/autodeploy.lock" \
    SKIP_DEPLOY_WAIT=1 \
    bash "$SCRIPT" "$expected_rev" > "$case_dir/output" 2>&1 || {
      cat "$case_dir/output" >&2
      fail 'successful deployment case failed'
    }

  grep -q '^fetch --no-recurse-submodules origin prod$' "$git_calls" ||
    fail 'origin/prod was not fetched safely'
  grep -q "^reset --hard $expected_rev$" "$git_calls" ||
    fail 'server checkout was not pinned to the expected revision'
  grep -q '^tag postiz-max:local postiz-max:tumblr-multipart-backup-' \
    "$docker_calls" || fail 'postiz image backup tag was not created'
  grep -q '^compose build postiz$' "$docker_calls" ||
    fail 'only the postiz image must be built'
  grep -q '^compose up -d --no-deps --force-recreate postiz$' \
    "$docker_calls" || fail 'postiz was not minimally recreated'
  ! grep -Eq '^compose (down|restart)|^restart ' "$docker_calls" ||
    fail 'deployment attempted a broad restart'
  grep -q '^exec postiz sh -lc ' "$docker_calls" ||
    fail 'Tumblr environment presence was not checked'
  grep -q '^exec temporal-admin-tools temporal task-queue describe ' \
    "$docker_calls" || fail 'Temporal workflow poller was not checked'
  [[ "$(cat "$deployed_rev_file")" == "$expected_rev" ]] ||
    fail 'deployed revision marker was not written'
  [[ ! -s "$systemctl_calls" ]] ||
    fail 'normal deployment restarted Docker without explicit opt-in'
}

run_invalid_sha_case() {
  local case_dir="$TMP_DIR/invalid"
  local repo="$case_dir/repo"
  local bin_dir="$case_dir/bin"
  local git_calls="$case_dir/git.calls"
  local docker_calls="$case_dir/docker.calls"
  local curl_calls="$case_dir/curl.calls"
  local systemctl_calls="$case_dir/systemctl.calls"

  mkdir -p "$repo"
  make_stubs "$bin_dir"
  : > "$git_calls"
  : > "$docker_calls"
  : > "$curl_calls"
  : > "$systemctl_calls"

  if PATH="$bin_dir:$PATH" \
    GIT_CALLS="$git_calls" \
    DOCKER_CALLS="$docker_calls" \
    CURL_CALLS="$curl_calls" \
    SYSTEMCTL_CALLS="$systemctl_calls" \
    CURRENT_REV='1111111111111111111111111111111111111111' \
    EXPECTED_REV='2222222222222222222222222222222222222222' \
    REPO_DIR="$repo" \
    DEPLOYED_REV_FILE="$case_dir/deployed-rev" \
    AUTODEPLOY_LOCK="$case_dir/autodeploy.lock" \
    SKIP_DEPLOY_WAIT=1 \
    bash "$SCRIPT" 'not-a-sha' > "$case_dir/output" 2>&1; then
    fail 'invalid SHA was accepted'
  fi

  ! grep -q '^reset ' "$git_calls" || fail 'git reset ran for invalid SHA'
  [[ ! -s "$docker_calls" ]] || fail 'Docker ran for invalid SHA'
  [[ ! -s "$curl_calls" ]] || fail 'curl ran for invalid SHA'
  [[ ! -s "$systemctl_calls" ]] || fail 'systemctl ran for invalid SHA'
}

run_rollback_case() {
  local case_dir="$TMP_DIR/rollback"
  local repo="$case_dir/repo"
  local bin_dir="$case_dir/bin"
  local git_calls="$case_dir/git.calls"
  local docker_calls="$case_dir/docker.calls"
  local curl_calls="$case_dir/curl.calls"
  local systemctl_calls="$case_dir/systemctl.calls"
  local current_rev='1111111111111111111111111111111111111111'
  local expected_rev='2222222222222222222222222222222222222222'

  mkdir -p "$repo"
  make_stubs "$bin_dir"
  : > "$git_calls"
  : > "$docker_calls"
  : > "$curl_calls"
  : > "$systemctl_calls"

  if PATH="$bin_dir:$PATH" \
    GIT_CALLS="$git_calls" \
    DOCKER_CALLS="$docker_calls" \
    CURL_CALLS="$curl_calls" \
    SYSTEMCTL_CALLS="$systemctl_calls" \
    CURRENT_REV="$current_rev" \
    EXPECTED_REV="$expected_rev" \
    FAIL_BUILD=1 \
    REPO_DIR="$repo" \
    DEPLOYED_REV_FILE="$case_dir/deployed-rev" \
    AUTODEPLOY_LOCK="$case_dir/autodeploy.lock" \
    SKIP_DEPLOY_WAIT=1 \
    bash "$SCRIPT" "$expected_rev" > "$case_dir/output" 2>&1; then
    fail 'build failure was ignored'
  fi

  grep -q "^reset --hard $current_rev$" "$git_calls" ||
    fail 'previous revision was not restored after build failure'
  grep -q '^tag postiz-max:tumblr-multipart-backup-.* postiz-max:local$' \
    "$docker_calls" || fail 'backup image was not restored after build failure'
  [[ "$(grep -c '^compose up -d --no-deps --force-recreate postiz$' "$docker_calls")" == 1 ]] ||
    fail 'rollback did not recreate only postiz exactly once'
  [[ ! -e "$case_dir/deployed-rev" ]] ||
    fail 'failed deployment wrote the deployed revision marker'
}

run_buildkit_recovery_case() {
  local case_dir="$TMP_DIR/recovery"
  local repo="$case_dir/repo"
  local bin_dir="$case_dir/bin"
  local git_calls="$case_dir/git.calls"
  local docker_calls="$case_dir/docker.calls"
  local curl_calls="$case_dir/curl.calls"
  local systemctl_calls="$case_dir/systemctl.calls"
  local expected_rev='2222222222222222222222222222222222222222'

  mkdir -p "$repo"
  make_stubs "$bin_dir"
  : > "$git_calls"
  : > "$docker_calls"
  : > "$curl_calls"
  : > "$systemctl_calls"

  PATH="$bin_dir:$PATH" \
    GIT_CALLS="$git_calls" \
    DOCKER_CALLS="$docker_calls" \
    CURL_CALLS="$curl_calls" \
    SYSTEMCTL_CALLS="$systemctl_calls" \
    CURRENT_REV='1111111111111111111111111111111111111111' \
    EXPECTED_REV="$expected_rev" \
    REPO_DIR="$repo" \
    DEPLOYED_REV_FILE="$case_dir/deployed-rev" \
    AUTODEPLOY_LOCK="$case_dir/autodeploy.lock" \
    RESTART_DOCKER_BEFORE_BUILD=1 \
    SKIP_DEPLOY_WAIT=1 \
    bash "$SCRIPT" "$expected_rev" > "$case_dir/output" 2>&1 || {
      cat "$case_dir/output" >&2
      fail 'BuildKit recovery deployment case failed'
    }

  grep -q '^restart docker$' "$systemctl_calls" ||
    fail 'explicit BuildKit recovery did not restart Docker'
  grep -q '^is-active --quiet docker$' "$systemctl_calls" ||
    fail 'Docker service was not checked after restart'
  grep -q '^info$' "$docker_calls" ||
    fail 'Docker daemon readiness was not checked before the build'
  grep -q '^compose build postiz$' "$docker_calls" ||
    fail 'postiz was not built after BuildKit recovery'
}

run_success_case
run_invalid_sha_case
run_rollback_case
run_buildkit_recovery_case
echo 'Tumblr multipart deployment script tests passed'
