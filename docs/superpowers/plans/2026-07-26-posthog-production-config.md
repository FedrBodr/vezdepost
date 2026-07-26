# PostHog Production Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add and run a safe, repeatable production script that configures the existing Vezdepost PostHog integration.

**Architecture:** A Bash script accepts a test-only environment input or securely prompts for the public PostHog project token through `/dev/tty`. It atomically updates the server `.env`, validates Compose, recreates only `postiz`, and checks the resolved container environment without exposing the token.

**Tech Stack:** Bash, Docker Compose, shell behavior tests, SSH, PostHog EU Cloud.

## Global Constraints

- Production repository path is `/root/postiz-app` on `root@201.51.7.50`.
- Store values only in the untracked server `.env` with mode `600`.
- Never commit, print, or place the real project token in a command argument.
- `NEXT_PUBLIC_POSTHOG_HOST` is exactly `https://eu.i.posthog.com`.
- Recreate only the `postiz` service and do not rebuild the image for this env-only change.
- Preserve unrelated local and server configuration.

---

### Task 1: Idempotent PostHog configuration script

**Files:**
- Create: `docs/server-scripts/14-configure-posthog.spec.sh`
- Create: `docs/server-scripts/14-configure-posthog.sh`
- Modify: `deploy/README.md`

**Interfaces:**
- Consumes: `REPO_DIR` override for tests; optional `POSTHOG_PROJECT_TOKEN` for tests; otherwise a hidden `/dev/tty` prompt.
- Produces: `.env` entries `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST`, plus a recreated and verified `postiz` container.

- [ ] **Step 1: Write the failing shell behavior test**

Create a temporary repository, an `.env` containing duplicate stale PostHog values and an unrelated value, and a stub `docker` executable that logs invocations. Run the missing production script with a fake `phc_testToken123` input and assert:

```bash
assert_eq 1 "$(grep -c '^NEXT_PUBLIC_POSTHOG_KEY=' "$repo/.env")"
assert_eq 'NEXT_PUBLIC_POSTHOG_KEY=phc_testToken123' \
  "$(grep '^NEXT_PUBLIC_POSTHOG_KEY=' "$repo/.env")"
assert_eq 'NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com' \
  "$(grep '^NEXT_PUBLIC_POSTHOG_HOST=' "$repo/.env")"
grep -q '^JWT_SECRET=keep-me$' "$repo/.env"
! grep -q 'phc_testToken123' "$output_file"
grep -q '^compose config --quiet$' "$docker_calls"
grep -q '^compose up -d --no-deps --force-recreate postiz$' "$docker_calls"
grep -q '^exec postiz sh -lc ' "$docker_calls"
```

Add a second case that passes `invalid-token`, expects a non-zero exit, and compares `.env` byte-for-byte with its pre-run copy.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
rtk bash docs/server-scripts/14-configure-posthog.spec.sh
```

Expected: FAIL because `docs/server-scripts/14-configure-posthog.sh` does not exist.

- [ ] **Step 3: Implement the minimal production script**

The script must:

```bash
REPO_DIR=${REPO_DIR:-/root/postiz-app}
ENV_FILE="$REPO_DIR/.env"
POSTHOG_HOST=https://eu.i.posthog.com
token=${POSTHOG_PROJECT_TOKEN:-}
```

If `token` is empty, read it silently from `/dev/tty`. Validate with
`[[ "$token" =~ ^phc_[A-Za-z0-9_-]+$ ]]` before touching `.env`. Use `umask 077`,
`mktemp`, a shell `while IFS= read -r line` loop, and builtin `printf` calls to
replace the two named entries once, remove duplicates, preserve all unrelated
lines, append missing entries, `chmod 600` the temporary file, and atomically
`mv` it over `.env`.

Apply and verify without outputting values:

```bash
docker compose config --quiet
docker compose up -d --no-deps --force-recreate postiz
docker exec postiz sh -lc \
  'test -n "${NEXT_PUBLIC_POSTHOG_KEY:-}" && test "${NEXT_PUBLIC_POSTHOG_HOST:-}" = "https://eu.i.posthog.com"'
```

Print only `PostHog production configuration applied and verified` on success.

- [ ] **Step 4: Run the behavior test and verify GREEN**

Run:

```bash
rtk bash docs/server-scripts/14-configure-posthog.spec.sh
rtk bash -n docs/server-scripts/14-configure-posthog.sh
```

Expected: both commands exit `0`; the behavior test reports all cases passed.

- [ ] **Step 5: Document the safe production command**

Extend the PostHog section in `deploy/README.md` with:

```bash
ssh -tt -o BatchMode=yes -o ConnectTimeout=10 root@201.51.7.50 \
  'bash -s' < docs/server-scripts/14-configure-posthog.sh
```

Document that the prompt is hidden, the project token must start with `phc_`,
and the script does not rebuild the image.

- [ ] **Step 6: Run repository verification and commit**

Run:

```bash
rtk bash docs/server-scripts/14-configure-posthog.spec.sh
rtk bash -n docs/server-scripts/14-configure-posthog.sh
rtk git diff --check
```

Expected: all commands exit `0`.

Commit only the three task files:

```bash
rtk git add docs/server-scripts/14-configure-posthog.spec.sh \
  docs/server-scripts/14-configure-posthog.sh deploy/README.md
rtk git commit -m "ops: configure PostHog analytics"
```

### Task 2: Apply and verify production configuration

**Files:**
- No repository files changed.

**Interfaces:**
- Consumes: the verified Task 1 script and the operator-provided `phc_` project token entered at the hidden prompt.
- Produces: active PostHog configuration in the production `postiz` container.

- [ ] **Step 1: Execute the repository script on the VPS**

Run from the repository worktree:

```bash
ssh -tt -o BatchMode=yes -o ConnectTimeout=10 root@201.51.7.50 \
  'bash -s' < docs/server-scripts/14-configure-posthog.sh
```

At the hidden prompt, enter the PostHog project token. Expected safe output ends
with `PostHog production configuration applied and verified` and contains no
token.

- [ ] **Step 2: Verify production layers read-only**

Run:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 root@201.51.7.50 \
  'cat /var/lib/vezdepost-deployed-rev; docker inspect -f "{{.Created}} {{.State.StartedAt}} {{.State.Status}}" postiz; docker exec postiz sh -c '\''(ss -ltn 2>/dev/null||netstat -ltn) | grep -E ":3000|:4200|:5000"'\''; curl -sS -o /dev/null -w "%{http_code}\n" https://app.vezdepost.ru/api/user/self'
```

Expected: a revision is printed, container status is `running`, all three ports
are listening, and the authenticated endpoint returns an HTTP response rather
than a gateway error (`401` is acceptable while logged out).

- [ ] **Step 3: Verify a real analytics event**

In a signed-in Vezdepost browser session, open the channel picker and click X.
In PostHog `Activity` → `Events`, verify a fresh `channel_connect_clicked` event
with property `platform = x`. If browser access is not available to the worker,
hand this single UI assertion to the user after all server-side checks pass.
