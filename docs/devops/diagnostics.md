Project: vezdepost (Postiz fork on Timeweb VPS)
Document: devops-runbook-diagnostics

# Diagnostics & troubleshooting playbook

Battle-tested playbook for the app stack (NestJS under pm2 + Temporal + Caddy).
Start from the symptom; each path ends at a root cause and a minimal fix.
**Diagnose by layer, fix the root cause, verify the fix — don't guess.**

---

## The startup-hang family (most common failure)

**Cause:** after any container restart/redeploy, a NestJS process connects to
Temporal at boot; if Temporal isn't fully ready, the process can **hang during
bootstrap** and never finish. Critically, **pm2 still shows it `online`** with
`↺ 0` — it doesn't crash-loop, so pm2 won't self-heal it. The tell is a pm2 log
that's **empty past the `npm start` banner** (no route mapping, no "listening").

Each process has a distinct readiness signal and a distinct user-facing symptom:

| Hung process | Readiness signal (healthy) | Symptom when hung |
|---|---|---|
| **backend** | binds **`:3000`** (only after full bootstrap) | nginx returns **502** on every API → **black screen** / app won't load user |
| **orchestrator** | registers a **poller on Temporal task queue `main`** | scheduled jobs (posts) stuck in `QUEUE` forever, never ERROR |
| **frontend** | binds **`:4200`** | app HTML not served |

### Diagnose

```bash
# which pm2 procs are "online", and their restart counts
docker exec <app> pm2 list

# which ports are actually LISTENING inside the container (the real signal)
docker exec <app> sh -c '(ss -ltn 2>/dev/null||netstat -ltn) | grep -E ":3000|:4200|:5000"'
#   healthy: :3000 (backend) :4200 (frontend) :5000 (nginx) all present
#   backend hung: :3000 MISSING

# is the pm2 log dead past the banner? (hang signature)
docker exec <app> tail -8 /root/.pm2/logs/backend-out.log

# orchestrator: is the Temporal worker polling?
docker exec <temporal-admin> temporal task-queue describe \
  --task-queue main --task-queue-type workflow --address temporal:7233
#   healthy: a poller identity line "PID@host" with a recent LastAccessTime
#   hung:    empty Pollers section
```

### Fix (minimal)

```bash
docker exec <app> pm2 restart <backend|orchestrator|frontend>
# then re-verify the readiness signal (port bound / poller present) and that
# the user-facing symptom is gone.
```

Root-cause note: the real fix is a Temporal-connection-at-startup that **retries
/ waits for namespace-ready** instead of TCP-only. Until then, the **watchdog**
below is the durable safety net.

---

## 502 → black screen (worked example)

Browser console shows `GET /api/user/self → 502`, page is a black screen.

1. `502` from the gateway = upstream (backend) gave no valid response.
2. `docker exec <app> ... grep :3000` → **not listening** ⇒ backend never
   bootstrapped ⇒ startup hang (above).
3. Fix: `pm2 restart backend`; wait for `:3000`; `pm2 log` shows
   `Nest application successfully started` + N routes mapped.

Note: an **unauthenticated** curl to `/user/self` may return `307` (frontend
redirect to login) even while backend is down — only the **authenticated**
request (with session cookie) proxies to `:3000` and exposes the `502`. Reading
the browser console is faster than server-side curl for auth-gated routes.

---

## 502 after deploy: Mastra/PostgreSQL startup race

Observed signature after a full Docker restart:

- authenticated `GET /api/user/self` returns nginx `502`;
- ports `5000` and `4200` listen, but backend port `3000` is absent;
- PM2 may still show backend as `online` or increment its restart count;
- `backend-error.log` contains PostgreSQL `23505` / `pg_type_typname_nsp_index`
  while Mastra creates a type such as `mastra_mcp_server_versions` concurrently.

This is a startup initialization race, not evidence that the just-deployed
frontend change is broken. Once the competing initialization has finished,
restart only backend and wait for its readiness signal:

```bash
docker exec postiz pm2 restart backend

for i in $(seq 1 30); do
  docker exec postiz sh -c \
    '(ss -ltn 2>/dev/null||netstat -ltn) | grep -q :3000' && break
  sleep 2
done

docker exec postiz pm2 logs backend --lines 30 --nostream
```

Healthy evidence is a stable PM2 uptime/restart count, port `3000`, and fresh
`Nest application successfully started` / `Backend started successfully`
messages. PM2 logs accumulate across restarts, so an old `EADDRINUSE` line is
not by itself a current failure.

