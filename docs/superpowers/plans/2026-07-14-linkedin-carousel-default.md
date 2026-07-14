# LinkedIn Carousel Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable LinkedIn and LinkedIn Page image carousels by default while safely publishing ineligible media as regular posts.

**Architecture:** The shared LinkedIn composer will request carousel mode by default but preserve an explicit opt-out. The LinkedIn backend will derive a single eligibility decision from the setting and main-post media, use it for both PDF conversion and payload creation, and retain independent video/media validation.

**Tech Stack:** TypeScript, React, React Hook Form, NestJS provider classes, Vitest, pnpm.

## Global Constraints

- Use pnpm only and run lint/type checking from the repository root.
- Preserve explicit `post_as_images_carousel: false` values.
- Use a PDF carousel only for two or more images with no videos.
- Fall back to a regular post for empty media, one image, or one video.
- Keep the existing error for multiple attachments when any attachment is a video.
- Do not change Instagram, Threads, or providers without a carousel-specific setting.
- Execute this plan in an isolated git worktree and preserve unrelated changes in the primary checkout.

---

## File Structure

- `libraries/nestjs-libraries/src/integrations/social/linkedin.provider.spec.ts`: focused provider tests for validation, carousel eligibility, conversion, and payload mode.
- `libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts`: derive and consistently use the actual carousel mode; remove only the obsolete carousel-specific validation error.
- `apps/frontend/src/components/new-launch/providers/linkedin/linkedin.provider.spec.tsx`: verify that the shared LinkedIn settings form registers carousel mode with a true default.
- `apps/frontend/src/components/new-launch/providers/linkedin/linkedin.provider.tsx`: export the settings component for focused testing and set its existing registration default to true.

### Task 1: Backend carousel eligibility and fallback

**Files:**
- Create: `libraries/nestjs-libraries/src/integrations/social/linkedin.provider.spec.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts`

**Interfaces:**
- Consumes: `LinkedinProvider.checkValidity(posts, vals)` and `LinkedinProvider.post(id, accessToken, postDetails, integration, type)`.
- Produces: one internal `useCarousel: boolean` decision shared by PDF conversion and `createMainPost(..., isPdf)`.

- [ ] **Step 1: Write failing backend regression tests**

Create `libraries/nestjs-libraries/src/integrations/social/linkedin.provider.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LinkedinProvider } from './linkedin.provider';

const image = (name: string) => ({
  id: name,
  path: `https://cdn.test/${name}.jpg`,
  type: 'image' as const,
});

const video = {
  id: 'video',
  path: 'https://cdn.test/video.mp4',
  type: 'video' as const,
};

const details = (
  media: Array<ReturnType<typeof image> | typeof video>,
  postAsCarousel: boolean
) => [
  {
    id: 'post-1',
    message: 'LinkedIn post',
    media,
    settings: {
      post_as_images_carousel: postAsCarousel,
    },
  } as any,
];

const prepareProvider = () => {
  const provider = new LinkedinProvider();
  const converted = details([image('carousel')], true);
  const convertImagesToPdfCarousel = vi
    .spyOn(provider as any, 'convertImagesToPdfCarousel')
    .mockResolvedValue(converted);
  const processMediaForPosts = vi
    .spyOn(provider as any, 'processMediaForPosts')
    .mockResolvedValue({ 'post-1': ['asset-1'] });
  const createMainPost = vi
    .spyOn(provider as any, 'createMainPost')
    .mockResolvedValue('urn:li:share:1');

  return {
    provider,
    converted,
    convertImagesToPdfCarousel,
    processMediaForPosts,
    createMainPost,
  };
};

