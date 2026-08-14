Project: vezdepost (Postiz fork on Timeweb VPS)
Document: devops-runbook-deployment

# Deployment patterns — Compose + Caddy + autodeploy

The deployment architecture and the patterns that make it fast and
reboot-safe. Stack here is Docker Compose running a Node/NestJS app under pm2
(backend / frontend / orchestrator), Postgres, Redis, Temporal, behind Caddy.

---

## Stack layout

```
Internet ──443/80──▶ Caddy (TLS termination, auto Let's Encrypt, http→https 308)
                        │  reverse_proxy 127.0.0.1:<appPort>
                        ▼
                    app container (nginx :5000 ──▶ frontend :4200 / backend :3000)
                        │
        Postgres · Redis · Temporal (+ its own Postgres/ES/UI)
```

- The app port is bound to **`127.0.0.1` only** — never exposed publicly; Caddy
  is the only public listener. Temporal UI/gRPC (`8080`/`7233`) likewise bound
  to loopback; reach the UI via `ssh -L 8080:127.0.0.1:8080 <host>`.
- Secrets come from an untracked `.env` (see `access-and-secrets.md`).

---

## Domains & TLS

- Landing on the apex + `www`, app on `app.<domain>`. DNS: A records → server IP.
- Caddy auto-provisions LE certs and redirects http→https (308).
- **Secure cookies** turn on once you're on real HTTPS — sessions created on a
  bare IP / `NOT_SECURED` era become invalid, so users must re-login after the
  cutover. Set the public URLs to `https://app.<domain>` in the app config.
- Serve a static landing via a **bind-mount** into Caddy (not baked into the
  image) so landing edits deploy **instantly** without an image rebuild.

---

## Autodeploy (pull-based)

A cron job polls the deploy branch and redeploys on change. Key properties that
matter:

```bash
# deploy/autodeploy.sh (sketch)
exec 9>/run/autodeploy.lock; flock -n 9 || exit 0        # never overlap runs
git -C "$REPO" fetch --quiet origin "$BRANCH"
remote=$(git -C "$REPO" rev-parse "origin/$BRANCH")
deployed=$(cat /var/lib/app-deployed-rev 2>/dev/null || echo none)
[ "$remote" = "$deployed" ] && exit 0
git -C "$REPO" reset --hard "origin/$BRANCH"
docker compose -f "$REPO/docker-compose.yaml" up -d --build   # >> logfile
bash "$REPO/deploy/check-readiness.sh"
echo "$remote" > /var/lib/app-deployed-rev                    # only on SUCCESS
```

```
# /etc/cron.d/app-autodeploy
*/3 * * * * root /path/deploy/autodeploy.sh >> /var/log/app-autodeploy.log 2>&1
```

- **`flock`** so two ticks never build at once.
- **Track the last *successful* rev** (write the marker only after a successful
  `compose up`), not HEAD — otherwise a failed deploy is marked done and never
  retried. With the marker gated on success, a failed deploy retries next tick.
- Everything logs to `/var/log/app-autodeploy.log`.

### Readiness gate

Autodeploy does not mark a revision successful immediately after Compose
starts the replacement container. It runs the repository-owned readiness
probe first:

```sh
cd /root/postiz-app
bash deploy/check-readiness.sh
```

The probe has a 180-second wall-clock deadline, makes at most 90 attempts, and
waits two seconds between attempts by default. Every Docker/Temporal check is
also bounded to five seconds, and every timeout diagnostic is collected with
its own five-second bound. Operators can override those values for a one-off
run with `POSTIZ_READINESS_TIMEOUT_SECONDS`,
`POSTIZ_READINESS_COMMAND_TIMEOUT_SECONDS`,
`POSTIZ_READINESS_DIAGNOSTIC_TIMEOUT_SECONDS`,
`POSTIZ_READINESS_ATTEMPTS`, and
`POSTIZ_READINESS_INTERVAL_SECONDS`.

A deploy is ready only when nginx (`:5000`), frontend (`:4200`), backend
(`:3000`), the orchestrator health endpoint (`:3002/health/status`), and a
workflow poller on Temporal task queue `main` are all present. The health
endpoint reports the exact `PID@<postiz-container-hostname>` identity configured
on the Temporal worker. Readiness requires that exact identity, so neither a
poller from a replaced container nor an old PID retained after an orchestrator
restart can pass the gate. On timeout the probe prints container state, PM2
state, listening ports, fresh orchestrator health and Temporal queries, and
recent process logs. It exits non-zero, so autodeploy leaves
`/var/lib/vezdepost-deployed-rev` unchanged and cron retries the revision on its
next tick.

---

## Что считать успешным production deploy

Push, server Git HEAD и HTTP 200 от `/launches` — промежуточные сигналы, не
доказательство завершённого deploy. `/launches` обслуживает frontend и может
отвечать 200, пока backend API отдаёт 502.

Проверяй состояние по слоям:

