# VK Publishing Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make personal VK publishing refresh expired tokens, reject malformed VK success payloads, and never mark a post published without a real VK post ID.

**Architecture:** Add a small VK-specific JSON response boundary that maps VK error code 5 to the existing `RefreshToken` failure and every other VK error or malformed response to `BadBody`. Route personal VK API calls through that boundary and opt the provider into the existing refresh workflow; the existing Temporal post workflow will then refresh and retry without structural changes.

**Tech Stack:** TypeScript, NestJS, Temporal, Vitest, VK API, Prisma.

## Global Constraints

- A VK post is successful only after VK returns a non-empty `post_id`.
- VK error code `5` must enter the existing refresh-token flow.
- Credentials must never appear in errors, notifications, persisted diagnostics, or test snapshots.
- Historical posts must not be retried or republished.
- Use PNPM only and run lint/build commands from the repository root.

---

### Task 1: VK JSON response boundary

**Files:**
- Create: `libraries/nestjs-libraries/src/integrations/social/vk.response.ts`
- Create: `libraries/nestjs-libraries/src/integrations/social/vk.response.spec.ts`

**Interfaces:**
- Consumes: `RefreshToken` and `BadBody` from `social.abstract.ts`.
- Produces: `unwrapVkResponse<T>(payload: unknown, method: string): T`.

- [ ] **Step 1: Write failing response-boundary tests**

```ts
import { describe, expect, it } from 'vitest';
import { BadBody, RefreshToken } from './social.abstract';
import { unwrapVkResponse } from './vk.response';

describe('unwrapVkResponse', () => {
  it('returns a valid VK response', () => {
    expect(unwrapVkResponse({ response: { post_id: 42 } }, 'wall.post')).toEqual({ post_id: 42 });
  });

  it('maps VK error 5 to refresh-token without exposing credentials', () => {
    const token = 'vk-secret-token';
    expect(() => unwrapVkResponse({ error: { error_code: 5, error_msg: `expired ${token}` } }, 'wall.post'))
      .toThrow(RefreshToken);
    try {
      unwrapVkResponse({ error: { error_code: 5, error_msg: `expired ${token}` } }, 'wall.post');
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(token);
    }
  });

  it('maps another VK error to a sanitized bad-body failure', () => {
    expect(() => unwrapVkResponse({ error: { error_code: 100, error_msg: 'bad parameter' } }, 'photos.saveWallPhoto'))
      .toThrow(BadBody);
  });

  it('rejects a payload without response or error', () => {
    expect(() => unwrapVkResponse({}, 'wall.post')).toThrow(BadBody);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/vk.response.spec.ts`

Expected: FAIL because `vk.response.ts` does not exist.

- [ ] **Step 3: Implement the minimal response boundary**

```ts
import { BadBody, RefreshToken } from './social.abstract';

type VkEnvelope<T> = {
  response?: T;
  error?: { error_code?: number; error_msg?: string };
};

export function unwrapVkResponse<T>(payload: unknown, method: string): T {
  const envelope = (payload || {}) as VkEnvelope<T>;
  if (envelope.error) {
    const code = Number(envelope.error.error_code || 0);
    const message = `VK ${method} failed with error ${code}`;
    if (code === 5) {
      throw new RefreshToken('vk', JSON.stringify({ code }), {} as BodyInit, message);
    }
    throw new BadBody('vk', JSON.stringify({ code }), {} as BodyInit, message);
  }
  if (envelope.response === undefined || envelope.response === null) {
    throw new BadBody('vk', '{}', {} as BodyInit, `VK ${method} returned no response`);
  }
  return envelope.response;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/vk.response.spec.ts`

Expected: 4 tests PASS and no token appears in output.

- [ ] **Step 5: Commit the response boundary**

```bash
rtk git add libraries/nestjs-libraries/src/integrations/social/vk.response.ts libraries/nestjs-libraries/src/integrations/social/vk.response.spec.ts
rtk git commit -m "fix(vk): classify API response errors"
```

### Task 2: Verified media upload and wall posting

**Files:**
- Create: `libraries/nestjs-libraries/src/integrations/social/vk.provider.spec.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.provider.ts:37-309`

**Interfaces:**
- Consumes: `unwrapVkResponse<T>()` from Task 1.
- Produces: `VkProvider.post()` and `VkProvider.comment()` that return only verified IDs and URLs.

- [ ] **Step 1: Write failing provider tests**

Use a `TestVkProvider extends VkProvider` exposing `uploadMedia`, spy on
`provider.fetch`, and stub `axios.get`/`axios.post`. Cover these exact cases:

```ts
it('throws RefreshToken when a media API returns VK error 5', async () => {
  vi.spyOn(provider, 'fetch').mockResolvedValue(response({ error: { error_code: 5, error_msg: 'expired' } }));
  await expect(provider.upload('1', 'secret', imagePost)).rejects.toBeInstanceOf(RefreshToken);
});

it('rejects a wall.post response without post_id', async () => {
  vi.spyOn(provider, 'fetch').mockResolvedValue(response({ response: {} }));
  await expect(provider.post('1', 'secret', [textPost])).rejects.toBeInstanceOf(BadBody);
});

it('returns a concrete release URL for a verified post_id', async () => {
  vi.spyOn(provider, 'fetch').mockResolvedValue(response({ response: { post_id: 77 } }));
  await expect(provider.post('1', 'secret', [textPost])).resolves.toMatchObject([
    { postId: '77', releaseURL: 'https://vk.com/feed?w=wall1_77', status: 'completed' },
  ]);
});
```

