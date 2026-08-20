# KSY Provision Progress Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make script 20 show append-only provisioning phases and bounded health-poll progress without exposing secrets or changing rollback behavior.

**Architecture:** Keep progress rendering inside `20-provision-ksy-staging.sh` as one small `progress` helper and explicit calls at the existing phase boundaries. Configure Docker Compose's supported plain renderer, and turn each health attempt into a safe structured line while suppressing curl transport noise. Extend the existing shell spec so the output contract is covered by the same idempotency, rollback, PTY, and secret-leak fixtures.

**Tech Stack:** Bash, Docker Compose 5.3.0, curl, expect, shell stubs.

## Global Constraints

- Keep the public prefix `KSY_PROGRESS` and exactly nine ordered phase names: `preflight`, `secrets`, `install`, `pull`, `database`, `migrations`, `server`, `health`, `evidence`.
- Keep `KSY_PROVISION_FAILED <reason>` and `KSY_PROVISIONED ...` compatible.
- Keep 30 health attempts per endpoint and the existing two-second production delay.
- Never print secret values, secret lengths, assignment text, environment dumps, or secret-derived temporary paths.
- Preserve terminal echo restoration, rollback, idempotency, and all existing validation behavior.
- Use Docker Compose `--progress plain`; do not suppress useful Compose failure output.

---

### Task 1: Add stable progress and health records

**Files:**
- Modify: `docs/server-scripts/20-provision-ksy-staging.spec.sh`
- Modify: `docs/server-scripts/20-provision-ksy-staging.sh`
- Modify: `docs/superpowers/plans/2026-08-20-ksy-provision-progress-output.md`

**Interfaces:**
- Consumes: the existing `deploy_stack`, `wait_for_health`, test-mode stubs, and public Compose output.
- Produces: `progress(step, phase, message)`, nine ordered phase records, and health records containing `endpoint`, `attempt`, and `result`.

- [ ] **Step 1: Write the failing progress contract**

Add this helper to the spec:

```bash
assert_progress_contract() {
  local output=$1
  local phases
  phases=$(sed -n 's/^KSY_PROGRESS step=[0-9]\/9 phase=\([^ ]*\).*/\1/p' "$output" |
    awk '!seen[$0]++')
  assert_eq $'preflight\nsecrets\ninstall\npull\ndatabase\nmigrations\nserver\nhealth\nevidence' \
    "$phases" 'progress phases must be complete and ordered'
  grep -q '^KSY_PROGRESS step=8/9 phase=health .*endpoint=live attempt=1/30 result=PASS$' "$output" ||
    fail 'successful live health progress is missing'
  grep -q '^KSY_PROGRESS step=8/9 phase=health .*endpoint=ready attempt=1/30 result=PASS$' "$output" ||
    fail 'successful ready health progress is missing'
}
```

Call it for both successful idempotency outputs. Also require:

```bash
grep -q 'compose --project-name ksy-deals --progress plain ' "$case_dir/docker.calls" ||
  fail 'Compose plain progress was not configured'
```

In the failed-readiness case require the final bounded attempt and existing failure marker:

```bash
grep -q '^KSY_PROGRESS step=8/9 phase=health .*endpoint=live attempt=30/30 result=WAIT$' "$output" ||
  fail 'failed health progress did not reach its visible bound'
grep -q '^KSY_PROVISION_FAILED READINESS_FAILED$' "$output" ||
  fail 'failed readiness lost its compatible failure record'
```

Keep calling `assert_synthetic_secrets_absent` for success and failure output.

- [ ] **Step 2: Run the focused spec and verify RED**

Run:

```bash
bash docs/server-scripts/20-provision-ksy-staging.spec.sh
```

Expected: FAIL because no `KSY_PROGRESS` phases or Compose plain-progress option exist yet.

- [ ] **Step 3: Add the minimal progress renderer**

Add near `fail()`:

```bash
PROGRESS_TOTAL=9

progress() {
  local step=$1
  local phase=$2
  local message=$3
  printf 'KSY_PROGRESS step=%s/%s phase=%s message="%s"\n' \
    "$step" "$PROGRESS_TOTAL" "$phase" "$message"
}
```

Emit phase records at the existing boundaries:

```bash
progress 1 preflight 'Checking host prerequisites'
progress 2 secrets 'Reading hidden secret assignments'
progress 3 install 'Installing reviewed configuration'
progress 4 pull 'Pulling immutable images'
progress 5 database 'Starting PostgreSQL'
progress 6 migrations 'Applying database migrations'
progress 7 server 'Starting KSY server'
progress 9 evidence 'Writing deployment evidence'
```

Place `preflight` before the filesystem/disk checks, `secrets` immediately before
`read_batch`, `install` after all batch validation and before directory/file
installation, and the deployment/evidence phases immediately before their
existing commands. Do not print any parsed values.

Configure the existing Compose array as:

```bash
compose=(docker compose --project-name ksy-deals --progress plain --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
```

- [ ] **Step 4: Make health polling visible and quiet**

Replace `wait_for_health` with:

```bash
wait_for_health() {
  local endpoint=$1
  local url=$2
  local attempt
  for attempt in $(seq 1 30); do
    if curl --fail --silent "$url" >/dev/null 2>&1; then
      printf 'KSY_PROGRESS step=8/%s phase=health message="Checking %s endpoint" endpoint=%s attempt=%s/30 result=PASS\n' \
        "$PROGRESS_TOTAL" "$endpoint" "$endpoint" "$attempt"
      return 0
    fi
    printf 'KSY_PROGRESS step=8/%s phase=health message="Waiting for %s endpoint" endpoint=%s attempt=%s/30 result=WAIT\n' \
      "$PROGRESS_TOTAL" "$endpoint" "$endpoint" "$attempt"
    [[ "$TEST_MODE" == 1 ]] || sleep 2
  done
  return 1
}
```

Call it with stable endpoint names:

```bash
wait_for_health live http://127.0.0.1:4300/health/live || return
wait_for_health ready http://127.0.0.1:4300/health/ready
```

- [ ] **Step 5: Verify GREEN and syntax**

Run:

```bash
bash docs/server-scripts/20-provision-ksy-staging.spec.sh
bash -n docs/server-scripts/20-provision-ksy-staging.sh
bash -n docs/server-scripts/20-provision-ksy-staging.spec.sh
git diff --check
```

Expected: `KSY staging provisioner tests passed`; both syntax checks and diff check are silent.

- [ ] **Step 6: Commit the reviewed change**

```bash
git add docs/server-scripts/20-provision-ksy-staging.sh \
  docs/server-scripts/20-provision-ksy-staging.spec.sh \
  docs/superpowers/plans/2026-08-20-ksy-provision-progress-output.md
git commit -m "feat: report KSY provision progress"
```
