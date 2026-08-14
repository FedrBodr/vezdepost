# Redeploy Readiness Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent concurrent Mastra PostgreSQL initialization and make production autodeploy report success only after backend, frontend, nginx, and the Temporal worker are ready.

**Architecture:** `MastraService` owns one shared in-flight construction promise and explicitly completes the shared `PostgresStore` initialization before constructing Memory and Mastra. A standalone shell readiness probe defines the production health contract; autodeploy invokes it before advancing the successful revision marker.

**Tech Stack:** TypeScript, NestJS, Mastra 1.x, Vitest, Bash, Docker Compose, PM2, Temporal CLI.

## Global Constraints

- Use only PNPM; run linting and tests from the repository root.
- Preserve the existing Controller → Service → Repository boundaries.
- Do not upgrade Mastra or introduce new dependencies.
- Preserve the single-container Compose topology; blue-green deployment belongs to FED-337.
- Keep the existing watchdog; the readiness probe reports state but does not restart processes.
- Do not advance `/var/lib/vezdepost-deployed-rev` or log `deploy finished` before every readiness signal passes.
- Do not perform authenticated browser checks with personal accounts.
- Do not push or deploy to production without separate explicit authorization.

## File map

- Modify `libraries/nestjs-libraries/src/chat/mastra.service.ts`: serialize store and Mastra initialization.
- Create `libraries/nestjs-libraries/src/chat/mastra.service.spec.ts`: concurrency and retry regression tests.
- Create `deploy/check-readiness.sh`: reusable production readiness contract and timeout diagnostics.
- Create `deploy/check-readiness.spec.sh`: isolated shell tests with a fake Docker CLI.
- Modify `deploy/autodeploy.sh`: testable path overrides and readiness gate before the revision marker.
- Create `deploy/autodeploy.spec.sh`: successful-marker and failed-marker regression tests.
- Modify `docs/devops/deployment.md`: document the new gate, environment controls, diagnostics, and operator commands.

---

### Task 1: Serialize Mastra PostgreSQL initialization

**Files:**
- Create: `libraries/nestjs-libraries/src/chat/mastra.service.spec.ts`
- Modify: `libraries/nestjs-libraries/src/chat/mastra.service.ts`

**Interfaces:**
- Consumes: `pStore.init(): Promise<void>` and `LoadToolsService.agent(): Promise<Agent>`.
- Produces: `MastraService.mastra(): Promise<Mastra>` with one shared in-flight attempt and retry after rejection.

- [ ] **Step 1: Write the failing concurrency and retry tests**

Create `libraries/nestjs-libraries/src/chat/mastra.service.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  agent: vi.fn(),
  mastraConfigs: [] as unknown[],
}));

vi.mock('@gitroom/nestjs-libraries/chat/mastra.store', () => ({
  pStore: { init: mocks.init },
}));

vi.mock('@gitroom/nestjs-libraries/chat/load.tools.service', () => ({
  LoadToolsService: class LoadToolsService {},
}));

vi.mock('@mastra/core/logger', () => ({
  ConsoleLogger: class ConsoleLogger {},
}));

vi.mock('@mastra/core/mastra', () => ({
  Mastra: class Mastra {
    constructor(config: unknown) {
      mocks.mastraConfigs.push(config);
    }
  },
}));

import { MastraService } from './mastra.service';

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('MastraService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mastraConfigs.length = 0;
    (MastraService as any).mastra = undefined;
    (MastraService as any).mastraPromise = undefined;
  });

  it('shares one store initialization and Mastra instance across concurrent callers', async () => {
    const init = deferred<void>();
    mocks.init.mockReturnValue(init.promise);
    mocks.agent.mockResolvedValue({ id: 'postiz-agent' });
    const service = new MastraService({ agent: mocks.agent } as any);

    const first = service.mastra();
    const second = service.mastra();

    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.agent).not.toHaveBeenCalled();

    init.resolve();
    const [firstMastra, secondMastra] = await Promise.all([first, second]);

    expect(firstMastra).toBe(secondMastra);
    expect(mocks.agent).toHaveBeenCalledTimes(1);
    expect(mocks.mastraConfigs).toHaveLength(1);
  });

  it('clears a rejected attempt so a later call can retry', async () => {
    mocks.init
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(undefined);
    mocks.agent.mockResolvedValue({ id: 'postiz-agent' });
    const service = new MastraService({ agent: mocks.agent } as any);

    await expect(service.mastra()).rejects.toThrow('storage unavailable');
    await Promise.resolve();
    await expect(service.mastra()).resolves.toBeDefined();

    expect(mocks.init).toHaveBeenCalledTimes(2);
    expect(mocks.agent).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify the regression is red**

Run:

```bash
pnpm exec vitest run libraries/nestjs-libraries/src/chat/mastra.service.spec.ts --coverage=false
```

Expected: FAIL because current `MastraService` neither calls `pStore.init()` explicitly nor caches an in-flight promise.

- [ ] **Step 3: Implement the minimal serialized initialization**

Replace `MastraService` in `libraries/nestjs-libraries/src/chat/mastra.service.ts` with:

```ts
@Injectable()
export class MastraService {
  static mastra?: Mastra;
  private static mastraPromise?: Promise<Mastra>;

