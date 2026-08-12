# VK Group User OAuth Photo Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace VK Group community-key onboarding with independent VK user OAuth and publish text plus up to ten photographs from a server-verified managed community.

**Architecture:** Extract the already-working VK ID PKCE/token mechanics into a shared helper used by personal VK and VK Group. Make VK Group a two-step provider: authenticate the administrator, list managed communities, verify the chosen community plus photo-upload capability, then retain the user token while persisting the signed community owner ID. Keep the existing photo pipeline and add explicit legacy-token reconnect behavior and a real user-token capability gate.

**Tech Stack:** TypeScript, NestJS, Next.js/React, Prisma, Temporal, Vitest, VK ID OAuth 2.1/PKCE, VK API v5.251, pnpm with Node 22.20.0.

## Global Constraints

- Work only in the isolated `fix/vk-group-user-oauth` worktree; preserve the primary checkout's unrelated untracked files.
- Use `pnpm --use-node-version=22.20.0`; never npm or yarn.
- Follow red-green-refactor for every production behavior change and commit each task independently.
- Personal `VkProvider` behavior, callback, scopes, persistence, and publishing must remain unchanged.
- VK Group supports text plus zero to ten photographs; video, other attachments, and comment media remain forbidden.
- Never log or commit access tokens, refresh tokens, upload URLs, media URLs, post text, personal data, or the original user screenshots.
- Do not push, merge to `prod`, or deploy production without a separate explicit approval after review and a real capability result of exactly `GO`.

---

## File Map

- `libraries/nestjs-libraries/src/integrations/social/vk.oauth.ts`: shared VK ID redirect, PKCE, code exchange, user-info, and refresh primitives.
- `libraries/nestjs-libraries/src/integrations/social/vk.oauth.spec.ts`: contract tests for shared OAuth primitives and secret-safe failures.
- `libraries/nestjs-libraries/src/integrations/social/vk.provider.ts`: personal VK delegates OAuth mechanics to the shared module without changing public behavior.
- `libraries/nestjs-libraries/src/integrations/social/vk.provider.spec.ts`: personal VK regression coverage.
- `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts`: OAuth, managed-community selection, capability preflight, refresh, legacy error mapping, and existing publisher.
- `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts`: VK Group OAuth, selection, refresh, and publishing tests.
- `libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts`: safely finalize a selected group without uniqueness collisions.
- `libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.spec.ts`: duplicate/reconnect and metadata-preservation tests.
- `apps/frontend/src/components/new-launch/providers/continue-provider/vk-group/vk-group.continue.tsx`: explicit VK community selector.
- `apps/frontend/src/components/new-launch/providers/continue-provider/list.tsx`: register the selector.
- `apps/frontend/src/components/launches/continue.integration.tsx`: parse VK ID device-bound callback parameters for both VK providers.
- `apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx`: OAuth onboarding and removal of manual-key assertions.
- `apps/frontend/src/components/launches/continue.integration.analytics.spec.tsx`: two-step callback regression.
- `apps/frontend/src/locales/en/translation.json`, `apps/frontend/src/locales/ru/translation.json`: user-facing OAuth, empty-state, and reconnect copy.
- `scripts/vk-group-photo-capability-check.mjs`: real capability check based on a user OAuth token.
- `scripts/vk-group-photo-capability-check.spec.mjs`: no-write, ownership, verification, and cleanup tests.
- `docs/devops/vk-group-photo-capability-check.md`: exact operator procedure and `GO` contract.

---

### Task 1: Shared VK ID OAuth Without Personal VK Regression

**Files:**
- Create: `libraries/nestjs-libraries/src/integrations/social/vk.oauth.ts`
- Create: `libraries/nestjs-libraries/src/integrations/social/vk.oauth.spec.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.provider.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.provider.spec.ts`

**Interfaces:**
- Produces `buildVkRedirectUri(identifier: 'vk' | 'vk-group'): string`.
- Produces `generateVkAuthUrl(input: { identifier; scopes }): GenerateAuthUrlResponse`.
- Produces `authenticateVkUser(input: { identifier; code; codeVerifier; fetcher }): Promise<VkUserOAuthResult>`.
- Produces `refreshVkUser(input: { refresh; scopes; fetcher }): Promise<VkUserOAuthResult>`.
- `VkUserOAuthResult` contains `userId`, display metadata, access token, device-bound refresh token, and positive `expiresIn` seconds.

- [ ] **Step 1: Write failing helper and personal-provider contract tests**