describe('LinkedinProvider carousel fallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('converts two images and publishes them as a PDF carousel', async () => {
    const setup = prepareProvider();
    const postDetails = details([image('one'), image('two')], true);

    await setup.provider.post(
      'person-1',
      'token',
      postDetails,
      {} as any,
      'personal'
    );

    expect(setup.convertImagesToPdfCarousel).toHaveBeenCalledWith(
      postDetails,
      postDetails[0]
    );
    expect(setup.processMediaForPosts).toHaveBeenCalledWith(
      [setup.converted[0]],
      'token',
      'person-1',
      'personal'
    );
    expect(setup.createMainPost).toHaveBeenCalledWith(
      'person-1',
      'token',
      setup.converted[0],
      ['asset-1'],
      'personal',
      true
    );
  });

  it.each([
    ['one image', [image('one')]],
    ['one video', [video]],
    ['no media', []],
  ])('publishes %s as a regular post when carousel is requested', async (_name, media) => {
    const setup = prepareProvider();
    const postDetails = details(media as any, true);

    await setup.provider.post(
      'person-1',
      'token',
      postDetails,
      {} as any,
      'personal'
    );

    expect(setup.convertImagesToPdfCarousel).not.toHaveBeenCalled();
    expect(setup.processMediaForPosts).toHaveBeenCalledWith(
      [postDetails[0]],
      'token',
      'person-1',
      'personal'
    );
    expect(setup.createMainPost).toHaveBeenCalledWith(
      'person-1',
      'token',
      postDetails[0],
      ['asset-1'],
      'personal',
      false
    );
  });

  it('preserves an explicit carousel opt-out for multiple images', async () => {
    const setup = prepareProvider();
    const postDetails = details([image('one'), image('two')], false);

    await setup.provider.post(
      'person-1',
      'token',
      postDetails,
      {} as any,
      'personal'
    );

    expect(setup.convertImagesToPdfCarousel).not.toHaveBeenCalled();
    expect(setup.createMainPost).toHaveBeenCalledWith(
      'person-1',
      'token',
      postDetails[0],
      ['asset-1'],
      'personal',
      false
    );
  });

  it.each([[image('one')], [video], []])(
    'accepts carousel-ineligible media and relies on regular-post fallback',
    async (media) => {
      const provider = new LinkedinProvider();

      await expect(
        provider.checkValidity([media as any], {
          post_as_images_carousel: true,
        })
      ).resolves.toBe(true);
    }
  );

  it('keeps rejecting multiple attachments when one is a video', async () => {
    const provider = new LinkedinProvider();

    await expect(
      provider.checkValidity([[video, image('one')] as any], {
        post_as_images_carousel: true,
      })
    ).resolves.toBe('Can have maximum 1 media when selecting a video.');
  });
});
```

- [ ] **Step 2: Run the backend test and verify RED**

Run from the repository root:

```bash
pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/linkedin.provider.spec.ts
```

Expected: FAIL because one-image/video/empty carousel requests still fail validation or call `convertImagesToPdfCarousel`, and `createMainPost` receives the requested setting instead of actual eligibility.

- [ ] **Step 3: Implement the minimal backend fallback**

In `LinkedinProvider.checkValidity`, keep only the independent media rules:

```ts
  override async checkValidity(
    posts: Array<ValidityMedia[]>,
    vals: any
  ): Promise<string | true> {
    const [firstPost, ...restPosts] = posts ?? [];

    if (
      (firstPost?.length ?? 0) > 1 &&
      firstPost?.some((p) => (p?.path?.indexOf?.('mp4') ?? -1) > -1)
    ) {
      return 'Can have maximum 1 media when selecting a video.';
    }
    if (restPosts?.some((p) => (p?.length ?? 0) > 0)) {
      return 'Comments can only contain text.';
    }
    return true;
  }
```

In `LinkedinProvider.post`, compute actual eligibility once and use it for both conversion and payload mode:

```ts
  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<LinkedinDto>[],
    integration: Integration,
    type = 'personal' as 'company' | 'personal'
  ): Promise<PostResponse[]> {
    let processedPostDetails = postDetails;
    const [firstPost] = postDetails;

    const useCarousel =
      this.assetBoolean(firstPost.settings?.post_as_images_carousel) &&
      (firstPost.media?.length ?? 0) >= 2 &&
      !firstPost.media?.some(
        (media) => (media?.path?.indexOf?.('mp4') ?? -1) > -1
      );

    if (useCarousel) {
      processedPostDetails = await this.convertImagesToPdfCarousel(
        postDetails,
        firstPost
      );
    }

    const [processedFirstPost] = processedPostDetails;
    const uploadedMedia = await this.processMediaForPosts(
      [processedFirstPost],
      accessToken,
      id,
      type
    );
    const mainPostMediaIds = (
      uploadedMedia[processedFirstPost.id] || []
    ).filter(Boolean);
    const mainPostId = await this.createMainPost(
      id,
      accessToken,
      processedFirstPost,
      mainPostMediaIds,
      type,
      useCarousel
    );

    return [this.createPostResponse(mainPostId, processedFirstPost.id, true)];
  }
```

- [ ] **Step 4: Run the backend test and verify GREEN**

Run:

```bash
pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/linkedin.provider.spec.ts
```

Expected: PASS with all carousel and fallback cases green.

- [ ] **Step 5: Commit the backend behavior and tests**

```bash
git add libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts libraries/nestjs-libraries/src/integrations/social/linkedin.provider.spec.ts
git commit -m "feat(linkedin): fall back from ineligible carousels"
```

### Task 2: Shared composer carousel default

**Files:**
- Create: `apps/frontend/src/components/new-launch/providers/linkedin/linkedin.provider.spec.tsx`
- Modify: `apps/frontend/src/components/new-launch/providers/linkedin/linkedin.provider.tsx`

**Interfaces:**
- Consumes: the shared `LinkedInSettings` component used by both `linkedin` and `linkedin-page` in `show.all.providers.tsx`.
- Produces: React Hook Form registration of `post_as_images_carousel` with `{ value: true }`, while preserving the visible checkbox opt-out.

- [ ] **Step 1: Write a failing frontend default test**

Create `apps/frontend/src/components/new-launch/providers/linkedin/linkedin.provider.spec.tsx`:

```tsx
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const settings = vi.hoisted(() => ({
  register: vi.fn(() => ({})),
  watch: vi.fn(() => false),
}));