  constructor(private _loadToolsService: LoadToolsService) {}

  async mastra(): Promise<Mastra> {
    if (MastraService.mastra) {
      return MastraService.mastra;
    }

    if (!MastraService.mastraPromise) {
      const attempt = this.createMastra();
      MastraService.mastraPromise = attempt;
      void attempt.catch(() => {
        if (MastraService.mastraPromise === attempt) {
          MastraService.mastraPromise = undefined;
        }
      });
    }

    return MastraService.mastraPromise!;
  }

  private async createMastra(): Promise<Mastra> {
    await pStore.init();
    const mastra = new Mastra({
      storage: pStore,
      agents: {
        postiz: await this._loadToolsService.agent(),
      },
      logger: new ConsoleLogger({
        level: 'info',
      }),
    });
    MastraService.mastra = mastra;
    return mastra;
  }
}
```

Keep the existing imports unchanged.

- [ ] **Step 4: Run focused tests and backend build**

Run:

```bash
pnpm exec vitest run libraries/nestjs-libraries/src/chat/mastra.service.spec.ts --coverage=false
pnpm run build:backend
```

Expected: two Vitest tests pass and the backend build exits 0.

- [ ] **Step 5: Commit Task 1**

```bash
git add libraries/nestjs-libraries/src/chat/mastra.service.ts \
  libraries/nestjs-libraries/src/chat/mastra.service.spec.ts
