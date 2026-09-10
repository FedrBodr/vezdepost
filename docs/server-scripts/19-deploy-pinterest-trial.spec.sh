#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/19-deploy-pinterest-trial.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ -f "$SCRIPT" ]] || fail 'Pinterest deployment script does not exist'

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
if [[ "${FAIL_CONFIG:-0}" == 1 && "$*" == 'compose config -q' ]]; then
  exit 1
fi
if [[ "${FAIL_BUILD:-0}" == 1 && "$*" == 'compose build postiz' ]]; then
  exit 1
fi
if [[ "${FAIL_ENV_ONCE:-0}" == 1 && "$*" == 'exec postiz sh -lc '*PINTEREST_CLIENT_ID* && ! -e "$ENV_FAILURE_MARKER" ]]; then
  : > "$ENV_FAILURE_MARKER"
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

  chmod +x "$bin_dir/git" "$bin_dir/docker" "$bin_dir/curl" \
    "$bin_dir/flock" "$bin_dir/sleep"
}

prepare_case() {
  local case_dir=$1
  local repo="$case_dir/repo"
  local bin_dir="$case_dir/bin"

  mkdir -p "$repo"
  make_stubs "$bin_dir"
  printf '%s\n' 'JWT_SECRET=existing-fixture' > "$repo/.env"
  chmod 600 "$repo/.env"
  : > "$case_dir/git.calls"
  : > "$case_dir/docker.calls"
  : > "$case_dir/curl.calls"
}

run_script() {
  local case_dir=$1
  local expected_rev=$2
  local input=$3

  printf '%s' "$input" | PATH="$case_dir/bin:$PATH" \
    GIT_CALLS="$case_dir/git.calls" \
    DOCKER_CALLS="$case_dir/docker.calls" \
    CURL_CALLS="$case_dir/curl.calls" \
    CURRENT_REV='1111111111111111111111111111111111111111' \
    EXPECTED_REV="$expected_rev" \
    REPO_DIR="$case_dir/repo" \
    DEPLOYED_REV_FILE="$case_dir/deployed-rev" \
    AUTODEPLOY_LOCK="$case_dir/autodeploy.lock" \
    SKIP_DEPLOY_WAIT="${SKIP_DEPLOY_WAIT:-1}" \
    bash "$SCRIPT" "$expected_rev" > "$case_dir/output" 2>&1
}

run_success_case() {
  local case_dir="$TMP_DIR/success"
  local expected_rev='2222222222222222222222222222222222222222'
  prepare_case "$case_dir"

  run_script "$case_dir" "$expected_rev" $'client-id-fixture\nclient-secret-fixture\n' || {
    cat "$case_dir/output" >&2
    fail 'successful deployment case failed'
  }

  grep -q '^fetch --no-recurse-submodules origin prod$' "$case_dir/git.calls" ||
    fail 'origin/prod was not fetched'
  grep -q "^reset --hard $expected_rev$" "$case_dir/git.calls" ||
    fail 'server checkout was not pinned to the expected revision'
  grep -q '^compose config -q$' "$case_dir/docker.calls" ||
    fail 'Compose was not validated'
  grep -q '^compose build postiz$' "$case_dir/docker.calls" ||
    fail 'only the postiz image must be built'
  grep -q '^compose up -d --no-deps --force-recreate postiz$' \
    "$case_dir/docker.calls" || fail 'postiz was not minimally recreated'
  grep -q '^exec postiz sh -lc .*PINTEREST_CLIENT_ID' \
    "$case_dir/docker.calls" || fail 'Pinterest environment was not checked'
  ! grep -Eq '^compose (down|restart)|^restart ' "$case_dir/docker.calls" ||
    fail 'deployment attempted a broad restart'
  grep -q '^PINTEREST_CLIENT_ID=client-id-fixture$' "$case_dir/repo/.env" ||
    fail 'Pinterest App ID was not stored'
  grep -q '^PINTEREST_CLIENT_SECRET=client-secret-fixture$' "$case_dir/repo/.env" ||
    fail 'Pinterest App secret was not stored'
  local mode
  mode=$(stat -f '%Lp' "$case_dir/repo/.env" 2>/dev/null || stat -c '%a' "$case_dir/repo/.env")
  [[ "$mode" == 600 ]] || fail 'production .env mode is not 600'
  [[ "$(cat "$case_dir/deployed-rev")" == "$expected_rev" ]] ||
    fail 'deployed revision marker was not written'
  compgen -G "$case_dir/repo/.env.backup-*" >/dev/null ||
    fail 'production .env backup was not created'
}

