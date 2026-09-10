# VK Saved Photo Owner Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow VK Group photo posts when `photos.saveWallPhoto` returns the positive OAuth-user owner ID, while preserving strict ID validation, community wall targeting, readback identity proof, and safe cleanup.

**Architecture:** Treat `group_id`/`wall.post.owner_id` as the destination community and the saved photo `owner_id` as an independent attachment identity supplied by VK. The provider forwards the exact validated saved-photo pair into `wall.post`; the capability runner proves that same pair on readback before deleting or reporting `GO`.

**Tech Stack:** TypeScript, JavaScript, Vitest, VK API v5.251, pnpm with Node 22.20.0.

## Global Constraints

- Work only in the isolated `fix/vk-group-user-oauth` worktree; preserve the primary checkout's unrelated files.
- Use `pnpm --use-node-version=22.20.0`; never npm or yarn.
- Follow RED/GREEN: the positive-owner regression tests must fail for the expected owner-mismatch reason before production code changes.
- `wall.post.owner_id` remains the selected signed community ID and `from_group` remains `1`.
- Attachment identifiers use the exact validated `owner_id` and `id` returned by `photos.saveWallPhoto`, in original media order.
- A saved photo `owner_id` may be a positive user ID or a negative community ID, but must remain a well-formed, non-zero signed ID; the photo ID must remain positive.
- The capability runner may delete only the exact saved-photo pair after marked-post readback proves the same attachment identity; ambiguous identity or cleanup remains `PENDING_CLEANUP`, never `GO`.
- VK Group supports text plus zero to ten photographs; video, other attachments, and comment media remain forbidden.
- Never print or commit tokens, personal data, media URLs, upload URLs, post text, or raw VK responses.
- Do not push, deploy, or mutate production as part of this task.

---

### Task 1: Accept and Prove the Saved Photo Owner

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts`
- Modify: `apps/orchestrator/src/activities/post.activity.spec.ts`
- Modify: `scripts/vk-group-photo-capability-check.spec.mjs`
- Modify: `scripts/vk-group-photo-capability-check.mjs`

**Interfaces:**
- The provider's `uploadPhoto` continues to return `{ ownerId: string; id: string }`, but no longer requires `ownerId === -groupId`.
- `wall.post` continues to target `-<groupId>` and builds attachments from the exact saved-photo pair.
- The capability runner carries the exact saved-photo pair through publish, readback verification, `photos.delete`, and `photos.getById` absence verification.

- [ ] **Step 1: Write provider and worker RED regressions**

Replace the obsolete test that rejects a different valid owner with a test where `photos.saveWallPhoto` returns a positive owner such as `456`. Assert that the provider succeeds, calls `wall.post` with community `owner_id=-123`, `from_group=1`, and attachment `photo456_789`. Add or update the orchestrator-shaped test so a stored image follows `PostsService.updateMedia -> PostActivity.postSocial -> VkGroupProvider` and reaches `wall.post` with the same positive-owner attachment. Retain malformed/zero owner rejection tests.

- [ ] **Step 2: Write capability-runner RED regression**

Add a test fixture where `photos.saveWallPhoto` returns positive `owner_id=456`. The marked post readback must contain attachment `photo456_<photoId>`. Assert the runner reaches exact `GO`, sends `wall.post.owner_id=-123`, deletes with `photos.delete(owner_id=456, photo_id=<photoId>)`, and verifies absence with `photos.getById(photos=456_<photoId>)`. Retain the existing negative-owner path and ambiguous readback tests.

- [ ] **Step 3: Run RED tests and record the expected failures**

Run:

```bash
pnpm --use-node-version=22.20.0 exec vitest run \
  libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts \
  apps/orchestrator/src/activities/post.activity.spec.ts \
  scripts/vk-group-photo-capability-check.spec.mjs
```

Expected: the new positive-owner provider/worker test fails with `VK photos.saveWallPhoto returned an unexpected owner ID`; the runner test stops at `save-photo` instead of reaching publish/readback/cleanup.

- [ ] **Step 4: Implement the minimal provider fix**

In `uploadPhoto`, retain `parseSignedId` and `parsePositiveId`, but remove only the equality check between saved photo owner and `-<groupId>`. Return the exact parsed `ownerId` and photo ID. Do not change upload parameters, wall destination, authorship, error mapping, ordering, or other media behavior.

- [ ] **Step 5: Implement the matching capability-runner fix**

After `photos.saveWallPhoto`, require exactly one item plus a valid non-zero signed owner and positive photo ID, without comparing the owner to `-groupId`. Continue using the resulting pair for attachment construction, exact marked-post readback, `photos.delete`, and `photos.getById`. Do not weaken wall owner/author/marker checks or cleanup gating.

- [ ] **Step 6: Run GREEN and acceptance-boundary tests**

Run the Step 3 command, then verify the requested boundaries with the focused provider, worker, posts-service, and capability suites:

```bash
pnpm --use-node-version=22.20.0 exec vitest run \
  libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts \
  libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts \
  apps/orchestrator/src/activities/post.activity.spec.ts \
  scripts/vk-group-photo-capability-check.spec.mjs
```

The named tests/evidence must cover text-only, one photo with a positive saved owner, multiple photos including ten in order, malformed saved owners, more than ten photos, and video rejection before a VK call.

- [ ] **Step 7: Verify formatting, workspace, and diff hygiene**

Run:

```bash
pnpm --use-node-version=22.20.0 exec prettier --check \
  libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts \
  libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts \
  apps/orchestrator/src/activities/post.activity.spec.ts \
  scripts/vk-group-photo-capability-check.mjs \
  scripts/vk-group-photo-capability-check.spec.mjs
pnpm --use-node-version=22.20.0 run verify:workspace
git diff --check
```

Expected: all commands exit 0 with no credential-bearing output.

- [ ] **Step 8: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts \
  libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts \
  apps/orchestrator/src/activities/post.activity.spec.ts \
  scripts/vk-group-photo-capability-check.mjs \
  scripts/vk-group-photo-capability-check.spec.mjs
git commit -m "fix: accept VK user-owned wall photos"
```

Stop with the branch local and reviewable. Do not push or deploy.