vi.mock(
  '@gitroom/frontend/components/new-launch/providers/high.order.provider',
  () => ({
    PostComment: { COMMENT: 'comment' },
    withProvider: vi.fn(() => () => null),
  })
);
vi.mock('@gitroom/react/form/checkbox', () => ({ Checkbox: () => null }));
vi.mock('@gitroom/react/form/input', () => ({ Input: () => null }));
vi.mock(
  '@gitroom/react/translation/get.transation.service.client',
  () => ({ useT: () => (_key: string, fallback: string) => fallback })
);
vi.mock(
  '@gitroom/frontend/components/launches/helpers/use.values',
  () => ({
    useSettings: () => ({
      ...settings,
      formState: {},
      control: {},
    }),
  })
);
vi.mock(
  '@gitroom/nestjs-libraries/dtos/posts/providers-settings/linkedin.dto',
  () => ({ LinkedinDto: class {} })
);
vi.mock(
  '@gitroom/frontend/components/new-launch/providers/linkedin/linkedin.preview',
  () => ({ LinkedinPreview: () => null })
);

import { LinkedInSettings } from './linkedin.provider';

describe('LinkedInSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enables image carousel mode by default', () => {
    renderToStaticMarkup(createElement(LinkedInSettings));

    expect(settings.register).toHaveBeenCalledWith(
      'post_as_images_carousel',
      { value: true }
    );
  });
});
```

- [ ] **Step 2: Run the frontend test and verify RED**

Run:

```bash
pnpm exec vitest run apps/frontend/src/components/new-launch/providers/linkedin/linkedin.provider.spec.tsx
```

Expected: FAIL because `LinkedInSettings` is not exported and its registration currently defaults to false.

- [ ] **Step 3: Export the settings component and enable the default**

Change the component declaration and existing checkbox registration in `linkedin.provider.tsx`:

```tsx
export const LinkedInSettings = () => {
  const t = useT();
  const { watch, register } = useSettings();
  const isCarousel = watch('post_as_images_carousel');

  return (
    <div className="mb-[20px]">
      <Checkbox
        variant="hollow"
        label={t('post_as_images_carousel', 'Post as images carousel')}
        {...register('post_as_images_carousel', {
          value: true,
        })}
      />
      {isCarousel && (
        <div className="mt-[10px]">
          <Input
            label={t('carousel_name', 'Carousel slide name')}
            placeholder="slides"
            {...register('carousel_name')}
          />
        </div>
      )}
    </div>
  );
};
```

Keep the existing `withProvider<LinkedinDto>({...})` default export unchanged so both LinkedIn provider identifiers continue using this component.

- [ ] **Step 4: Run the frontend test and verify GREEN**

Run:

```bash
pnpm exec vitest run apps/frontend/src/components/new-launch/providers/linkedin/linkedin.provider.spec.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the composer default and test**

```bash
git add apps/frontend/src/components/new-launch/providers/linkedin/linkedin.provider.tsx apps/frontend/src/components/new-launch/providers/linkedin/linkedin.provider.spec.tsx
git commit -m "feat(linkedin): enable carousels by default"
```

### Task 3: Focused and package-level verification

**Files:**
- Verify only; no additional production files should change.

**Interfaces:**
- Consumes: all tests and implementation from Tasks 1 and 2.
- Produces: evidence that focused behavior, TypeScript packages, and formatting remain valid.

- [ ] **Step 1: Run both focused test files together**

```bash
pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/linkedin.provider.spec.ts apps/frontend/src/components/new-launch/providers/linkedin/linkedin.provider.spec.tsx
```

Expected: both files and all tests PASS.

- [ ] **Step 2: Type-check the server library**

```bash
pnpm exec tsc --noEmit -p libraries/nestjs-libraries/tsconfig.lib.json
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 3: Type-check the frontend**

```bash
pnpm exec tsc --noEmit -p apps/frontend/tsconfig.json
```

Expected: exit code 0 with no TypeScript errors attributable to the touched files. If pre-existing repository errors occur, record the exact output and still verify the touched test through Vitest.

- [ ] **Step 4: Check the final diff**

```bash
git diff --check HEAD~2..HEAD
git status --short
```

Expected: no whitespace errors; only the four planned implementation/test files differ across the two feature commits, and the worktree is clean.

- [ ] **Step 5: Review the completed branch**

Use the `requesting-code-review` skill to compare the implementation against `docs/superpowers/specs/2026-07-14-linkedin-carousel-default-design.md`. Address any correctness findings, rerun the focused tests and type checks, then use `verification-before-completion` before reporting success.