run_invalid_sha_case() {
  local case_dir="$TMP_DIR/invalid-sha"
  prepare_case "$case_dir"

  if run_script "$case_dir" 'not-a-sha' $'client-id-fixture\nclient-secret-fixture\n'; then
    fail 'invalid SHA was accepted'
  fi

  [[ ! -s "$case_dir/git.calls" ]] || fail 'Git ran for invalid SHA'
  [[ ! -s "$case_dir/docker.calls" ]] || fail 'Docker ran for invalid SHA'
  ! compgen -G "$case_dir/repo/.env.backup-*" >/dev/null ||
    fail 'configuration was backed up for invalid SHA'
}

run_missing_credential_case() {
  local case_dir="$TMP_DIR/missing-credential"
  prepare_case "$case_dir"

  if run_script "$case_dir" '2222222222222222222222222222222222222222' $'\n'; then
    fail 'empty Pinterest App ID was accepted'
  fi

  grep -q '^JWT_SECRET=existing-fixture$' "$case_dir/repo/.env" ||
    fail 'configuration changed after missing credential'
  [[ ! -s "$case_dir/docker.calls" ]] ||
    fail 'Docker ran after missing credential'
}

assert_rollback() {
  local case_dir=$1
  grep -q '^JWT_SECRET=existing-fixture$' "$case_dir/repo/.env" ||
    fail 'original .env was not restored'
  ! grep -q '^PINTEREST_CLIENT_' "$case_dir/repo/.env" ||
    fail 'Pinterest credentials remained after rollback'
  grep -q '^reset --hard 1111111111111111111111111111111111111111$' \
    "$case_dir/git.calls" || fail 'previous revision was not restored'
  grep -q '^tag postiz-max:pinterest-trial-backup-.* postiz-max:local$' \
    "$case_dir/docker.calls" || fail 'previous image was not restored'
  grep -q '^compose up -d --no-deps --force-recreate postiz$' \
    "$case_dir/docker.calls" || fail 'rollback did not recreate only postiz'
  [[ ! -e "$case_dir/deployed-rev" ]] ||
    fail 'failed deployment wrote the deployed revision marker'
}

run_compose_validation_failure_case() {
  local case_dir="$TMP_DIR/config-failure"
  local expected_rev='2222222222222222222222222222222222222222'
  prepare_case "$case_dir"

  if FAIL_CONFIG=1 run_script "$case_dir" "$expected_rev" $'client-id-fixture\nclient-secret-fixture\n'; then
    fail 'Compose validation failure was ignored'
  fi
  assert_rollback "$case_dir"
  ! grep -q '^compose build postiz$' "$case_dir/docker.calls" ||
    fail 'build ran after Compose validation failure'
}

run_build_failure_rollback_case() {
  local case_dir="$TMP_DIR/build-failure"
  local expected_rev='2222222222222222222222222222222222222222'
  prepare_case "$case_dir"

  if FAIL_BUILD=1 run_script "$case_dir" "$expected_rev" $'client-id-fixture\nclient-secret-fixture\n'; then
    fail 'build failure was ignored'
  fi
  assert_rollback "$case_dir"
}

run_environment_retry_case() {
  local case_dir="$TMP_DIR/environment-retry"
  local expected_rev='2222222222222222222222222222222222222222'
  prepare_case "$case_dir"

  FAIL_ENV_ONCE=1 \
    ENV_FAILURE_MARKER="$case_dir/env-failed-once" \
    SKIP_DEPLOY_WAIT=0 \
    run_script "$case_dir" "$expected_rev" $'client-id-fixture\nclient-secret-fixture\n' || {
      cat "$case_dir/output" >&2
      fail 'transient Pinterest environment check was not retried'
    }

  [[ "$(grep -c '^exec postiz sh -lc .*PINTEREST_CLIENT_ID' "$case_dir/docker.calls")" == 2 ]] ||
    fail 'Pinterest environment check was not retried exactly once'
}

run_secret_redaction_case() {
  local case_dir="$TMP_DIR/redaction"
  local expected_rev='2222222222222222222222222222222222222222'
  local client_id='redaction-client-id-fixture'
  local client_secret='redaction-client-secret-fixture'
  prepare_case "$case_dir"

  run_script "$case_dir" "$expected_rev" "$client_id"$'\n'"$client_secret"$'\n' || {
    cat "$case_dir/output" >&2
    fail 'redaction deployment case failed'
  }

  for file in "$case_dir/output" "$case_dir/git.calls" \
    "$case_dir/docker.calls" "$case_dir/curl.calls"; do
    ! grep -Fq "$client_id" "$file" || fail 'Pinterest App ID leaked to output'
    ! grep -Fq "$client_secret" "$file" || fail 'Pinterest App secret leaked to output'
  done
}

run_success_case
run_invalid_sha_case
run_missing_credential_case
run_compose_validation_failure_case
run_build_failure_rollback_case
run_environment_retry_case
run_secret_redaction_case
echo 'Pinterest trial deployment script tests passed'