```bash
# 1. Последний УСПЕШНО задеплоенный commit
cat /var/lib/vezdepost-deployed-rev

# 2. Сборка и переключение контейнера завершились
tail -40 /var/log/vezdepost-autodeploy.log
# ожидается свежая строка: deploy finished

# 3. Контейнер действительно пересоздан
docker inspect -f '{{.Created}} {{.State.StartedAt}} {{.State.Status}}' postiz

# 4. Реальные readiness-сигналы процессов
docker exec postiz sh -c \
  '(ss -ltn 2>/dev/null||netstat -ltn) | grep -E ":3000|:4200|:5000"'

# 5. Планировщик публикаций готов
docker exec temporal-admin-tools temporal task-queue describe \
  --task-queue main --task-queue-type workflow --address temporal:7233
# ожидается непустой раздел Pollers
```

Только после совпадения revision marker, `deploy finished`, нового контейнера,
трёх портов и Temporal poller изменение считается live.

---

## Build-speed optimization

A full image rebuild is slow (tens of minutes) because `COPY . .` invalidates
the `pnpm install` cache layer on **any** file change. Mitigations:

- **`.dockerignore` aggressively.** Exclude everything not needed at build:
  `node_modules`, `dist`, `.git`, `**/*.md`, `deploy/`, **`docs/`**, `.env`.
  Result: docs/ops commits no longer bust the cache → they deploy near-instant.
  Verify a docs-only change doesn't trigger a rebuild after this.
- **Bind-mount** static assets (landing) instead of `COPY` → instant edits.
- **Pin the base image by digest** (`FROM node:22-bookworm-slim@sha256:…`) to
  avoid Docker Hub 429 re-pulls and for reproducibility.
- Planned further win: a dedicated build Dockerfile using `pnpm fetch` +
  lockfile so dependency layers cache independently of source changes.
- Watch for a **BuildKit hang** at `exporting layers`: the successful revision
  marker and log stop changing, the old container remains active, and the
  compose build is older than ten minutes. Age alone is not proof of a hang.
  On the 2026-07-26 deploy, `exporting layers` legitimately took 501 seconds
  and `unpacking` another 149 seconds (650 seconds total). If the log advances,
  disk usage changes, or `dockerd` consumes CPU, let the active export/unpack
  finish even after the ten-minute mark. A server Git HEAD on the new commit
  still does not mean the image is live.
- Recover with the guarded project script, not ad-hoc `kill`/Docker commands:
  ```sh
  cd /root/postiz-app
  bash docs/server-scripts/10-recover-buildkit-export.sh
  ```
  The script refuses to stop builds younger than 600 seconds, terminates the
  stuck compose build, restarts Docker, and leaves the successful revision
  marker unchanged. Run `bash deploy/autodeploy.sh` or let cron retry, then
  repeat the full deployment gate above.

### Compose stuck at `Container postiz Recreate`

After a completed image export, Compose can stall while replacing the old
container. Confirm the exact states before intervening:

```bash
docker ps -a --filter name=postiz \
  --format '{{.Names}}|{{.Status}}|{{.Image}}'
docker inspect postiz \
  --format '{{.State.Status}}|{{.State.Running}}|{{.State.Dead}}|{{.State.ExitCode}}'
```

The observed failure signature was the old `postiz` in `removing`,
`Running=false`, `Dead=true`, while a newly created temporary container named
like `<old-id>_postiz` remained in `Created`. The new image was ready, but the
old dead container still owned the final name.

If the enclosing `docker compose up -d --build` is older than 600 seconds and
the states remain unchanged, use `10-recover-buildkit-export.sh`. After Docker
returns, verify that the old dead container disappeared, then rerun the normal
guarded deploy:

```bash
cd /root/postiz-app
bash deploy/autodeploy.sh
```

Do not write `/var/lib/vezdepost-deployed-rev` manually. The deploy script must
advance it only after Compose starts the replacement container and emits
`deploy finished`.

### Public smoke test and route-specific Timeweb failures

Finish with independent public probes, not only an SSH session:

```bash
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' \
  https://vezdepost.ru/
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' \
  https://vezdepost.ru/assets/vezdepost-og.png
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://app.vezdepost.ru/api/user/self
```

Expected: landing `200 text/html`, preview `200 image/png`, unauthenticated API
`401`. Timeweb routing can fail selectively: TCP may connect while the SSH
banner or TLS payload times out from one network, even though the site opens
from another. Before rebooting a healthy VM, compare at least two routes (for
example the operator connection plus a proxy/another client) and separate a
route failure from an application failure. A reboot is especially risky here
because Timeweb network tuning may reset on reboot.

---

## Startup ordering & reboot resilience

- NestJS processes connect to **Temporal at boot**. If a process starts before
  Temporal is fully ready, it can **hang during bootstrap** and never finish
  coming up (pm2 still shows it "online"). See `diagnostics.md` → startup-hang.
- Mitigations in place:
  - `restart: always` on the whole Temporal stack (a Temporal crash was the
    root cause of a reboot incident).
  - A `wait-temporal` gate that blocks pm2 start until Temporal accepts TCP
    (necessary but **not sufficient** — TCP-open ≠ namespace-ready, so the hang
    can still happen).
  - A host **watchdog** cron that detects a hung process and restarts just it
    (the durable safety net — see `diagnostics.md`).
- Always run a **reboot acceptance test**: reboot, then externally verify the
  app + API come up with zero manual commands.

---

## Routine ops cheatsheet

```bash
# code change:        git pull && docker compose up -d --build   (~build time)
# env-only change:    edit .env / override && docker compose up -d
# after recreate, if backend can't resolve temporal: docker restart <app>
```