Add focused tests that assert distinct redirect URIs, S256 challenge generation, device ID propagation, strict token/user payload parsing, refresh scope propagation, and errors that omit raw token values. Extend personal VK tests to snapshot its existing scope array and returned `AuthTokenDetails` shape.

```ts
expect(buildVkRedirectUri('vk')).toBe(
  'https://app.example.test/integrations/social/vk'
);
expect(buildVkRedirectUri('vk-group')).toBe(
  'https://app.example.test/integrations/social/vk-group'
);
expect(new VkProvider().scopes).toEqual([
  'vkid.personal_info', 'email', 'wall', 'status', 'docs', 'photos', 'video'
]);
```

- [ ] **Step 2: Run RED tests**

Run:

```bash
pnpm --use-node-version=22.20.0 exec vitest run \
  libraries/nestjs-libraries/src/integrations/social/vk.oauth.spec.ts \
  libraries/nestjs-libraries/src/integrations/social/vk.provider.spec.ts
```

Expected: FAIL because `vk.oauth.ts` and its exports do not exist.

- [ ] **Step 3: Implement the shared OAuth unit and delegate personal VK**

Use injected `fetcher` calls and return a provider-neutral result:

```ts
export type VkUserOAuthResult = {
  userId: string;
  name: string;
  username: string;
  picture: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};
```

Keep VK parsing fail-closed, retain the `secret&&&&deviceId` format, and make `VkProvider.generateAuthUrl`, `authenticate`, and `refreshToken` thin adapters. Do not change personal VK scopes or publishing code.

- [ ] **Step 4: Run GREEN tests and formatting**

Run the Step 2 command, then:

```bash
pnpm --use-node-version=22.20.0 exec prettier --check \
  libraries/nestjs-libraries/src/integrations/social/vk.oauth.ts \
  libraries/nestjs-libraries/src/integrations/social/vk.oauth.spec.ts \
  libraries/nestjs-libraries/src/integrations/social/vk.provider.ts \
  libraries/nestjs-libraries/src/integrations/social/vk.provider.spec.ts
```

Expected: all focused tests pass and Prettier reports all files formatted.

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/social/vk.oauth.ts \
  libraries/nestjs-libraries/src/integrations/social/vk.oauth.spec.ts \
  libraries/nestjs-libraries/src/integrations/social/vk.provider.ts \
  libraries/nestjs-libraries/src/integrations/social/vk.provider.spec.ts
git commit -m "refactor: share VK user OAuth flow"
```

---

### Task 2: VK Group OAuth and Managed-Community Selection

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts`

**Interfaces:**
- Consumes the Task 1 OAuth functions.
- Produces `pages(accessToken: string): Promise<VkManagedCommunity[]>`.
- Produces `fetchPageInformation(accessToken: string, data: { page: string }): Promise<FetchPageInformationResult>`.
- `VkManagedCommunity` is `{ id: string; page: string; username: string; name: string; picture: string }`.

- [ ] **Step 1: Write failing OAuth, listing, selection, and preflight tests**

Assert `isBetweenSteps=true`, no `customFields`, scopes
`['vkid.personal_info', 'wall', 'photos', 'groups']`, callback
`/integrations/social/vk-group`, and a temporary auth ID
`vk-group-oauth:<userId>`. Mock `groups.get` to return admin communities and
assert mapping to `VkManagedCommunity`. For selection, submit an allowed ID and
assert a second `groups.get filter=admin`, followed by
`photos.getWallUploadServer(group_id=<id>)`; forged IDs and non-HTTPS upload
URLs must reject.

```ts
await expect(provider.fetchPageInformation(token, { page: '999' }))
  .rejects.toThrow('The selected VK community is not managed by this account.');
expect(fetchCalls.map(({ method }) => method)).toEqual([
  'groups.get', 'photos.getWallUploadServer'
]);
```

- [ ] **Step 2: Run RED tests**

```bash
pnpm --use-node-version=22.20.0 exec vitest run \
  libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts
```

Expected: FAIL because VK Group still exposes custom fields and has no OAuth
page-selection contract.

- [ ] **Step 3: Implement OAuth, `pages`, and verified selection**

Delegate auth/refresh to Task 1. `authenticate` maps `userId` to the temporary
namespaced ID. `pages` calls VK API v5.251 with:

```ts
{ filter: 'admin', extended: '1', fields: 'photo_200,screen_name' }
```

`fetchPageInformation` re-fetches the list, requires an exact positive ID,
calls the photo upload-server preflight, validates HTTPS, and returns:

```ts
{
  id: `-${group.id}`,
  name: group.name,
  access_token: accessToken,
  picture: group.photo_200 ?? '',
  username: group.screen_name ?? ''
}
```

Remove manual `customFields` and community-key instructions from new onboarding.

- [ ] **Step 4: Map legacy community-token photo failure**

Add one stable provider error constant for photo-method error 27:

```ts
const LEGACY_GROUP_TOKEN_RECONNECT =
  'Reconnect VK Group through VK authorization to publish photographs.';
```

Keep error 5 refresh behavior and error 15 missing-access behavior. Verify no
token, upload URL, raw body, media URL, or post text appears in thrown errors.

- [ ] **Step 5: Run GREEN tests and formatting**

Run the Step 2 command plus Prettier for the two files. Expected: all VK Group
provider tests pass.

- [ ] **Step 6: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts \
  libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts
git commit -m "feat: connect VK Groups with user OAuth"
```

---

### Task 3: Safe Finalization, Duplicate Reconnect, and Refresh Invariants

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts`
- Create: `libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.spec.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts`

**Interfaces:**
- Consumes `fetchPageInformation` from Task 2.
- Produces a finalized integration with signed group `internalId`, preserved
  user OAuth credentials, and `inBetweenSteps=false`.

- [ ] **Step 1: Write failing persistence and refresh tests**

Cover these cases independently:

```ts
it('finalizes a temporary VK Group integration without changing its tokens');
it('reconnects the existing signed group instead of violating uniqueness');
it('does not collide with a personal VK integration for the same user');
it('refreshes credentials without replacing the selected group id or metadata');
```

Use repository fakes and assert exact update/delete/reconnect calls; never put
real credentials in fixtures.

- [ ] **Step 2: Run RED tests**

```bash
pnpm --use-node-version=22.20.0 exec vitest run \
  libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.spec.ts \
  libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts
```

Expected: FAIL on duplicate-group finalization or refresh metadata assertions.

- [ ] **Step 3: Implement minimal service/repository-safe finalization**

Before changing the temporary integration to `-<groupId>`, resolve an existing
same-organization integration with that internal ID. Reuse the repository's
deleted-channel recovery semantics; update the existing record's credentials
and verified metadata, and retire the temporary record through an existing
recoverable repository operation. Do not issue raw SQL or destructive deletes.

Ensure generic token refresh continues to call
`createOrUpdateIntegration(..., integration.internalId, ...)`, so the signed
group ID remains stable; provider refresh results must not be used as the
persistence key.

- [ ] **Step 4: Run GREEN tests and formatting**

Run the Step 2 command and Prettier for changed files. Expected: all focused
integration and provider tests pass.

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts \
  libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.spec.ts \
  libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts
git commit -m "fix: preserve VK Group identity through OAuth reconnect"
```

---

### Task 4: VK Group OAuth and Community-Selection UI

**Files:**
- Create: `apps/frontend/src/components/new-launch/providers/continue-provider/vk-group/vk-group.continue.tsx`
- Create: `apps/frontend/src/components/new-launch/providers/continue-provider/vk-group/vk-group.continue.spec.tsx`
- Modify: `apps/frontend/src/components/new-launch/providers/continue-provider/list.tsx`
- Modify: `apps/frontend/src/components/launches/continue.integration.tsx`
- Modify: `apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx`
- Modify: `apps/frontend/src/components/launches/continue.integration.analytics.spec.tsx`
- Modify: `apps/frontend/src/locales/en/translation.json`
- Modify: `apps/frontend/src/locales/ru/translation.json`

**Interfaces:**
- Consumes Task 2 page items and submits `{ page: selected.id }`.
- Registers `continueProviderList['vk-group']`.

- [ ] **Step 1: Write failing frontend tests**

Assert that clicking VK Group no longer opens custom fields, the callback joins
`code&&&&device_id` for both `vk` and `vk-group`, the two-step map contains
`vk-group`, the selector submits `{page: id}`, and empty state/copy is present
in both locales. Assert source and rendered UI contain no community-key input.

- [ ] **Step 2: Run RED tests**

```bash
pnpm --use-node-version=22.20.0 exec vitest run \
  apps/frontend/src/components/new-launch/providers/continue-provider/vk-group/vk-group.continue.spec.tsx \
  apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx \
  apps/frontend/src/components/launches/continue.integration.analytics.spec.tsx
