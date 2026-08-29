# KSY Routine Order URL Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let reviewed script 20 atomically replace only the immutable image and the fixed approved KSY order-bot URL during a routine deployment without reading or rotating secrets.

**Architecture:** Extend script 20's fail-closed argument parser with a routine-only `--order-telegram-url` option restricted to `https://t.me/ksy_deals_store_bot`. Reuse the existing validated env snapshot and transaction, changing the candidate env with one `awk` pass and relying on the existing rollback trap for every later failure.

**Tech Stack:** Bash 3.2-compatible shell, shell specs with filesystem/Docker stubs, Git, reviewed SSH deployment scripts.

## Global Constraints

- Do not print or place secrets, database URLs, Telegram IDs, or event identifiers in argv, logs, evidence, tests, or chat.
- The override is accepted only with `--reuse-existing-secrets`, exactly once, and only for `https://t.me/ksy_deals_store_bot`.
- Bootstrap behavior and its twelve-field hidden batch remain unchanged.
- All invalid argument combinations fail before Docker or filesystem mutation.
- Every existing env byte except `KSY_DEALS_IMAGE` and, when requested, `ORDER_TELEGRAM_URL` remains unchanged.
- VPS mutation is allowed only through the SHA-verified reviewed numbered script.

---

### Task 1: Specify the routine override at the shell boundary

**Files:**
- Modify: `docs/server-scripts/20-provision-ksy-staging.spec.sh`

**Interfaces:**
- Consumes: existing `write_existing_installation`, Docker/curl stubs, `REUSE_IMAGE`.
- Produces: a reusable routine invocation helper that can include an optional public order URL and assertions for fail-closed parsing.

- [ ] **Step 1: Extend the test helper without changing production code**

Add an optional eighth `order_url_override` parameter to `run_reuse_case`. Build a Bash array so the existing invocation stays byte-for-byte equivalent when it is empty and the new invocation is:

```bash
arguments=(--reuse-existing-secrets)
if [[ -n "$order_url_override" ]]; then
  arguments+=(--order-telegram-url "$order_url_override")
fi
arguments+=(--image "$image")
bash "$SCRIPT" "${arguments[@]}"
```

- [ ] **Step 2: Write the positive failing test**

Add `test_routine_override_changes_only_image_and_order_url`. Start from `write_existing_installation`, remove `KSY_DEALS_IMAGE` and `ORDER_TELEGRAM_URL` from before/after comparison files, invoke with the approved URL, and require:

```bash
grep -Fxq "KSY_DEALS_IMAGE=$REUSE_IMAGE" "$root/.env"
grep -Fxq 'ORDER_TELEGRAM_URL=https://t.me/ksy_deals_store_bot' "$root/.env"
cmp -s "$case_dir/env-without-image-or-order.before" \
  "$case_dir/env-without-image-or-order.after"
```

Also require no hidden prompt, no Docker login, and no synthetic secret in output.

- [ ] **Step 3: Write failing argument-rejection tests**

Add direct test-mode invocations that require pre-mutation rejection for:

```text
--image <digest> --order-telegram-url <approved>             # bootstrap use
--reuse-existing-secrets --order-telegram-url                # missing value
--reuse-existing-secrets --order-telegram-url <approved>
  --order-telegram-url <approved> --image <digest>            # duplicate
--reuse-existing-secrets --order-telegram-url http://...
  --image <digest>                                            # malformed
--reuse-existing-secrets --order-telegram-url https://t.me/yar_neo
  --image <digest>                                            # alternate destination
```

Each case must leave the previous env/Compose SHA unchanged and make no Docker call.

- [ ] **Step 4: Extend the existing rollback test**

Invoke the routine readiness-failure case with the approved override and require exact `cmp` restoration of the previous env, including its previous `ORDER_TELEGRAM_URL`.

- [ ] **Step 5: Run RED**

Run:

```bash
rtk bash docs/server-scripts/20-provision-ksy-staging.spec.sh
```

Expected: FAIL because script 20 rejects `--order-telegram-url` before mutation.

### Task 2: Implement the minimal fail-closed override

**Files:**
- Modify: `docs/server-scripts/20-provision-ksy-staging.sh`
- Test: `docs/server-scripts/20-provision-ksy-staging.spec.sh`