Add cases for absent `upload_url`, absent saved-photo ID, and non-code-5 VK
errors. Assertions must verify that neither access token nor media URL appears
in serialized failures.

- [ ] **Step 2: Run the provider test and verify RED**

Run: `rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/vk.provider.spec.ts`

Expected: FAIL because current code dereferences `all.response.upload_url` and accepts an absent `post_id`.

- [ ] **Step 3: Route every decoded personal VK response through the boundary**

Change authentication, refresh, `photos.getWallUploadServer`, `video.save`,
`photos.saveWallPhoto`, `wall.post`, and `wall.createComment` to decode once
and call `unwrapVkResponse`. Validate method-specific required fields before
using them:

```ts
const upload = unwrapVkResponse<{ upload_url?: string }>(payload, 'photos.getWallUploadServer');
if (!upload.upload_url) {
  throw new BadBody('vk', '{}', {} as BodyInit, 'VK photos.getWallUploadServer returned no upload URL');
}

const wallPost = unwrapVkResponse<{ post_id?: number }>(payload, 'wall.post');
if (wallPost.post_id === undefined || wallPost.post_id === null) {
  throw new BadBody('vk', '{}', {} as BodyInit, 'VK wall.post returned no post ID');
}
```

Do not include `accessToken`, refresh tokens, request URLs containing tokens,
or remote media URLs in failure details.

- [ ] **Step 4: Run the provider tests and verify GREEN**

Run: `rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/vk.response.spec.ts libraries/nestjs-libraries/src/integrations/social/vk.provider.spec.ts`

Expected: all VK response and provider tests PASS.

- [ ] **Step 5: Run the existing VK group regression suite**

Run: `rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts`

Expected: all tests PASS; community-token behavior is unchanged.

- [ ] **Step 6: Commit verified VK publishing**

```bash
rtk git add libraries/nestjs-libraries/src/integrations/social/vk.provider.ts libraries/nestjs-libraries/src/integrations/social/vk.provider.spec.ts
rtk git commit -m "fix(vk): require verified publish responses"
```

### Task 3: Proactive and reactive refresh regression coverage

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.provider.ts:16-30`
- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.provider.spec.ts`
- Create: `apps/orchestrator/src/workflows/post-workflows/vk-refresh.spec.ts`

**Interfaces:**
- Consumes: `VkProvider.refreshToken()` and Temporal `refresh_token` failures.
- Produces: `VkProvider.refreshCron = true` plus proof that the workflow refresh branch retries the post.

- [ ] **Step 1: Add failing provider metadata test**

```ts
it('opts into proactive token refresh', () => {
  expect(new VkProvider().refreshCron).toBe(true);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/vk.provider.spec.ts`

Expected: FAIL because `refreshCron` is undefined.

- [ ] **Step 3: Enable the existing refresh workflow**

Add exactly:

```ts
refreshCron = true;
```

to `VkProvider` next to `maxConcurrentJob`.

- [ ] **Step 4: Add a workflow-level refresh test**

Use Temporal workflow test mocks matching the existing workflow activity
names. First `postSocial` throws an `ActivityFailure` whose cause is an
`ApplicationFailure` of type `refresh_token`; `refreshTokenWithCause` returns
`{ accessToken: 'new-token' }`; the second `postSocial` returns a real post ID.
Assert two post attempts, one refresh, and one `updatePost` call with the real
ID and URL.

- [ ] **Step 5: Run refresh tests and verify GREEN**

Run: `rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/vk.provider.spec.ts apps/orchestrator/src/workflows/post-workflows/vk-refresh.spec.ts`

Expected: both suites PASS.

- [ ] **Step 6: Commit refresh behavior**

```bash
rtk git add libraries/nestjs-libraries/src/integrations/social/vk.provider.ts libraries/nestjs-libraries/src/integrations/social/vk.provider.spec.ts apps/orchestrator/src/workflows/post-workflows/vk-refresh.spec.ts
rtk git commit -m "fix(vk): refresh expired tokens before publishing"
```

### Task 4: VK verification gate

**Files:**
- Verify only.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: evidence that VK tests and affected applications compile.

- [ ] **Step 1: Run all VK tests**

Run: `rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/vk.response.spec.ts libraries/nestjs-libraries/src/integrations/social/vk.provider.spec.ts libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts apps/orchestrator/src/workflows/post-workflows/vk-refresh.spec.ts`

Expected: all tests PASS.

- [ ] **Step 2: Build affected applications**

Run: `rtk pnpm run build:backend && rtk pnpm run build:orchestrator`

Expected: both commands exit 0.

- [ ] **Step 3: Check the diff**

Run: `rtk git diff --check HEAD~3..HEAD && rtk git status --short`

Expected: no whitespace errors; only intentional branch files are present.