```

Expected: FAIL because the VK Group selector is not registered and callback
normalization only handles `vk`.

- [ ] **Step 3: Implement explicit selector and callback normalization**

Create a `withContinueProvider` configuration using page item fields
`id/name/picture/username`, endpoint `pages`, and:

```ts
transformSaveData: (selection) => ({ page: selection })
```

Register it under `'vk-group'`. Change callback normalization to
`provider === 'vk' || provider === 'vk-group'`. Add RU/EN strings explaining
VK authorization, administrator selection, community authorship, ten-photo
limit, video prohibition, no-managed-community state, and legacy reconnect.

- [ ] **Step 4: Run GREEN tests, frontend typecheck, and formatting**

Run the Step 2 command, then:

```bash
pnpm --use-node-version=22.20.0 run verify:workspace
pnpm --use-node-version=22.20.0 exec prettier --check \
  apps/frontend/src/components/new-launch/providers/continue-provider/vk-group/vk-group.continue.tsx \
  apps/frontend/src/components/new-launch/providers/continue-provider/vk-group/vk-group.continue.spec.tsx \
  apps/frontend/src/components/new-launch/providers/continue-provider/list.tsx \
  apps/frontend/src/components/launches/continue.integration.tsx \
  apps/frontend/src/locales/en/translation.json \
  apps/frontend/src/locales/ru/translation.json
```

Expected: focused tests and workspace verification pass.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/new-launch/providers/continue-provider \
  apps/frontend/src/components/launches/continue.integration.tsx \
  apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx \
  apps/frontend/src/components/launches/continue.integration.analytics.spec.tsx \
  apps/frontend/src/locales/en/translation.json \
  apps/frontend/src/locales/ru/translation.json
git commit -m "feat: add VK Group OAuth community picker"
```

---

### Task 5: Worker and Publisher Regression Gate

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts`
- Modify: `apps/orchestrator/src/activities/post.activity.spec.ts`
- Modify if required by a failing test: `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts`
- Modify if required by a failing test: `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts`

**Interfaces:**
- Preserves the existing provider `post(userId, accessToken, postDetails)` contract.

- [ ] **Step 1: Add end-to-end-shaped failing regression tests**

Build stored post media, pass it through `PostsService.updateMedia`, then through
`PostActivity.postSocial`, and assert the user OAuth token reaches this exact VK
sequence:

```text
photos.getWallUploadServer -> multipart upload -> photos.saveWallPhoto -> wall.post
```

Assert signed owner ID, `from_group=1`, ordered attachments, direct wall URL,
and zero `wall.post` calls for invalid type, comment media, >10 images, upload
failure, save failure, or saved-photo owner mismatch.

- [ ] **Step 2: Run RED or regression tests**

```bash
pnpm --use-node-version=22.20.0 exec vitest run \
  apps/orchestrator/src/activities/post.activity.spec.ts \
  libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts
```

Expected: new user-token execution-path assertions fail if any persistence or
provider invariant is missing; otherwise record that they pass as regression
coverage and make no unnecessary production edit.

- [ ] **Step 3: Implement only behavior proven missing by RED**

Keep the existing atomic publication boundary. Do not refactor personal VK or
add new media types. Add the smallest validation/ownership fix required by the
failing assertion.

- [ ] **Step 4: Run GREEN tests and commit**

Run the Step 2 command and Prettier for changed files. Commit only if there are
material changes:

```bash
git add apps/orchestrator/src/activities/post.activity.spec.ts \
  libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts \
  libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts \
  libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts
git commit -m "test: cover VK Group OAuth worker publishing"
```

---

### Task 6: User-OAuth Capability Runner and Runbook

**Files:**
- Modify: `scripts/vk-group-photo-capability-check.mjs`
- Modify: `scripts/vk-group-photo-capability-check.spec.mjs`
- Modify: `docs/devops/vk-group-photo-capability-check.md`

**Interfaces:**
- Reads `VK_GROUP_CAPABILITY_USER_TOKEN` and explicit authorization flag
  `VK_GROUP_CAPABILITY_AUTHORIZED=1`.
- Emits only safe JSON events and final status `GO`, `NO_GO`,
  `PENDING_CLEANUP`, or `PENDING_LOCAL_CLEANUP`.

- [ ] **Step 1: Write failing runner tests**

Replace community-permission assumptions with user-token checks. Require
`groups.get filter=admin` target membership before upload-server access. Cover
unmanaged target, API error 27, non-HTTPS upload URL, marker/owner/from/attachment
mismatch, ambiguous post IDs, cleanup failure, absence verification, signal
cleanup, and secret/output redaction.

- [ ] **Step 2: Run RED tests**

```bash
pnpm --use-node-version=22.20.0 exec vitest run \
  scripts/vk-group-photo-capability-check.spec.mjs