**Interfaces:**
- Consumes: `--reuse-existing-secrets`, `--image`, and the optional public override.
- Produces: private `candidate_env` with exactly the requested image and approved order URL.

- [ ] **Step 1: Replace the positional case with an explicit parser**

Track `REUSE_EXISTING_SECRETS`, `KSY_DEALS_IMAGE`, and `ORDER_TELEGRAM_URL_OVERRIDE`. Reject duplicate flags, missing values, unknown flags, bootstrap override use, and every override value except:

```bash
APPROVED_ORDER_TELEGRAM_URL=https://t.me/ksy_deals_store_bot
```

All validation stays before `progress 1` and before Docker/filesystem mutation.

- [ ] **Step 2: Rewrite the two permitted assignments in one private pass**

Replace the image-only `awk` with:

```awk
/^KSY_DEALS_IMAGE=/ { print "KSY_DEALS_IMAGE=" image; next }
order != "" && /^ORDER_TELEGRAM_URL=/ {
  print "ORDER_TELEGRAM_URL=" order
  next
}
{ print }
```

The existing canonical-key validation guarantees exactly one source assignment for each runtime key.

- [ ] **Step 3: Run GREEN and syntax verification**

Run:

```bash
rtk bash -n docs/server-scripts/20-provision-ksy-staging.sh
rtk bash docs/server-scripts/20-provision-ksy-staging.spec.sh
rtk git diff --check
```

Expected: syntax exits 0, spec prints `KSY staging provisioner tests passed`, diff check exits 0.

- [ ] **Step 4: Commit the tested implementation**

```bash
rtk git add docs/server-scripts/20-provision-ksy-staging.sh \
  docs/server-scripts/20-provision-ksy-staging.spec.sh
rtk git commit -m "fix: update KSY order URL in routine deploys"
```

### Task 3: Document, verify, merge, and operate the fix

**Files:**
- Modify in KSY repository: `docs/engineering/runbook.md`
- Verify: Vezdepost shell specs 20–26 and `pnpm run verify:workspace`
- Verify: KSY `pnpm check` under Node `22.20.0` and pnpm `10.15.1`

**Interfaces:**
- Consumes: tested script 20 commit and already-deployed image digest `sha256:8872de4a6721aa224448e394c1f2c707fcce2db400cb5394d1948b8cd4678796`.
- Produces: merged `origin/ops/ksy-staging`, updated KSY runbook, corrected production redirect, and fresh postflight evidence.

- [ ] **Step 1: Update the KSY routine command**

Document the optional fixed override immediately beside the routine script 20 invocation and state that it changes only the public order URL while preserving all secret assignments.

- [ ] **Step 2: Run full local verification**

Run specs 20 through 26, `pnpm run verify:workspace`, KSY `pnpm check`, Bash syntax, and `git diff --check`. Expected: every command exits 0.

- [ ] **Step 3: Commit and merge both repository changes**

Push the Vezdepost fix branch, fast-forward it into `origin/ops/ksy-staging`, and merge the KSY runbook commit into `origin/main`. Re-fetch and require exact remote/local commit equality.

- [ ] **Step 4: Stage and verify production inputs**

Stage the reviewed script 20 and KSY Compose file, compare local and remote SHA-256, and require disk usage below 85%, current/rollback evidence, PostgreSQL volume, and healthy containers before mutation.

- [ ] **Step 5: Execute only the reviewed routine override**

Run script 20 with:

```text
--reuse-existing-secrets
--order-telegram-url https://t.me/ksy_deals_store_bot
--image ghcr.io/fedrbodr/ksy-deals@sha256:8872de4a6721aa224448e394c1f2c707fcce2db400cb5394d1948b8cd4678796
```

Then rerun SHA-verified script 21 and script 23 `--mode routine`.

- [ ] **Step 6: Prove product and infrastructure acceptance**

Take the matching CTA event pre-count, run one approved `curl -I`, require exact `302` and Location, then require post-count = pre-count + 1. Finish with current/rollback image, disk, volume, restart=0, OOM=false, live/ready, routes, state-current, live counts 136/162, disposable DB absence, and local/offsite backup evidence.

- [ ] **Step 7: Report the ControlHub checkpoint**

Use a new idempotency key and record merged commits, deployed digest, corrected acceptance, tests, and remaining reclaimable-image risk.
