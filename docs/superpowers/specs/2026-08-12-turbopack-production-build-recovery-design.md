# Turbopack production build recovery

## Problem

The 11 August release forced the Next.js production build from Turbopack to
Webpack. On the 8 GiB production VPS, Webpack used about 5 GiB RSS while the
running application stack used the remaining memory. With no swap, the kernel
killed the build. The pull-based deploy retried every three minutes because the
successful revision marker correctly remained unchanged.

The earlier Turbopack build had stalled because Next.js inferred the repository
root from a parent checkout when the build ran in a nested git worktree.

## Approved design

- Restore `next build` as the normal and Sentry production build command, so
  Next.js 16 uses Turbopack.
- Set `turbopack.root` explicitly in `apps/frontend/next.config.js`, deriving the
  monorepo root from that config file rather than the process working directory.
  This must resolve to the current checkout in normal, CI, and linked-worktree
  builds.
- Add a regression test that imports the real Next configuration and verifies
  both the build scripts and the resolved Turbopack root.
- Verify with a cold frontend production build, the canonical Vitest suite, and
  backend/orchestrator production builds before any production deployment.

## Production rollout

Autodeploy remains disabled during implementation and verification. The 4 GiB
swap file remains enabled as an operational safety net. After the fix is pushed,
run exactly one guarded deploy manually, verify the successful revision marker,
container recreation, ports 3000/4200/5000, Temporal pollers, and public HTTP
probes. Only then restore the autodeploy cron.

The streak data backfill and retirement of legacy reminder workflows happen
after the new application revision is confirmed live.
