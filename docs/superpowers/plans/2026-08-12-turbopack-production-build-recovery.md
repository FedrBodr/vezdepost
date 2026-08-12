# Turbopack Production Build Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a bounded-memory Next.js production build that works from normal checkouts, CI, and nested git worktrees, then deploy it once under a guarded production procedure.

**Architecture:** Next.js 16 will use its default Turbopack production builder. `apps/frontend/next.config.js` will compute `turbopack.root` from the config module URL, making the root independent of `cwd` and parent lockfiles. A Node test will import the real configuration and assert both the build scripts and root path before the cold build gate runs.

**Tech Stack:** Next.js 16.2.6, Node.js 22.20.0, pnpm 10, Node test runner, Docker Compose, Temporal CLI.

## Global Constraints

- Keep production autodeploy disabled until one guarded deploy has completed successfully.
- Keep `/swapfile` enabled as an operational safety net.
- Do not remove or overwrite unrelated untracked files in the primary checkout.
- Do not skip the cold frontend build, canonical Vitest suite, backend build, or orchestrator build.

---

### Task 1: Make the production builder work in every checkout

**Files:**
- Modify: `apps/frontend/package.json`
- Modify: `apps/frontend/next.config.js`
- Modify: `apps/frontend/package.spec.mjs`

**Interfaces:**
- Consumes: `import.meta.url` from the real Next config module.
- Produces: `nextConfig.turbopack.root: string`, equal to the current monorepo checkout root.

- [ ] **Step 1: Extend the existing package/config test**

Add assertions that `build` and `build:sentry` invoke `next build` without
`--webpack`, and that importing `next.config.js` produces a `turbopack.root`
equal to `path.resolve(frontendDirectory, '../..')`.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `pnpm exec node --test apps/frontend/package.spec.mjs`

Expected: FAIL because the scripts contain `--webpack` and the configuration
does not expose `turbopack.root`.

- [ ] **Step 3: Implement the minimal build configuration**

Change both production scripts to `next build`. In `next.config.js`, derive the
frontend directory with `fileURLToPath(new URL('.', import.meta.url))`, resolve
the monorepo root with `resolve(frontendDirectory, '../..')`, and assign it to
`nextConfig.turbopack.root`.

- [ ] **Step 4: Verify focused GREEN and formatting**

Run:

```bash
pnpm exec node --test apps/frontend/package.spec.mjs
pnpm exec prettier --check apps/frontend/package.json apps/frontend/next.config.js apps/frontend/package.spec.mjs
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/package.json apps/frontend/next.config.js apps/frontend/package.spec.mjs
git commit -m "fix(frontend): bound production build memory"
```

### Task 2: Prove release readiness and deploy once

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: Task 1 production build configuration.
- Produces: a verified production revision marker and healthy application stack.

- [ ] **Step 1: Run a cold frontend build**

Move the ignored `apps/frontend/.next` directory to a unique path under
`/private/tmp`, then run:

```bash
pnpm --use-node-version=22.20.0 run build:frontend
```

Expected: exit 0 with Turbopack named in the Next.js build banner.

- [ ] **Step 2: Run the remaining local gate**

Run:

```bash
pnpm --use-node-version=22.20.0 run test
pnpm --use-node-version=22.20.0 run build:backend
pnpm --use-node-version=22.20.0 run build:orchestrator
git diff --check
```

Expected: every command exits 0 and the canonical test report has zero failures.

- [ ] **Step 3: Merge and push the verified fix**

Fast-forward `prod` to the recovery branch and push `prod`. Do not restore the
cron yet.

- [ ] **Step 4: Run exactly one guarded production deploy**

On the VPS, run `/root/postiz-app/deploy/autodeploy.sh` manually while monitoring
RAM, swap, and `/var/log/vezdepost-autodeploy.log`. Do not start a second deploy.

- [ ] **Step 5: Verify the production gate**

Confirm the successful marker equals the pushed SHA, the Postiz container was
recreated, ports 3000/4200/5000 listen, the Temporal `main` task queue has
pollers, landing returns 200, and unauthenticated `/api/user/self` returns 401.

- [ ] **Step 6: Restore autodeploy and finish streak rollout**

Restore `/root/vezdepost-autodeploy.cron.disabled` to
`/etc/cron.d/vezdepost-autodeploy`, then run the published-at backfill. Run the
legacy-workflow retirement script without `APPLY=1`, inspect its exact workflow
and run IDs, and only then rerun it with `APPLY=1`.
