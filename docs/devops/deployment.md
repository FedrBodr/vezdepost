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
  compose build is older than ten minutes. Confirm age and activity before
  recovery; a server Git HEAD on the new commit does not mean the image is live.
- Recover with the guarded project script, not ad-hoc `kill`/Docker commands:
  ```sh
  cd /root/postiz-app
  bash docs/server-scripts/10-recover-buildkit-export.sh
  ```
  The script refuses to stop builds younger than 600 seconds, terminates the
  stuck compose build, restarts Docker, and leaves the successful revision
  marker unchanged. Run `bash deploy/autodeploy.sh` or let cron retry, then
  repeat the full deployment gate above.

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
