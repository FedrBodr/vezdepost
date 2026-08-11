#!/usr/bin/env bash
# Retire only running legacy organization-level streakWorkflow executions.
#
# The default is a read-only dry run. Set APPLY=1 only after reviewing the
# exact workflow/run pairs printed by a dry run. Reruns are safe because the
# Temporal query returns running executions only.
set -euo pipefail

TEMPORAL_CONTAINER=${TEMPORAL_CONTAINER:-temporal-admin-tools}
TEMPORAL_ADDRESS=${TEMPORAL_ADDRESS:-temporal:7233}
APPLY=${APPLY:-0}
QUERY="WorkflowType='streakWorkflow' AND ExecutionStatus='Running'"
RUNS_FILE=$(mktemp)
trap 'rm -f "$RUNS_FILE"' EXIT

if ! command -v jq >/dev/null 2>&1; then
  echo 'jq is required to parse exact Temporal workflow/run IDs.' >&2
  exit 1
fi

echo "Listing running legacy WorkflowType=streakWorkflow executions..."
list_json=$(docker exec "$TEMPORAL_CONTAINER" temporal workflow list \
  --address "$TEMPORAL_ADDRESS" \
  --query "$QUERY" \
  -o json)

printf '%s' "$list_json" | jq -r \
  '(.executions? // .)[]?
  | .execution.workflowId as $workflow_id
  | .execution.runId as $run_id
  | if (($workflow_id | type) == "string"
      and ($workflow_id | length) > 0
      and ($workflow_id | test("^[^\\t\\r\\n]+$"))
      and ($run_id | type) == "string"
      and ($run_id | length) > 0
      and ($run_id | test("^[^\\t\\r\\n]+$")))
    then [$workflow_id, $run_id] | @tsv
    else error("Temporal returned an execution without safe workflow/run IDs")
    end' \
  > "$RUNS_FILE"

count=$(wc -l < "$RUNS_FILE" | tr -d ' ')
echo "Found $count running legacy streak workflow(s)."

if [[ "$count" -eq 0 ]]; then
  exit 0
fi

while IFS=$'\t' read -r workflow_id run_id; do
  printf '  workflow_id=%s run_id=%s\n' "$workflow_id" "$run_id"
done < "$RUNS_FILE"

if [[ "$APPLY" != '1' ]]; then
  echo 'Dry run only; no workflows terminated. Re-run with APPLY=1 after review.'
  exit 0
fi

terminated=0
failed=0
while IFS=$'\t' read -r workflow_id run_id; do
  if docker exec "$TEMPORAL_CONTAINER" temporal workflow terminate \
    --address "$TEMPORAL_ADDRESS" \
    --workflow-id "$workflow_id" \
    --run-id "$run_id" \
    --reason 'Retire legacy organization streak workflow after personal reminder rollout'; then
    terminated=$((terminated + 1))
    printf 'Terminated workflow_id=%s run_id=%s\n' "$workflow_id" "$run_id"
  else
    failed=$((failed + 1))
    printf 'FAILED workflow_id=%s run_id=%s\n' "$workflow_id" "$run_id" >&2
  fi
done < "$RUNS_FILE"

echo "Termination results: succeeded=$terminated failed=$failed"
[[ "$failed" -eq 0 ]]