git commit -m "fix: serialize Mastra storage initialization"
```

---

### Task 2: Add the reusable production readiness probe

**Files:**
- Create: `deploy/check-readiness.sh`
- Create: `deploy/check-readiness.spec.sh`

**Interfaces:**
- Consumes: Docker containers `postiz` and `temporal-admin-tools`, internal ports `3000`, `4200`, `5000`, and Temporal workflow task queue `main`.
- Produces: `deploy/check-readiness.sh`, exit 0 only when every signal is ready; environment controls `POSTIZ_READINESS_ATTEMPTS` and `POSTIZ_READINESS_INTERVAL_SECONDS`.

- [ ] **Step 1: Write the failing shell tests**

Create `deploy/check-readiness.spec.sh` with a temporary fake `docker` binary. The fake must:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/check-readiness.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

make_docker_stub() {
  local bin_dir=$1
  mkdir -p "$bin_dir"
  cat > "$bin_dir/docker" <<'STUB'
#!/usr/bin/env bash
set -u
printf '%s\n' "$*" >> "$DOCKER_CALLS"

if [[ "$1 $2" == 'inspect -f' ]]; then
  printf '%s\n' true
  exit 0
fi

if [[ "$*" == *'temporal task-queue describe'* ]]; then
  if [[ "${MISSING_POLLER:-0}" == 1 ]]; then
    printf '%s\n' 'Pollers: []'
  else
    printf '%s\n' 'Identity 123@postiz'
  fi
  exit 0
fi

if [[ "$*" == *"grep -qE ':3000"* ]]; then
  count=$(cat "$BACKEND_CHECKS" 2>/dev/null || echo 0)
  count=$((count + 1))
  printf '%s\n' "$count" > "$BACKEND_CHECKS"
  [[ "${MISSING_BACKEND:-0}" != 1 && "$count" -gt "${BACKEND_FAILS:-0}" ]]
  exit
fi

if [[ "$*" == *"grep -qE ':4200"* || "$*" == *"grep -qE ':5000"* ]]; then
  exit 0
fi

if [[ "${FAIL_DIAGNOSTICS:-0}" == 1 && "$*" == *'pm2 '* ]]; then
  exit 1
fi

exit 0
STUB
  chmod +x "$bin_dir/docker"
}

run_probe() {
  local name=$1
  shift
  local case_dir="$TMP_DIR/$name"
  local bin_dir="$case_dir/bin"
  mkdir -p "$case_dir"
  make_docker_stub "$bin_dir"
  : > "$case_dir/docker.calls"
  PATH="$bin_dir:$PATH" \
    DOCKER_CALLS="$case_dir/docker.calls" \
    BACKEND_CHECKS="$case_dir/backend.checks" \
    POSTIZ_READINESS_INTERVAL_SECONDS=0 \
    "$@" bash "$SCRIPT"
}

run_probe immediate env POSTIZ_READINESS_ATTEMPTS=1 \
  > "$TMP_DIR/immediate.out" || fail 'ready stack was rejected'
grep -q 'readiness passed' "$TMP_DIR/immediate.out" ||
  fail 'success confirmation missing'

run_probe delayed env POSTIZ_READINESS_ATTEMPTS=2 BACKEND_FAILS=1 \
  > "$TMP_DIR/delayed.out" || fail 'delayed backend never became ready'

if run_probe backend-timeout env POSTIZ_READINESS_ATTEMPTS=1 MISSING_BACKEND=1 \
  > "$TMP_DIR/backend-timeout.out" 2>&1; then
  fail 'missing backend was accepted'
fi
grep -q 'readiness timed out' "$TMP_DIR/backend-timeout.out" ||
  fail 'timeout message missing'

if run_probe poller-timeout env POSTIZ_READINESS_ATTEMPTS=1 MISSING_POLLER=1 \
  > "$TMP_DIR/poller-timeout.out" 2>&1; then
  fail 'missing Temporal poller was accepted'
fi

if run_probe diagnostic-failure env POSTIZ_READINESS_ATTEMPTS=1 \
  MISSING_BACKEND=1 FAIL_DIAGNOSTICS=1 \
  > "$TMP_DIR/diagnostic-failure.out" 2>&1; then
  fail 'diagnostic failure changed timeout into success'
fi
grep -q 'listening ports' "$TMP_DIR/diagnostic-failure.out" ||
  fail 'remaining diagnostics were suppressed'

echo 'Readiness probe tests passed'
```

- [ ] **Step 2: Run the shell test to verify it is red**

Run:

```bash
bash deploy/check-readiness.spec.sh
```

Expected: FAIL because `deploy/check-readiness.sh` does not exist.

- [ ] **Step 3: Implement the readiness probe**