```

Expected: FAIL because the runner still expects a community token and
`groups.getTokenPermissions`.

- [ ] **Step 3: Implement user-token gate**

The preflight order is:

```text
groups.get(filter=admin,extended=1) -> exact target membership
photos.getWallUploadServer(group_id) -> validated HTTPS URL
```

The mutating phase retains UUID marker ownership proof, exact saved-photo and
wall-post verification, proven-owned cleanup only, absence verification, safe
temp permissions, and fail-closed final status.

- [ ] **Step 4: Update operator documentation**

Document how to obtain a disposable/approved user OAuth token without printing
it, required admin access, exact environment variable names, safe test image,
expected JSON events, cleanup procedure, and that conversational approval is
not a capability result.

- [ ] **Step 5: Run GREEN tests, hygiene tests, and formatting**

```bash
pnpm --use-node-version=22.20.0 exec vitest run \
  scripts/vk-group-photo-capability-check.spec.mjs \
  scripts/vk-group-photo-release-hygiene.spec.mjs
pnpm --use-node-version=22.20.0 exec prettier --check \
  scripts/vk-group-photo-capability-check.mjs \
  scripts/vk-group-photo-capability-check.spec.mjs \
  docs/devops/vk-group-photo-capability-check.md
```

Expected: all runner/hygiene tests pass and output contains no credential.

- [ ] **Step 6: Commit**

```bash
git add scripts/vk-group-photo-capability-check.mjs \
  scripts/vk-group-photo-capability-check.spec.mjs \
  docs/devops/vk-group-photo-capability-check.md
git commit -m "fix: gate VK Group photos with user OAuth"
```

---

### Task 7: Full Verification and Release Evidence

**Files:**
- Modify: `docs/superpowers/plans/2026-08-12-vk-group-user-oauth-photo-publishing.md` only to check completed boxes and record evidence.

**Interfaces:**
- Produces a reviewable branch and a capability result; does not merge, push, or deploy.

- [ ] **Step 1: Run focused suites**

```bash
pnpm --use-node-version=22.20.0 exec vitest run \
  libraries/nestjs-libraries/src/integrations/social/vk.oauth.spec.ts \
  libraries/nestjs-libraries/src/integrations/social/vk.provider.spec.ts \
  libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts \
  libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.spec.ts \
  apps/orchestrator/src/activities/post.activity.spec.ts \
  apps/frontend/src/components/new-launch/providers/continue-provider/vk-group/vk-group.continue.spec.tsx \
  apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx \
  apps/frontend/src/components/launches/continue.integration.analytics.spec.tsx \
  scripts/vk-group-photo-capability-check.spec.mjs \
  scripts/vk-group-photo-release-hygiene.spec.mjs
```

Expected: all focused tests pass with zero failures.

- [ ] **Step 2: Run repository verification and production builds**

```bash
pnpm --use-node-version=22.20.0 run verify:workspace
pnpm --use-node-version=22.20.0 run test
pnpm --use-node-version=22.20.0 run build:frontend
pnpm --use-node-version=22.20.0 run build:backend
pnpm --use-node-version=22.20.0 run build:orchestrator
git diff --check prod...HEAD
```

Expected: all commands exit 0.

- [ ] **Step 3: Run history-aware release hygiene**

Run the documented hygiene command against `prod...HEAD`. Expected final safe
JSON status: `GO`, with no sensitive blobs, unexpected binaries, tracked temp
files, or scope violations.

- [ ] **Step 4: Run the real VK capability gate**

Use an approved target community, repository-owned test image, and a user OAuth
token with admin access. Expected final machine-readable status: exactly `GO`,
including verified post cleanup and absence. Do not expose the token in shell
history, process arguments, logs, plan evidence, or chat.

- [ ] **Step 5: Request final code review**

Review the complete `prod...HEAD` diff against the approved spec. Resolve every
Critical and Important finding with a new RED/GREEN cycle; rerun affected tests.

- [ ] **Step 6: Commit verification evidence**

```bash
git add docs/superpowers/plans/2026-08-12-vk-group-user-oauth-photo-publishing.md
git commit -m "docs: record VK Group OAuth verification"
```

Stop with the branch ready for user-approved merge/push/deploy. Do not perform
those operations in this task.
