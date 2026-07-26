# Production deploy recovery knowledge

## Purpose

Capture the verified lessons from the July 26 production deployment incident
so future agents do not confuse a pushed commit, a server Git checkout, or a
healthy frontend response with a completed application deployment.

The guidance must help an operator determine which deployment layer is stale,
recover the two observed failure modes with the existing runbooks, verify post
scheduling readiness, and avoid exposing authentication credentials during
diagnostics.

## Documentation structure

### `docs/PROJECT.md`

Add a concise deployment gate to the existing project overview:

- `origin/prod` and the server repository HEAD prove only that code was pushed
  and fetched;
- `/var/lib/vezdepost-deployed-rev` must match the target commit;
- `/var/log/vezdepost-autodeploy.log` must contain `deploy finished`;
- the `postiz` container must have a new start time;
- application readiness requires ports `3000`, `4200`, and `5000`, plus a
  Temporal workflow poller on task queue `main`.

Keep this section short and link to the detailed runbooks.

### `docs/devops/deployment.md`

Add a concrete “what counts as deployed” checklist with redacted, copyable
commands. Document that these signals are insufficient by themselves:

- local or remote branch contains the commit;
- server checkout HEAD contains the commit;
- `/launches` returns HTTP 200, because the frontend may be healthy while the
  backend is unavailable.

Document the observed BuildKit failure sequence:

1. build reaches `exporting layers`;
2. the log and successful revision marker remain unchanged for at least ten
   minutes;
3. the old container remains active;
4. run `docs/server-scripts/10-recover-buildkit-export.sh` on the host;
5. rerun the standard `deploy/autodeploy.sh` or allow cron to retry;
6. wait for `deploy finished` and re-run the full deployment gate.

The recovery section must direct operators to the existing guarded script
instead of duplicating raw `kill` and `systemctl restart docker` commands.

### `docs/devops/diagnostics.md`

Add the newly observed backend startup-race signature:

- authenticated `/api/user/self` returns nginx `502`;
- `5000` and `4200` listen, but `3000` is absent;
- PM2 may report the backend as online or repeatedly restart it;
- the backend log contains PostgreSQL `23505` while Mastra creates a type such
  as `mastra_mcp_server_versions` concurrently.

Document the minimal recovery:

1. wait until the competing initialization has completed;
2. restart only the PM2 backend process;
3. wait conditionally for port `3000`;
4. verify an unauthenticated API probe returns an authentication response such
   as `401`, not `502`;
5. verify all three ports and the Temporal `main` poller before allowing users
   to schedule posts.

Clarify that an old `EADDRINUSE` line can remain in PM2’s accumulated error log;
current uptime, restart count stability, the listening port, and fresh success
messages determine whether the backend is healthy.

### Credential safety

Add an explicit rule to the diagnostic guidance:

- never paste or log complete `Cookie`, `Authorization`, `auth`, JWT, session,
  OAuth token, or secret values;
- replace values with `<redacted>` in examples;
- prefer unauthenticated readiness probes when they are sufficient;
- if a privileged token is disclosed, treat it as compromised and document
  that rotating `JWT_SECRET` invalidates all sessions and therefore requires an
  explicit operational decision.

## Scope constraints

- Do not change production code, deployment scripts, watchdog behavior, or
  infrastructure.
- Do not commit secrets or reproduce the disclosed token.
- Preserve unrelated content and user-owned uncommitted documentation changes.
- Do not duplicate complete runbooks in `CLAUDE.md` or `AGENTS.md`.
- Keep commands specific to the existing container names, marker paths, and
  task queue used by Vezdepost.

## Verification

- Search the updated docs for every required signal: `deployed-rev`,
  `deploy finished`, `exporting layers`, `23505`, ports `3000/4200/5000`, and
  task queue `main`.
- Search examples for unredacted cookie, JWT, and authorization values.
- Run Markdown formatting checks available in the repository, if any.
- Review the final diff to confirm only the three approved documentation files,
  the design spec, and the implementation plan changed.

## Acceptance criteria

- A future agent can distinguish pushed, fetched, built, started, and ready
  states without guessing.
- The BuildKit recovery uses the guarded project script.
- The Mastra/PostgreSQL startup race is searchable by its exact `23505` error
  code and missing backend port.
- Readiness includes both the API backend and scheduled-post worker.
- All diagnostic examples are safe to share without credentials.