Create `deploy/check-readiness.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail

POSTIZ_CONTAINER=${POSTIZ_CONTAINER:-postiz}
TEMPORAL_ADMIN_CONTAINER=${TEMPORAL_ADMIN_CONTAINER:-temporal-admin-tools}
TEMPORAL_TASK_QUEUE=${TEMPORAL_TASK_QUEUE:-main}
POSTIZ_READINESS_ATTEMPTS=${POSTIZ_READINESS_ATTEMPTS:-90}
POSTIZ_READINESS_INTERVAL_SECONDS=${POSTIZ_READINESS_INTERVAL_SECONDS:-2}
LAST_TEMPORAL_OUTPUT='Temporal task queue has not been checked yet.'

port_up() {
  local port=$1
  docker exec "$POSTIZ_CONTAINER" sh -c \
    "(ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -qE ':${port}[[:space:]]'" \
    >/dev/null 2>&1
}

poller_up() {
  if ! LAST_TEMPORAL_OUTPUT=$(docker exec "$TEMPORAL_ADMIN_CONTAINER" \
    temporal task-queue describe \
    --task-queue "$TEMPORAL_TASK_QUEUE" \
    --task-queue-type workflow \
    --address temporal:7233 2>&1); then
    return 1
  fi
  grep -qE '[0-9]+@[[:alnum:]_.-]+' <<<"$LAST_TEMPORAL_OUTPUT"
}

ready() {
  [[ "$(docker inspect -f '{{.State.Running}}' "$POSTIZ_CONTAINER" 2>/dev/null)" == true ]] &&
    port_up 5000 &&
    port_up 4200 &&
    port_up 3000 &&
    poller_up
}

diagnose() {
  echo '--- container state ---'
  docker inspect -f '{{.State.Status}} running={{.State.Running}} restart={{.RestartCount}}' \
    "$POSTIZ_CONTAINER" 2>&1 || true
  echo '--- PM2 processes ---'
  docker exec "$POSTIZ_CONTAINER" pm2 list 2>&1 || true
  echo '--- listening ports ---'
  docker exec "$POSTIZ_CONTAINER" sh -c \
    '(ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -E ":3000|:4200|:5000"' \
    2>&1 || true
  echo '--- Temporal task queue ---'
  printf '%s\n' "$LAST_TEMPORAL_OUTPUT"
  for process in backend frontend orchestrator; do
    echo "--- ${process} logs ---"
    docker exec "$POSTIZ_CONTAINER" pm2 logs "$process" --lines 30 --nostream \
      2>&1 || true
  done
}

for ((attempt = 1; attempt <= POSTIZ_READINESS_ATTEMPTS; attempt++)); do
  if ready; then
    echo "readiness passed on attempt ${attempt}/${POSTIZ_READINESS_ATTEMPTS}"
    exit 0
  fi
  if ((attempt < POSTIZ_READINESS_ATTEMPTS)); then
    sleep "$POSTIZ_READINESS_INTERVAL_SECONDS"
  fi
done

echo "readiness timed out after ${POSTIZ_READINESS_ATTEMPTS} attempts" >&2
diagnose >&2
exit 1
```

Make both files executable:

```bash
chmod +x deploy/check-readiness.sh deploy/check-readiness.spec.sh
```

- [ ] **Step 4: Run the readiness tests**

Run:

```bash
bash deploy/check-readiness.spec.sh
```

Expected: `Readiness probe tests passed` and exit 0.

- [ ] **Step 5: Commit Task 2**

```bash
git add deploy/check-readiness.sh deploy/check-readiness.spec.sh
git commit -m "feat: add production readiness probe"
```

---

### Task 3: Gate autodeploy success on readiness

**Files:**
- Modify: `deploy/autodeploy.sh`
- Create: `deploy/autodeploy.spec.sh`
- Modify: `docs/devops/deployment.md`

**Interfaces:**
- Consumes: executable `READINESS_SCRIPT`, defaulting to `$REPO_DIR/deploy/check-readiness.sh`.
- Produces: marker update only after readiness exit 0; test overrides `REPO_DIR`, `AUTODEPLOY_LOG`, `AUTODEPLOY_LOCK`, `AUTODEPLOY_STATE`, and `READINESS_SCRIPT`.

- [ ] **Step 1: Write the failing marker-gate test**

