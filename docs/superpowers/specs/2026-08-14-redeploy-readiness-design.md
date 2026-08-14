# Redeploy startup stabilization and readiness gate

## Context

Vezdepost production currently deploys one `postiz` container with
`docker compose up -d --build`. Compose recreates that container after a new
image is built, so the application is unavailable until nginx, frontend,
backend, and the Temporal worker finish starting.

The 2026-08-13 production deploy exposed two separate problems:

- the replacement container was created at 19:39:33 UTC and started at
  19:46:39 UTC;
- backend did not become ready until about 19:48:30 UTC and restarted four
  times.

The backend error log recorded PostgreSQL error `23505` on
`pg_type_typname_nsp_index` while Mastra initialized tables including
`mastra_skill_blobs` and `mastra_experiments`.

The code creates one module-level `PostgresStore` and supplies it both as the
Mastra storage and as the agent Memory storage. Mastra wraps those two uses in
independent lazy-initialization proxies. Concurrent first use can therefore
start two `PostgresStore.init()` paths against the same database schema. The
production stack traces confirm two overlapping table initialization failures
through Mastra's `ensureInit` proxy.

This specification covers FED-336 only. Zero-downtime blue-green replacement
is deferred to FED-337 and is not part of this change.

## Goals

- Serialize initialization of the shared Mastra PostgreSQL store.
- Ensure all callers share one in-flight Mastra construction promise.
- Allow a later call to retry after a failed initialization.
- Mark a production revision deployed only after the application processes and
  Temporal worker are ready.
- Emit actionable diagnostics when readiness times out.
- Preserve the existing single-container Compose topology and automatic retry
  behavior.

## Non-goals

- Blue-green deployment or eliminating the unavoidable single-container
  replacement window.
- Upgrading Mastra or changing AI/chat behavior.
- Replacing PM2, Compose, Caddy, Temporal, or the existing watchdog.
- Introducing a new migration framework for Mastra tables.
- Attempting authenticated browser acceptance checks.

## Application initialization design

`MastraService` will own a single static in-flight promise whose resolved value
is the configured `Mastra` instance.

The promise factory will:

1. explicitly await `pStore.init()`;
2. build the Postiz agent and its tools;
3. construct the `Mastra` instance with the initialized store and agent;
4. resolve to that instance.

Every concurrent call to `mastra()` returns the same promise. This prevents
multiple callers from starting separate initialization and construction paths.
Explicitly completing `pStore.init()` before creating Memory and Mastra also
ensures that their independent lazy-init wrappers encounter an already
initialized store rather than racing each other.

If the promise rejects, `MastraService` clears the cached promise only when it
still refers to that failed attempt. A later call can then retry cleanly. The
service must not cache a rejected promise indefinitely, and it must not replace
a newer attempt while handling an older failure.

The existing exported `pStore` remains the one shared store. No new database
connection pools or storage instances are introduced.

## Readiness probe design

A repository-owned executable script will implement the production readiness
contract. It will be usable both by autodeploy and by operators.

The probe succeeds only when all of the following are true:

- container `postiz` is running;
- nginx is listening inside it on port `5000`;
- frontend is listening inside it on port `4200`;
- backend is listening inside it on port `3000`;
- Temporal accepts a task-queue description request; and
- workflow task queue `main` reports at least one poller.

The probe polls until a configurable timeout, using short bounded intervals.
Its defaults must cover normal production startup without relying on the
two-minute watchdog. Configuration is supplied through narrowly named
environment variables so tests can use short intervals without changing the
production defaults.

The success path prints one concise readiness confirmation. The timeout path
returns non-zero and prints:

- container state;
- PM2 process list;
- listening ports;
- recent backend, frontend, and orchestrator logs;
- the latest Temporal task-queue description or its connection error.

Diagnostics are best-effort: failure to collect one item must not suppress the
other evidence or turn a timeout into success.

## Autodeploy integration

`deploy/autodeploy.sh` keeps its existing `flock`, successful-revision marker,
build, and Compose behavior. After `docker compose up -d --build`, it invokes
the readiness probe.

Only after the probe succeeds may autodeploy:

- write the remote revision to `/var/lib/vezdepost-deployed-rev`; and
- log `deploy finished`.

If readiness times out, `set -e` makes the deploy fail. The successful revision
marker remains unchanged, so the next cron tick retries the revision. The
probe's diagnostics are written to the existing autodeploy log.

The script does not repeatedly restart PM2 processes itself. Runtime recovery
remains the watchdog's responsibility; the deploy gate only reports readiness
truthfully and prevents a false-success marker.

## Testing strategy

### Mastra service

Unit tests will replace the real PostgreSQL store, tool loading, and Mastra
constructor with controlled fakes or mocks. They must prove:

- two concurrent `mastra()` calls invoke store initialization once;
- both calls resolve to the same Mastra instance;
- agent construction happens only after store initialization resolves;
- a rejected initialization is not cached permanently;
- a subsequent call performs a new attempt and can succeed.

The concurrency test must hold initialization unresolved until both callers
have entered, so it fails against the current value-only singleton rather than
passing by timing accident.

### Readiness script

Shell tests will run the probe against fake `docker` and timing commands. They
must cover:

- immediate full readiness;
- delayed port readiness followed by success;
- missing backend port at timeout;
- missing Temporal poller at timeout;
- diagnostic command failure without loss of the primary non-zero result.

Autodeploy tests will prove that the revision marker advances only after probe
success and remains unchanged after probe failure.

### Repository and production verification

- Run focused unit and shell tests.
- Run the relevant repository lint/type/test gates from the root.
- Run `git diff --check`.
- Deploy through the normal autodeploy path.
- Confirm the successful revision marker, `deploy finished`, ports
  `3000/4200/5000`, stable PM2 restart counts, and the Temporal poller.
- Run unauthenticated public smoke checks for the landing page, frontend, and
  API response.
- Record the measured replacement and readiness window in the deployment log
  or task notes.

Authenticated acceptance checks remain manual per project policy.

## Rollback and failure behavior

The application change is reversible by restoring the previous
`MastraService` implementation. It does not alter stored data or database
schema definitions.

The deploy-gate change is reversible by restoring the previous autodeploy
script. A failed readiness check intentionally leaves the successful revision
marker at the last known-good commit, causing cron to retry. Operators can use
the emitted diagnostics and existing watchdog/runbooks to recover the current
single container.

## Acceptance criteria

- Backend starts without Mastra-related PostgreSQL `23505` errors and without
  extra PM2 restarts caused by storage initialization.
- Concurrent Mastra access shares one initialization attempt and one instance.
- Autodeploy cannot log success or advance the revision marker before all three
  ports and the Temporal poller are ready.
- A readiness timeout exits non-zero and preserves enough evidence to identify
  the missing signal.
- Automated tests cover concurrency, retry, readiness success, and readiness
  failure.
- Production smoke checks pass after deployment, and the measured downtime is
  recorded for comparison with the blue-green follow-up.