Probe the public API without copying credentials:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://app.vezdepost.ru/api/user/self
# 401 or another auth response proves the backend answered; 502 means it did not.
```

Before allowing scheduled posts, also verify a workflow poller:

```bash
docker exec temporal-admin-tools temporal task-queue describe \
  --task-queue main --task-queue-type workflow --address temporal:7233
```

---

## Post / job pipeline stuck (Temporal)

Symptom: scheduled work never runs (e.g. posts stay `QUEUE`, not ERROR).

```bash
# post/job state straight from the DB (adapt table/columns)
docker exec <db> psql -U <user> -d <db> -c \
 'select right(id,8),state,"publishDate",left(coalesce(error,''''),120) \
  from "Post" order by "updatedAt" desc limit 12;'
#   ERROR + message = provider/token problem (e.g. ETELEGRAM 401)
#   QUEUE forever, no ERROR = nothing is executing it → orchestrator not polling

# are workflows being created but not executed?
docker exec <temporal-admin> temporal workflow list --address temporal:7233 --limit 15
#   many "Running" postWorkflow… that never Complete = no poller (worker hung)

# confirm the poller is missing on the real task queue
docker exec <temporal-admin> temporal task-queue describe \
  --task-queue main --task-queue-type workflow --address temporal:7233
```

Find the **real task queue name** (don't guess) from a workflow:
`temporal workflow describe --workflow-id <id> -o json | grep taskQueue` (here it
is `main`). Fix = restart the orchestrator; the stuck "Running" workflows resume
and execute immediately (including any already past their scheduled time).

---

## The process watchdog (durable auto-recovery)

Because the startup hang recurs on every restart/redeploy and pm2 won't catch
it, a host cron restarts **only the unhealthy process** on its readiness signal.
Guards prevent false positives; per-process cooldown prevents thrash.

Detection per process:
- backend  → `:3000` listening (else restart backend)
- frontend → `:4200` listening (else restart frontend)
- orchestrator → poller `PID@host` on task queue `main` (else restart orchestrator)

Guards: skip entirely if the app container is down (deploy in progress); only
evaluate the orchestrator if Temporal is reachable (a Temporal outage is not an
orchestrator fault); 6-minute cooldown per process (`/run/…cooldown`) so a
booting process isn't restarted again mid-boot. Runs every 2 min via
`/etc/cron.d/`. Logs only on events to `/var/log/…-watchdog.log`.

Reference implementation: `docs/server-scripts/10-install-orchestrator-watchdog.sh`
(installer, rerunnable) and manual recovery `09-restart-hung-orchestrator.sh`.

**Verify a watchdog before trusting it** — test BOTH branches: run its detector
against a healthy signal (should no-op) **and** against a known-bad one (e.g. an
empty task queue → "would restart"). A watchdog only tested on the happy path is
not tested.

---

## Debug toolbox (copy-paste)

### Credential safety

Never paste or log complete `Cookie`, `Authorization`, `auth`, JWT, session,
OAuth token, or secret values. Replace them with `<redacted>` and prefer
unauthenticated readiness probes. If a privileged JWT is disclosed, treat it
as compromised. Rotating `JWT_SECRET` invalidates every active session, so it
requires an explicit operational decision rather than an automatic recovery
step.

```bash
# stack health
docker ps --format '{{.Names}}\t{{.Status}}'
docker exec <app> pm2 list
docker exec <app> pm2 logs <backend|frontend|orchestrator> --lines 40 --nostream

# app reachability (from host, through Caddy)
curl -sk -D- -o /dev/null https://app.<domain>/            # status + Location
curl -sk -o /dev/null -w '%{http_code}\n' https://app.<domain>/launches

# ports inside the app container
docker exec <app> sh -c '(ss -ltn 2>/dev/null||netstat -ltn) | grep LISTEN'

# Temporal
docker exec <temporal-admin> temporal workflow list --address temporal:7233 --limit 15
docker exec <temporal-admin> temporal task-queue describe \
  --task-queue main --task-queue-type workflow --address temporal:7233
# Temporal UI: ssh -L 8080:127.0.0.1:8080 <host>  →  http://localhost:8080

# Caddy / TLS
docker logs caddy 2>&1 | tail -20

# server + container timing (correlate a failure with the last restart)
date; docker inspect -f '{{.State.StartedAt}}' <app> <temporal>
tail -30 /var/log/app-autodeploy.log
```

Tips: the app container may **not ship `curl`** — probe from the host through
Caddy instead. Correlate any incident with container `StartedAt` and the
autodeploy log first — most incidents here trace back to the **last restart**.