Create `deploy/autodeploy.spec.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$SCRIPT_DIR/autodeploy.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

make_stubs() {
  local case_dir=$1
  mkdir -p "$case_dir/bin" "$case_dir/repo/deploy"
  cat > "$case_dir/bin/git" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  'fetch --no-recurse-submodules origin prod') exit 0 ;;
  'rev-parse origin/prod') echo new-revision ;;
  'reset --hard new-revision') echo 'HEAD is now at new-revision' ;;
  *) echo "unexpected git command: $*" >&2; exit 2 ;;
esac
STUB
  cat > "$case_dir/bin/docker" <<'STUB'
#!/usr/bin/env bash
[[ "$*" == 'compose up -d --build' ]] || exit 2
STUB
  chmod +x "$case_dir/bin/git" "$case_dir/bin/docker"
}

run_case() {
  local name=$1
  local readiness_exit=$2
  local case_dir="$TMP_DIR/$name"
  make_stubs "$case_dir"
  printf '%s\n' old-revision > "$case_dir/state"
  cat > "$case_dir/readiness" <<STUB
#!/usr/bin/env bash
echo readiness-exit-$readiness_exit
exit $readiness_exit
STUB
  chmod +x "$case_dir/readiness"

  PATH="$case_dir/bin:$PATH" \
    REPO_DIR="$case_dir/repo" \
    AUTODEPLOY_LOG="$case_dir/autodeploy.log" \
    AUTODEPLOY_LOCK="$case_dir/autodeploy.lock" \
    AUTODEPLOY_STATE="$case_dir/state" \
    READINESS_SCRIPT="$case_dir/readiness" \
    bash "$SCRIPT"
}

run_case success 0
[[ "$(cat "$TMP_DIR/success/state")" == new-revision ]] ||
  fail 'successful readiness did not advance marker'
grep -q 'deploy finished' "$TMP_DIR/success/autodeploy.log" ||
  fail 'successful readiness did not finish deploy'

if run_case failure 1; then
  fail 'failed readiness was reported as successful'
fi
[[ "$(cat "$TMP_DIR/failure/state")" == old-revision ]] ||
  fail 'failed readiness advanced marker'
! grep -q 'deploy finished' "$TMP_DIR/failure/autodeploy.log" ||
  fail 'failed readiness logged deploy finished'
grep -q 'readiness-exit-1' "$TMP_DIR/failure/autodeploy.log" ||
  fail 'readiness diagnostics were not retained'

echo 'Autodeploy readiness-gate tests passed'
```

- [ ] **Step 2: Run the test to verify it is red**

Run:

```bash
bash deploy/autodeploy.spec.sh
```

Expected: FAIL because current autodeploy ignores environment overrides and has no readiness invocation.

- [ ] **Step 3: Add safe overrides and invoke readiness before the marker**

Change the configuration section of `deploy/autodeploy.sh` to:

```bash
REPO_DIR=${REPO_DIR:-/root/postiz-app}
LOG=${AUTODEPLOY_LOG:-/var/log/vezdepost-autodeploy.log}
LOCK=${AUTODEPLOY_LOCK:-/var/lock/vezdepost-autodeploy.lock}
STATE=${AUTODEPLOY_STATE:-/var/lib/vezdepost-deployed-rev}
READINESS_SCRIPT=${READINESS_SCRIPT:-$REPO_DIR/deploy/check-readiness.sh}

exec 9>"$LOCK"
flock -n 9 || exit 0
```

Remove the later hard-coded `STATE=` assignment. Immediately after Compose returns, add:

```bash
  "$READINESS_SCRIPT"
```

The final order inside the logged block must be:

```bash
  git reset --hard "$REMOTE"
  docker compose up -d --build
  "$READINESS_SCRIPT"
  echo "$REMOTE" > "$STATE"
  echo "$(date -Is) deploy finished"
```

- [ ] **Step 4: Document the readiness gate**

Update the autodeploy sketch so it places the probe between Compose and the
marker update. Add this section to `docs/devops/deployment.md`:

````markdown
### Readiness gate

Autodeploy does not mark a revision successful immediately after Compose
starts the replacement container. It runs the repository-owned readiness
probe first:

```sh
cd /root/postiz-app
bash deploy/check-readiness.sh
```

The probe makes 90 attempts by default, two seconds apart. Operators can
override those values for a one-off run with
`POSTIZ_READINESS_ATTEMPTS` and
`POSTIZ_READINESS_INTERVAL_SECONDS`.

