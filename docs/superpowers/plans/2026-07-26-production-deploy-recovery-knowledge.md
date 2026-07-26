# Production Deploy Recovery Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the verified production deployment and recovery lessons in project instructions and operational runbooks.

**Architecture:** Keep a short mandatory readiness gate in `docs/PROJECT.md`, with detailed deployment-state and incident-recovery procedures in the existing `docs/devops` runbooks. The runbooks currently exist only as approved untracked user files in the primary checkout, so this documentation-only plan executes there instead of creating a worktree that would omit or overwrite them.

**Tech Stack:** Markdown, shell command examples, Git, Docker Compose, PM2, Temporal CLI.

## Global Constraints

- Do not change production code, deployment scripts, watchdog behavior, or infrastructure.
- Do not commit secrets or reproduce the disclosed token.
- Preserve unrelated content and user-owned uncommitted documentation changes.
- The user explicitly approved adding the current `docs/devops/deployment.md` and `docs/devops/diagnostics.md` files to Git with the new sections.
- Do not stage other untracked `docs/devops`, `docs/server-scripts`, or root files.
- Do not duplicate complete runbooks in `CLAUDE.md` or `AGENTS.md`.
- Keep commands specific to the existing Vezdepost container names, revision marker, and Temporal task queue.
- Execute in the primary `prod` checkout because the approved runbooks are untracked and unavailable in a new worktree.

---

### Task 1: Add the deployment readiness gate

**Files:**
- Modify: `docs/PROJECT.md`

**Interfaces:**
- Consumes: existing “Деплой и проверка изменений” project-overview section.
- Produces: a concise mandatory checklist linking agents to the detailed deployment and diagnostic runbooks.

- [ ] **Step 1: Add the gate after the existing landing verification example**

Insert this Markdown in `docs/PROJECT.md`:

```markdown

### Что считать реально задеплоенным

Не считать deploy завершённым только потому, что `origin/prod`, серверный Git
HEAD или лендинг/страница приложения уже показывают новый commit. Для
production-кода обязательны все сигналы:

1. `/var/lib/vezdepost-deployed-rev` равен целевому commit;
2. `/var/log/vezdepost-autodeploy.log` содержит свежую строку `deploy finished`;
3. контейнер `postiz` пересоздан и имеет новое `StartedAt`;
4. внутри контейнера слушают порты backend/frontend/nginx: `3000`, `4200`,
   `5000`;
5. в Temporal task queue `main` зарегистрирован workflow poller.

HTTP 200 от `/launches` подтверждает только frontend: backend при этом может
возвращать 502. Полные команды и recovery-процедуры — в
[`devops/deployment.md`](devops/deployment.md) и
[`devops/diagnostics.md`](devops/diagnostics.md). Никогда не вставляй в чат или
логи полный `Cookie`, `Authorization`, `auth`, JWT, OAuth/session token или
секрет; заменяй значение на `<redacted>`.
```

- [ ] **Step 2: Verify the concise gate contains every required signal**

Run:

```bash
rtk rg -n "deployed-rev|deploy finished|StartedAt|3000|4200|5000|task queue `main`|<redacted>" docs/PROJECT.md
```

Expected: every alternative appears in the new deployment-gate section.

---

### Task 2: Document deployment-state verification and BuildKit recovery

**Files:**
- Add and modify approved user file: `docs/devops/deployment.md`

**Interfaces:**
- Consumes: `/var/lib/vezdepost-deployed-rev`, the autodeploy log, Docker Compose, and `docs/server-scripts/10-recover-buildkit-export.sh`.
- Produces: a copyable deployment gate and guarded BuildKit recovery sequence.

- [ ] **Step 1: Add a “what counts as deployed” section after the autodeploy description**

Insert this Markdown:

````markdown
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
````

- [ ] **Step 2: Replace the raw BuildKit-hang cure with the guarded project script**

Replace the existing BuildKit paragraph with:

````markdown
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
````

- [ ] **Step 3: Verify the deployment runbook**

Run:

```bash
rtk rg -n "deployed-rev|deploy finished|StartedAt|exporting layers|10-recover-buildkit-export|600 seconds|task-queue main" docs/devops/deployment.md
```

Expected: the verification gate and guarded recovery signals are present.

---

### Task 3: Document the Mastra/PostgreSQL startup race and safe probes

**Files:**
- Add and modify approved user file: `docs/devops/diagnostics.md`

**Interfaces:**
- Consumes: PM2 status/logs, container ports, PostgreSQL error code `23505`, public API behavior, and Temporal poller state.
- Produces: a searchable incident signature, minimal backend recovery, scheduling-readiness check, and credential-redaction rule.

- [ ] **Step 1: Add the incident signature after the existing 502 worked example**

Insert this Markdown:

````markdown
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
````

- [ ] **Step 2: Add credential-safety guidance to the debug toolbox**

Insert this paragraph before the toolbox commands:

```markdown
### Credential safety

Never paste or log complete `Cookie`, `Authorization`, `auth`, JWT, session,
OAuth token, or secret values. Replace them with `<redacted>` and prefer
unauthenticated readiness probes. If a privileged JWT is disclosed, treat it
as compromised. Rotating `JWT_SECRET` invalidates every active session, so it
requires an explicit operational decision rather than an automatic recovery
step.
```

- [ ] **Step 3: Verify the diagnostic runbook and secret hygiene**

Run:

```bash
rtk rg -n "23505|pg_type_typname_nsp_index|mastra_mcp_server_versions|EADDRINUSE|<redacted>|JWT_SECRET|task-queue main" docs/devops/diagnostics.md
rtk rg -n "auth=eyJ|Authorization: Bearer [A-Za-z0-9_-]{20}" docs/PROJECT.md docs/devops/deployment.md docs/devops/diagnostics.md
```

Expected: the first command finds every incident and safety marker; the second
command produces no output.

---

### Task 4: Final documentation verification and commit

**Files:**
- Modify: `docs/PROJECT.md`
- Add: `docs/devops/deployment.md`
- Add: `docs/devops/diagnostics.md`

**Interfaces:**
- Consumes: completed Tasks 1–3.
- Produces: committed, searchable operational guidance ready for future agents.

- [ ] **Step 1: Check Markdown whitespace and exact scope**

Run:

```bash
rtk git diff --check
rtk git status --short
rtk git diff -- docs/PROJECT.md
```

Expected: no whitespace errors; only `docs/PROJECT.md` is tracked-modified, and
the two approved runbooks are untracked additions among the preserved unrelated
user files.

- [ ] **Step 2: Stage only the approved documentation files**

Run:

```bash
rtk git add docs/PROJECT.md docs/devops/deployment.md docs/devops/diagnostics.md
rtk git diff --cached --check
rtk git diff --cached --stat
```

Expected: exactly three documentation files are staged; no token, secret,
unrelated devops file, server script, or root file is staged.

- [ ] **Step 3: Commit the project knowledge**

Run:

```bash
rtk git commit -m "docs: preserve production deploy recovery lessons"
```

Expected: one documentation commit containing the project gate and two
runbooks.

- [ ] **Step 4: Verify repository state after commit**

Run:

```bash
rtk git status --short
rtk git log -3 --oneline
```

Expected: the documentation commit is at HEAD; unrelated pre-existing untracked
files remain untracked and untouched.
