#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/15-retire-legacy-streak-workflows.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

make_docker_stub() {
  local bin_dir=$1
  mkdir -p "$bin_dir"
  cat > "$bin_dir/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_CALLS"
if [[ "$*" == *"workflow list"* ]]; then
  printf '%s\n' '{"executions":[{"execution":{"workflowId":"streak_org-1","runId":"run-1"}},{"execution":{"workflowId":"streak_org-2","runId":"run-2"}}]}'
fi
STUB
  chmod +x "$bin_dir/docker"
}

run_case() {
  local apply=$1
  local case_dir="$TMP_DIR/apply-$apply"
  local bin_dir="$case_dir/bin"
  local calls="$case_dir/docker.calls"
  local output="$case_dir/output"
  mkdir -p "$case_dir"
  make_docker_stub "$bin_dir"
  : > "$calls"

  if [[ "$apply" == 'unset' ]]; then
    env -u APPLY PATH="$bin_dir:$PATH" DOCKER_CALLS="$calls" bash "$SCRIPT" \
      > "$output"
  else
    PATH="$bin_dir:$PATH" DOCKER_CALLS="$calls" APPLY="$apply" bash "$SCRIPT" \
      > "$output"
  fi
  printf '%s' "$calls"
}

dry_calls=$(run_case unset)
grep -q -- "workflow list .*--query WorkflowType='streakWorkflow' AND ExecutionStatus='Running'.*-o json" "$dry_calls" ||
  fail 'must query only running streakWorkflow executions as JSON'
! grep -q 'workflow terminate' "$dry_calls" ||
  fail 'dry-run must not terminate workflows'

non_explicit_calls=$(run_case yes)
! grep -q 'workflow terminate' "$non_explicit_calls" ||
  fail 'only the exact APPLY=1 gate may terminate workflows'

apply_calls=$(run_case 1)
grep -q -- 'workflow terminate .*--workflow-id streak_org-1 .*--run-id run-1 ' "$apply_calls" ||
  fail 'apply must terminate the first exact workflow/run pair'
grep -q -- 'workflow terminate .*--workflow-id streak_org-2 .*--run-id run-2 ' "$apply_calls" ||
  fail 'apply must terminate the second exact workflow/run pair'

echo 'Legacy streak workflow retirement script tests passed'