A deploy is ready only when nginx (`:5000`), frontend (`:4200`), backend
(`:3000`), and a workflow poller on Temporal task queue `main` are all
present. On timeout the probe prints container state, PM2 state, listening
ports, Temporal output, and recent process logs. It exits non-zero, so
autodeploy leaves `/var/lib/vezdepost-deployed-rev` unchanged and cron retries
the revision on its next tick.
````

- [ ] **Step 5: Run shell tests and syntax checks**

Run:

```bash
bash -n deploy/check-readiness.sh deploy/check-readiness.spec.sh \
  deploy/autodeploy.sh deploy/autodeploy.spec.sh
bash deploy/check-readiness.spec.sh
bash deploy/autodeploy.spec.sh
```

Expected: syntax check exits 0; both test scripts print their passed messages.

- [ ] **Step 6: Commit Task 3**

```bash
git add deploy/autodeploy.sh deploy/autodeploy.spec.sh docs/devops/deployment.md
git commit -m "fix: gate autodeploy on application readiness"
```

---

### Task 4: Full local verification and deployment handoff

**Files:**
- Verify all files changed in Tasks 1-3.
- Do not modify production or external systems in this task.

**Interfaces:**
- Consumes: the completed branch and all automated tests.
- Produces: evidence that the branch is ready for review and a separate authorized production rollout.

- [ ] **Step 1: Run focused verification**

```bash
pnpm exec vitest run libraries/nestjs-libraries/src/chat/mastra.service.spec.ts --coverage=false
bash deploy/check-readiness.spec.sh
bash deploy/autodeploy.spec.sh
pnpm run build:backend
```

Expected: all focused tests pass and backend build exits 0.

- [ ] **Step 2: Run the full repository test suite**

```bash
pnpm test
```

Expected: exit 0 with no failed Vitest files or tests. Record the Node engine warning separately if the local runtime is not `>=22.12.0 <23.0.0`.

- [ ] **Step 3: Check the final diff and branch state**

```bash
git diff --check prod...HEAD
git status --short
git log --oneline --decorate prod..HEAD
```

Expected: no whitespace errors, clean status, and one design commit plus the three implementation commits.

- [ ] **Step 4: Review against the acceptance criteria**

Confirm directly from code and test output:

- one concurrent Mastra initialization attempt;
- retry after rejected initialization;
- readiness requires ports `3000`, `4200`, `5000` and a Temporal poller;
- diagnostics are best-effort;
- marker update follows readiness and cannot run after failure;
- no dependency, Compose-topology, or authenticated-check changes.

- [ ] **Step 5: Prepare the separately authorized production checklist**

Do not push or deploy in this task. Hand off these commands for the later authorized rollout:

```bash
cat /var/lib/vezdepost-deployed-rev
tail -40 /var/log/vezdepost-autodeploy.log
docker inspect -f '{{.Created}} {{.State.StartedAt}} {{.State.Status}}' postiz
docker exec postiz pm2 list
bash /root/postiz-app/deploy/check-readiness.sh
docker exec postiz sh -c \
  "grep -E 'pg_type_typname_nsp_index|MASTRA_STORAGE_PG_CREATE_TABLE_FAILED' \
  /root/.pm2/logs/backend-error.log | tail -20"
curl -sS -o /dev/null -w '%{http_code}\n' https://vezdepost.ru/
curl -sS -o /dev/null -w '%{http_code}\n' https://app.vezdepost.ru/launches
curl -sS -o /dev/null -w '%{http_code}\n' https://app.vezdepost.ru/api/user/self
```

Healthy evidence is the new revision marker, a fresh `deploy finished`, readiness exit 0, stable backend restart count, and a non-502 public API response. Authenticated acceptance remains the user's manual check.

Record the old-container stop time, new-container start time, backend-ready
time, PM2 restart delta, and public probe results in the FED-336 Linear task so
FED-337 can compare the measured replacement window.
