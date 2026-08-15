# Platform-aware Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one shared capability registry that drives formatting controls, limits, previews, and authoritative validation for Telegram, MAX, LinkedIn, Tumblr, Pinterest, personal VK, and VK Group.

**Architecture:** A dependency-light helper module owns immutable platform profiles, conservative legacy fallback, capability intersection, content normalization, and content diagnostics. Backend integration metadata exposes the resolved profile to the frontend; the editor derives universal capabilities from selected integrations and server validation repeats the same rules before provider API calls.

**Tech Stack:** TypeScript 5.5, React 19, Next.js 16, Zustand, TipTap 3, NestJS 11, Vitest 3, pnpm 10.

## Global Constraints

- Execute in an isolated worktree created with the `using-git-worktrees` skill.
- Bootstrap a new worktree with `pnpm install --frozen-lockfile`, then run `pnpm run verify:workspace` before the first test or build.
- Use only pnpm; do not add dependencies for this feature.
- Preserve canonical post content as HTML; replacing it with a document AST is out of scope.
- Never silently rewrite stored source content when switching destinations.
- Providers without explicit profiles must retain current behavior through a conservative fallback.
- Frontend warnings are advisory; backend validation is authoritative.
- Authenticated publication to personal accounts remains a manual user check.
- Track the work under Linear parent `FED-339`, with implementation issues `FED-340` through `FED-345`.

---

## File Structure

- `libraries/helpers/src/utils/platform.capabilities.ts` — shared types, active profiles, fallback lookup, and universal intersection.
- `libraries/helpers/src/utils/platform.capabilities.spec.ts` — registry, fallback, and intersection contract tests.
- `libraries/helpers/src/utils/platform.content.ts` — deterministic normalization and information/warning/error diagnostics.
- `libraries/helpers/src/utils/platform.content.spec.ts` — normalization, length, and delivery tests.
- `libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts` — optional provider capability contract.
- `libraries/nestjs-libraries/src/integrations/integration.manager.ts` — resolves and serializes provider capabilities.
- `libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts` — metadata regression tests.
- `apps/backend/src/api/routes/integrations.controller.ts` — includes capabilities in connected integration responses.
- `apps/frontend/src/components/launches/calendar.context.tsx` — frontend integration type includes the serialized profile.
- `apps/frontend/src/components/new-launch/platform.editor.capabilities.ts` — pure toolbar/profile selection helpers.
- `apps/frontend/src/components/new-launch/platform.editor.capabilities.spec.ts` — universal/specific editor behavior tests.
- `apps/frontend/src/components/new-launch/platform.content.notice.tsx` — renders information, warning, and blocking messages.
- `apps/frontend/src/components/new-launch/platform.content.notice.spec.tsx` — notice severity rendering tests.
- `apps/frontend/src/components/new-launch/editor.tsx` — capability-driven toolbar and diagnostics.
- `apps/frontend/src/components/new-launch/providers/high.order.provider.tsx` — registry limit wins over duplicated component constants.
- `apps/frontend/src/components/launches/information.component.tsx` — capability-aware counters and messages.
- `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts` — authoritative shared content validation.
- `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts` — backend validation regressions.
- `apps/frontend/src/components/new-launch/manage.modal.tsx` — displays the first blocking backend content error.

### Task 1: Define the capability contract, profiles, and intersection

**Files:**

- Create: `libraries/helpers/src/utils/platform.capabilities.ts`
- Create: `libraries/helpers/src/utils/platform.capabilities.spec.ts`

**Interfaces:**

- Produces: `PlatformCapabilities`, `LegacyCapabilityFallback`, `getPlatformCapabilities(identifier, fallback)`, and `intersectPlatformCapabilities(profiles)`.
- Consumes: existing editor modes `'none' | 'normal' | 'markdown' | 'html'` and provider maximum lengths.

- [ ] **Step 1: Write failing registry and intersection tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  getPlatformCapabilities,
  intersectPlatformCapabilities,
} from './platform.capabilities';

describe('platform capability registry', () => {
  it('describes the seven active destinations with backend limits', () => {
    expect(getPlatformCapabilities('telegram').text).toEqual({
      max: 4096,
      mediaCaptionMax: 1024,
    });
    expect(getPlatformCapabilities('max').text.max).toBe(4000);
    expect(getPlatformCapabilities('linkedin').text.max).toBe(3000);
    expect(getPlatformCapabilities('tumblr').text.max).toBe(32768);
    expect(getPlatformCapabilities('pinterest').text.max).toBe(500);
    expect(getPlatformCapabilities('vk').text.max).toBe(16384);
    expect(getPlatformCapabilities('vk-group').text.max).toBe(16384);
  });

  it('uses a conservative fallback for an unaudited provider', () => {
    expect(
      getPlatformCapabilities('unknown', {
        editor: 'markdown',
        maximumCharacters: 700,
      })
    ).toMatchObject({
      identifier: 'unknown',
      verified: false,
      output: 'markdown',
      text: { max: 700 },
      formatting: {
        bold: 'native',
        underline: 'native',
        links: 'native',
        lists: 'native',
        headings: 'native',
      },
    });
  });

  it('intersects selected platforms and keeps the strictest limit', () => {
    const universal = intersectPlatformCapabilities([
      getPlatformCapabilities('telegram'),
      getPlatformCapabilities('vk'),
    ]);

    expect(universal.identifier).toBe('universal');
    expect(universal.text.max).toBe(4096);
    expect(universal.formatting.bold).toBe('unicode');
    expect(universal.formatting.links).toBe('unsupported');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.capabilities.spec.ts`

Expected: FAIL because `platform.capabilities.ts` does not exist.

- [ ] **Step 3: Implement the immutable contract and active profiles**

```ts
export type EditorMode = 'none' | 'normal' | 'markdown' | 'html';
export type FormattingSupport = 'native' | 'unicode' | 'plain' | 'unsupported';
export type ContentMessageSeverity = 'information' | 'warning' | 'error';

export interface PlatformCapabilities {
  identifier: string;
  verified: boolean;
  output: EditorMode;
  formatting: {
    bold: FormattingSupport;
    underline: FormattingSupport;
    links: FormattingSupport;
    lists: FormattingSupport;
    headings: FormattingSupport;
  };
  text: { max: number; mediaCaptionMax?: number };
  media: {
    required: boolean;
    images: boolean;
    videos: boolean;
    maxImages?: number;
    maxVideos?: number;
    videoRequiresCover?: boolean;
  };
  specialFields: Array<{ key: string; required: boolean }>;
  delivery: {
    longMediaText: 'caption' | 'split-after-media' | 'not-applicable';
  };
}

export interface LegacyCapabilityFallback {
  editor: EditorMode;
  maximumCharacters: number;
}

const plainFormatting = {
  bold: 'unicode',
  underline: 'unicode',
  links: 'plain',
  lists: 'plain',
  headings: 'plain',
} as const;

const activeProfiles: Record<string, PlatformCapabilities> = {
  telegram: {
    identifier: 'telegram',
    verified: true,
    output: 'html',
    formatting: {
      bold: 'native',
      underline: 'native',
      links: 'unsupported',
      lists: 'plain',
      headings: 'plain',
    },
    text: { max: 4096, mediaCaptionMax: 1024 },
    media: { required: false, images: true, videos: true },
    specialFields: [],
    delivery: { longMediaText: 'split-after-media' },
  },
  max: {
    identifier: 'max',
    verified: true,
    output: 'html',
    formatting: {
      bold: 'native',
      underline: 'native',
      links: 'native',
      lists: 'plain',
      headings: 'plain',
    },
    text: { max: 4000 },
    media: { required: false, images: true, videos: false },
    specialFields: [],
    delivery: { longMediaText: 'caption' },
  },
  linkedin: {
    identifier: 'linkedin',
    verified: true,
    output: 'normal',
    formatting: plainFormatting,
    text: { max: 3000 },
    media: { required: false, images: true, videos: true, maxVideos: 1 },
    specialFields: [],
    delivery: { longMediaText: 'not-applicable' },
  },
  tumblr: {
    identifier: 'tumblr',
    verified: true,
    output: 'normal',
    formatting: plainFormatting,
    text: { max: 32768 },
    media: {
      required: false,
      images: true,
      videos: true,
      maxImages: 30,
      maxVideos: 1,
    },
    specialFields: [
      { key: 'title', required: false },
      { key: 'link', required: false },
      { key: 'sourceUrl', required: false },
      { key: 'tags', required: false },
    ],
    delivery: { longMediaText: 'not-applicable' },
  },
  pinterest: {
    identifier: 'pinterest',
    verified: true,
    output: 'normal',
    formatting: plainFormatting,
    text: { max: 500 },
    media: {
      required: true,
      images: true,
      videos: true,
      maxImages: 5,
      maxVideos: 1,
      videoRequiresCover: true,
    },
    specialFields: [
      { key: 'title', required: false },
      { key: 'link', required: false },
      { key: 'board', required: true },
    ],
    delivery: { longMediaText: 'not-applicable' },
  },
  vk: {
    identifier: 'vk',
    verified: true,
    output: 'normal',
    formatting: plainFormatting,
    text: { max: 16384 },
    media: { required: false, images: true, videos: true },
    specialFields: [],
    delivery: { longMediaText: 'not-applicable' },
  },
  'vk-group': {
    identifier: 'vk-group',
    verified: true,
    output: 'normal',
    formatting: plainFormatting,
    text: { max: 16384 },
    media: {
      required: false,
      images: true,
      videos: false,
      maxImages: 10,
      maxVideos: 0,
    },
    specialFields: [],
    delivery: { longMediaText: 'not-applicable' },
  },
};

const supportRank: FormattingSupport[] = [
  'unsupported',
  'plain',
  'unicode',
  'native',
];
const weakest = (values: FormattingSupport[]) =>
  supportRank[Math.min(...values.map((value) => supportRank.indexOf(value)))];
const strictestDefined = (values: Array<number | undefined>) => {
  const defined = values.filter(
    (value): value is number => value !== undefined
  );
  return defined.length ? Math.min(...defined) : undefined;
};

export const getPlatformCapabilities = (
  identifier: string,
  fallback: LegacyCapabilityFallback = {
    editor: 'normal',
    maximumCharacters: 1_000_000,
  }
): PlatformCapabilities =>
  activeProfiles[identifier] || {
    identifier,
    verified: false,
    output: fallback.editor,
    formatting:
      fallback.editor === 'none'
        ? {
            bold: 'unsupported',
            underline: 'unsupported',
            links: 'unsupported',
            lists: 'unsupported',
            headings: 'unsupported',
          }
        : fallback.editor === 'normal'
        ? plainFormatting
        : {
            bold: 'native',
            underline: 'native',
            links: 'native',
            lists: 'native',
            headings: 'native',
          },
    text: { max: fallback.maximumCharacters },
    media: { required: false, images: true, videos: true },
    specialFields: [],
    delivery: { longMediaText: 'not-applicable' },
  };

export const intersectPlatformCapabilities = (
  profiles: PlatformCapabilities[]
): PlatformCapabilities => {
  const selected = profiles.length
    ? profiles
    : [getPlatformCapabilities('universal')];
  return {
    identifier: 'universal',
    verified: selected.every((item) => item.verified),
    output: 'normal',
    formatting: {
      bold: weakest(selected.map((item) => item.formatting.bold)),
      underline: weakest(selected.map((item) => item.formatting.underline)),
      links: weakest(selected.map((item) => item.formatting.links)),
      lists: weakest(selected.map((item) => item.formatting.lists)),
      headings: weakest(selected.map((item) => item.formatting.headings)),
    },
    text: {
      max: Math.min(...selected.map((item) => item.text.max)),
      mediaCaptionMax: strictestDefined(
        selected.map((item) => item.text.mediaCaptionMax)
      ),
    },
    media: {
      required: selected.some((item) => item.media.required),
      images: selected.every((item) => item.media.images),
      videos: selected.every((item) => item.media.videos),
      maxImages: strictestDefined(selected.map((item) => item.media.maxImages)),
      maxVideos: strictestDefined(selected.map((item) => item.media.maxVideos)),
      videoRequiresCover: selected.some(
        (item) => item.media.videoRequiresCover
      ),
    },
    specialFields: [],
    delivery: { longMediaText: 'not-applicable' },
  };
};
```

- [ ] **Step 4: Run the focused test**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.capabilities.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libraries/helpers/src/utils/platform.capabilities.ts libraries/helpers/src/utils/platform.capabilities.spec.ts
git commit -m "feat: define platform capability registry"
```

### Task 2: Expose resolved capabilities through integration metadata

**Files:**

- Modify: `libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/integration.manager.ts`
- Create: `libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts`
- Modify: `apps/backend/src/api/routes/integrations.controller.ts`
- Modify: `apps/frontend/src/components/launches/calendar.context.tsx`

**Interfaces:**

- Consumes: `getPlatformCapabilities(identifier, fallback)` from Task 1.
- Produces: `IntegrationManager.getCapabilities(provider)` and serialized `capabilities: PlatformCapabilities` on integration list items.

- [ ] **Step 1: Write the failing manager metadata test**

```ts
import { describe, expect, it } from 'vitest';
import { IntegrationManager } from './integration.manager';

describe('IntegrationManager capability metadata', () => {
  it('uses the shared registry as the source of the VK limit', () => {
    const manager = new IntegrationManager();
    expect(manager.getCapabilities('vk')).toMatchObject({
      identifier: 'vk',
      verified: true,
      text: { max: 16384 },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts`

Expected: FAIL because `getCapabilities` does not exist.

- [ ] **Step 3: Add the shared metadata interface and manager resolver**

Add to `SocialProvider`:

```ts
import { PlatformCapabilities } from '@gitroom/helpers/utils/platform.capabilities';

capabilities?: PlatformCapabilities;
```

Add to `IntegrationManager`:

```ts
import {
  getPlatformCapabilities,
  PlatformCapabilities,
} from '@gitroom/helpers/utils/platform.capabilities';

getCapabilities(providerName: string): PlatformCapabilities {
  const provider = this.getSocialIntegration(providerName);
  return provider.capabilities || getPlatformCapabilities(providerName, {
    editor: provider.editor,
    maximumCharacters: provider.maxLength(),
  });
}
```

Add `capabilities: this.getCapabilities(p.identifier)` to each item returned by
`getAllIntegrations()`. Add `capabilities: this._integrationManager.getCapabilities(p.providerIdentifier)`
to `GET /integrations/list`.

Extend the frontend type:

```ts
import { PlatformCapabilities } from '@gitroom/helpers/utils/platform.capabilities';

export interface Integrations {
  // existing fields stay unchanged
  capabilities: PlatformCapabilities;
}
```

- [ ] **Step 4: Run manager and controller-adjacent tests**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts libraries/nestjs-libraries/src/integrations/integration.manager.ts libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts apps/backend/src/api/routes/integrations.controller.ts apps/frontend/src/components/launches/calendar.context.tsx
git commit -m "feat: expose platform capabilities to clients"
```

### Task 3: Normalize content and produce deterministic diagnostics

**Files:**

- Create: `libraries/helpers/src/utils/platform.content.ts`
- Create: `libraries/helpers/src/utils/platform.content.spec.ts`
- Modify: `libraries/helpers/src/utils/telegram.constraints.ts`

**Interfaces:**

- Consumes: `PlatformCapabilities` and canonical HTML.
- Produces: `normalizePlatformContent(content, capabilities)`, `analyzePlatformContent(input): PlatformContentAnalysis`, and `analyzeSelectedPlatformContent(input)` for universal mode.

- [ ] **Step 1: Write failing normalization and diagnostic tests**

```ts
import { describe, expect, it } from 'vitest';
import { getPlatformCapabilities } from './platform.capabilities';
import {
  analyzePlatformContent,
  analyzeSelectedPlatformContent,
  normalizePlatformContent,
} from './platform.content';

describe('platform content normalization', () => {
  it('normalizes Telegram to its supported HTML subset', () => {
    expect(
      normalizePlatformContent(
        '<h1>Title</h1><p><strong>Bold</strong> <a href="https://x.test">Link</a></p>',
        getPlatformCapabilities('telegram')
      )
    ).toBe('Title\n<b>Bold</b> Link');
  });

  it('keeps Telegram normalization idempotent', () => {
    const once = normalizePlatformContent(
      '<p><strong>Bold</strong></p>',
      getPlatformCapabilities('telegram')
    );
    expect(
      normalizePlatformContent(once, getPlatformCapabilities('telegram'))
    ).toBe(once);
  });

  it('reports Telegram long-media split as information', () => {
    const analysis = analyzePlatformContent({
      content: `<p>${'a'.repeat(1025)}</p>`,
      media: [{ type: 'image' }],
      capabilities: getPlatformCapabilities('telegram'),
    });
    expect(analysis.messages).toContainEqual(
      expect.objectContaining({
        severity: 'information',
        code: 'media-text-split',
      })
    );
    expect(analysis.blocking).toBe(false);
  });

  it('blocks required Pinterest media and hard text overflow', () => {
    const analysis = analyzePlatformContent({
      content: `<p>${'a'.repeat(501)}</p>`,
      media: [],
      capabilities: getPlatformCapabilities('pinterest'),
    });
    expect(analysis.messages.map((item) => item.code)).toEqual([
      'text-too-long',
      'media-required',
    ]);
    expect(analysis.blocking).toBe(true);
  });

  it('retains platform identity when universal content has platform-specific delivery', () => {
    const analyses = analyzeSelectedPlatformContent({
      content: `<p>${'a'.repeat(1025)}</p>`,
      media: [{ type: 'image' }],
      capabilities: [
        getPlatformCapabilities('telegram'),
        getPlatformCapabilities('vk'),
      ],
    });
    expect(analyses.messages).toContainEqual(
      expect.objectContaining({
        platform: 'telegram',
        code: 'media-text-split',
      })
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.content.spec.ts`

Expected: FAIL because `platform.content.ts` does not exist.

- [ ] **Step 3: Implement normalization and diagnostics**

```ts
import striptags from 'striptags';
import { stripHtmlValidation } from './strip.html.validation';
import {
  getTelegramVisibleTextLength,
  normalizeTelegramHtml,
} from './telegram.constraints';
import {
  ContentMessageSeverity,
  intersectPlatformCapabilities,
  PlatformCapabilities,
} from './platform.capabilities';

export interface PlatformContentMessage {
  platform?: string;
  severity: ContentMessageSeverity;
  code:
    | 'formatting-loss'
    | 'text-too-long'
    | 'media-required'
    | 'unsupported-media'
    | 'too-many-images'
    | 'too-many-videos'
    | 'video-cover-required'
    | 'media-text-split';
  text: string;
}

export interface PlatformContentAnalysis {
  normalized: string;
  visibleLength: number;
  blocking: boolean;
  messages: PlatformContentMessage[];
}

export const normalizePlatformContent = (
  content: string,
  capabilities: PlatformCapabilities,
  convertMentionFunction?: (idOrHandle: string, name: string) => string
): string => {
  const html = stripHtmlValidation(
    'html',
    content,
    false,
    false,
    false,
    convertMentionFunction
  );
  if (capabilities.identifier === 'telegram') {
    return normalizeTelegramHtml(html);
  }
  if (capabilities.output === 'html') {
    return striptags(html, ['p', 'strong', 'u', 'a']);
  }
  return stripHtmlValidation(
    capabilities.output,
    content,
    true,
    false,
    false,
    convertMentionFunction
  );
};

export const analyzePlatformContent = ({
  content,
  media,
  capabilities,
}: {
  content: string;
  media: Array<{ type?: 'image' | 'video' }>;
  capabilities: PlatformCapabilities;
}): PlatformContentAnalysis => {
  const normalized = normalizePlatformContent(content, capabilities);
  const visibleLength =
    capabilities.identifier === 'telegram'
      ? getTelegramVisibleTextLength(normalized)
      : striptags(normalized).length;
  const messages: PlatformContentMessage[] = [];
  const imageCount = media.filter((item) => item.type !== 'video').length;
  const videoCount = media.filter((item) => item.type === 'video').length;

  const losesLinks =
    /<a\b/i.test(content) && capabilities.formatting.links !== 'native';
  const losesLists =
    /<(ul|ol|li)\b/i.test(content) &&
    capabilities.formatting.lists !== 'native';
  const losesHeadings =
    /<h[1-6]\b/i.test(content) && capabilities.formatting.headings !== 'native';
  if (losesLinks || losesLists || losesHeadings) {
    messages.push({
      severity: 'warning',
      code: 'formatting-loss',
      text: 'Some formatting will be converted to plain text.',
    });
  }

  if (visibleLength > capabilities.text.max) {
    messages.push({
      severity: 'error',
      code: 'text-too-long',
      text: `Text exceeds the ${capabilities.text.max}-character limit.`,
    });
  }
  if (capabilities.media.required && media.length === 0) {
    messages.push({
      severity: 'error',
      code: 'media-required',
      text: 'This platform requires media.',
    });
  }
  if (
    (!capabilities.media.images && imageCount > 0) ||
    (!capabilities.media.videos && videoCount > 0)
  ) {
    messages.push({
      severity: 'error',
      code: 'unsupported-media',
      text: 'One or more attached media types are not supported.',
    });
  }
  if (
    capabilities.media.maxImages !== undefined &&
    imageCount > capabilities.media.maxImages
  ) {
    messages.push({
      severity: 'error',
      code: 'too-many-images',
      text: `This platform supports up to ${capabilities.media.maxImages} images.`,
    });
  }
  if (
    capabilities.media.maxVideos !== undefined &&
    videoCount > capabilities.media.maxVideos
  ) {
    messages.push({
      severity: 'error',
      code: 'too-many-videos',
      text: `This platform supports up to ${capabilities.media.maxVideos} videos.`,
    });
  }
  if (
    capabilities.media.videoRequiresCover &&
    videoCount > 0 &&
    imageCount === 0
  ) {
    messages.push({
      severity: 'error',
      code: 'video-cover-required',
      text: 'A cover image is required for video.',
    });
  }
  if (
    media.length > 0 &&
    capabilities.text.mediaCaptionMax &&
    visibleLength > capabilities.text.mediaCaptionMax &&
    capabilities.delivery.longMediaText === 'split-after-media'
  ) {
    messages.push({
      severity: 'information',
      code: 'media-text-split',
      text: 'Media will be published first, followed by the full text as a separate message.',
    });
  }
  return {
    normalized,
    visibleLength,
    messages,
    blocking: messages.some((item) => item.severity === 'error'),
  };
};

export const analyzeSelectedPlatformContent = ({
  content,
  media,
  capabilities,
}: {
  content: string;
  media: Array<{ type?: 'image' | 'video' }>;
  capabilities: PlatformCapabilities[];
}): PlatformContentAnalysis => {
  const analyses = capabilities.map((profile) =>
    analyzePlatformContent({ content, media, capabilities: profile })
  );
  const messages = analyses.flatMap((analysis, index) =>
    analysis.messages.map((message) => ({
      ...message,
      platform: capabilities[index].identifier,
      text: `${capabilities[index].identifier}: ${message.text}`,
    }))
  );
  return {
    normalized: normalizePlatformContent(
      content,
      intersectPlatformCapabilities(capabilities)
    ),
    visibleLength: Math.max(...analyses.map((item) => item.visibleLength), 0),
    blocking: messages.some((item) => item.severity === 'error'),
    messages,
  };
};
```

Universal diagnostics intentionally analyze every selected profile; the
intersection alone cannot express a Telegram-only delivery split.

Keep `normalizeTelegramHtml` exported and replace its body with the exact
ordering below so unsupported headings and links retain visible text while
headings retain a line break:

```ts
export const normalizeTelegramHtml = (value: string): string =>
  striptags(
    value
      .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gis, '$1\n')
      .replace(/<a[^>]*>(.*?)<\/a>/gis, '$1'),
    ['u', 'strong', 'b', 'p']
  )
    .replace(/<strong>/g, '<b>')
    .replace(/<\/strong>/g, '</b>')
    .replace(/<p>(.*?)<\/p>/gs, '$1\n')
    .replace(/\n$/, '');
```

- [ ] **Step 4: Run content and existing Telegram tests**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.content.spec.ts libraries/helpers/src/utils/telegram.constraints.spec.ts libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libraries/helpers/src/utils/platform.content.ts libraries/helpers/src/utils/platform.content.spec.ts libraries/helpers/src/utils/telegram.constraints.ts
git commit -m "feat: normalize and analyze platform content"
```

### Task 4: Make server-side content validation authoritative

**Files:**

- Modify: `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts`
- Modify: `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts`
- Modify: `apps/orchestrator/src/activities/post.activity.ts`
- Create: `apps/orchestrator/src/activities/post.activity.formatting.spec.ts`
- Modify: `apps/frontend/src/components/new-launch/manage.modal.tsx`

**Interfaces:**

- Consumes: `IntegrationManager.getCapabilities()`, `analyzePlatformContent()`, and `normalizePlatformContent()`.
- Produces: `contentMessages` and `contentError` in each `validatePosts()` result.

- [ ] **Step 1: Add failing backend validation tests**

```ts
it('uses registry limits instead of duplicated frontend limits', async () => {
  const provider = {
    checkValidity: vi.fn().mockResolvedValue(true),
    maxLength: vi.fn().mockReturnValue(16384),
    editor: 'normal',
  };
  const service = createService({
    integrationManager: {
      getSocialIntegration: vi.fn().mockReturnValue(provider),
      getCapabilities: vi.fn().mockReturnValue(getPlatformCapabilities('vk')),
    },
    integrationService: {
      getIntegrationById: vi.fn().mockResolvedValue({
        id: 'vk-1',
        providerIdentifier: 'vk',
        name: 'VK',
        additionalSettings: '[]',
      }),
    },
  });
  const [result] = await service.validatePosts('org-1', [
    {
      integration: { id: 'vk-1' },
      value: [{ content: `<p>${'a'.repeat(3000)}</p>`, image: [] }],
    },
  ]);
  expect(result.tooLong).toBe(false);
  expect(result.contentError).toBe('');
});

it('returns a blocking Pinterest media error', async () => {
  const provider = {
    checkValidity: vi.fn().mockResolvedValue('Requires at least one media'),
    maxLength: vi.fn().mockReturnValue(500),
    editor: 'normal',
  };
  const service = createService({
    integrationManager: {
      getSocialIntegration: vi.fn().mockReturnValue(provider),
      getCapabilities: vi
        .fn()
        .mockReturnValue(getPlatformCapabilities('pinterest')),
    },
    integrationService: {
      getIntegrationById: vi.fn().mockResolvedValue({
        id: 'pin-1',
        providerIdentifier: 'pinterest',
        name: 'Pinterest',
        additionalSettings: '[]',
      }),
    },
  });
  const [result] = await service.validatePosts('org-1', [
    {
      integration: { id: 'pin-1' },
      value: [{ content: '<p>Pin</p>', image: [] }],
    },
  ]);
  expect(result.contentError).toBe('This platform requires media.');
});
```

Import `getPlatformCapabilities` at the top of the spec. Keep the VK and
Pinterest fixtures independent rather than sharing mutable mocks.

Create `post.activity.formatting.spec.ts` with the publishing-path regression:

```ts
import { describe, expect, it, vi } from 'vitest';
import { PostActivity } from './post.activity';
import { getPlatformCapabilities } from '@gitroom/helpers/utils/platform.capabilities';

describe('PostActivity platform formatting', () => {
  it('passes registry-normalized Telegram content to the provider', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const provider = {
      post: vi.fn().mockResolvedValue([]),
      editor: 'html',
      mentionFormat: undefined,
      convertToJPEG: false,
    };
    const postService = {
      updateTags: vi.fn().mockResolvedValue([
        {
          id: 'post-1',
          content:
            '<h1>Title</h1><p><strong>Body</strong> <a href="https://x.test">Link</a></p>',
          settings: '{}',
          image: '[]',
        },
      ]),
      updateMedia: vi.fn().mockResolvedValue([]),
    };
    const integrationManager = {
      getSocialIntegration: vi.fn().mockReturnValue(provider),
      getCapabilities: vi
        .fn()
        .mockReturnValue(getPlatformCapabilities('telegram')),
    };
    const activity = new PostActivity(
      postService as any,
      {} as any,
      integrationManager as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await activity.postSocial(
      {
        id: 'integration-1',
        internalId: 'channel',
        token: 'chat-id',
        providerIdentifier: 'telegram',
        organizationId: 'org-1',
      } as any,
      [{ id: 'post-1' } as any]
    );

    expect(provider.post).toHaveBeenCalledWith(
      'channel',
      'chat-id',
      [expect.objectContaining({ message: 'Title\n<b>Body</b> Link\n' })],
      expect.objectContaining({ id: 'integration-1' })
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts`

Expected: FAIL because validation results have no `contentError`.

- [ ] **Step 3: Replace the duplicated length calculation with shared analysis**

Inside each `validatePosts()` item:

```ts
const capabilities = this._integrationManager.getCapabilities(
  integration.providerIdentifier
);
const contentAnalyses = (post.value || []).map((item) =>
  analyzePlatformContent({
    content: item.content || '',
    media: item.image || [],
    capabilities,
  })
);
const contentMessages = contentAnalyses.flatMap((item) => item.messages);
const contentError =
  contentMessages.find((item) => item.severity === 'error')?.text || '';
const tooLong = contentMessages.some((item) => item.code === 'text-too-long');
const maximumCharacters = capabilities.text.max;
```

Return `contentMessages` and `contentError`. Preserve DTO validation and
`provider.checkValidity()` because they cover settings and detailed media rules
that the generic registry does not replace.

In both `PostActivity.postSocial()` and `PostActivity.postComment()`, resolve
capabilities once and replace the `stripHtmlValidation(...)` call:

```ts
const capabilities = this._integrationManager.getCapabilities(
  integration.providerIdentifier
);

message: normalizePlatformContent(
  p.content,
  capabilities,
  getIntegration.mentionFormat
),
```

Import `normalizePlatformContent` and remove the now-unused
`stripHtmlValidation` import. Provider transport methods may keep their final
defensive normalization; the input they receive is now the same normalized
form shown by the preview.

In `manage.modal.tsx`, check `item.contentError` before `item.tooLong`:

```tsx
if (item.contentError) {
  toaster.show(
    `${item.name} (${item.identifier}): ${item.contentError}`,
    'warning'
  );
  focus(item.id, 'preview');
  setLoading(false);
  setShowSettings(false);
  return;
}
```

- [ ] **Step 4: Run backend validation tests**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts apps/orchestrator/src/activities/post.activity.formatting.spec.ts libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts libraries/nestjs-libraries/src/integrations/social/linkedin.provider.spec.ts libraries/nestjs-libraries/src/integrations/social/vk.provider.spec.ts libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts apps/orchestrator/src/activities/post.activity.ts apps/orchestrator/src/activities/post.activity.formatting.spec.ts apps/frontend/src/components/new-launch/manage.modal.tsx
git commit -m "feat: validate platform content before publishing"
```

### Task 5: Derive universal and platform-specific editor capabilities

**Files:**

- Create: `apps/frontend/src/components/new-launch/platform.editor.capabilities.ts`
- Create: `apps/frontend/src/components/new-launch/platform.editor.capabilities.spec.ts`
- Modify: `apps/frontend/src/components/new-launch/providers/high.order.provider.tsx`
- Modify: `apps/frontend/src/components/new-launch/editor.tsx`

**Interfaces:**

- Consumes: serialized `integration.capabilities` and `intersectPlatformCapabilities()`.
- Produces: `resolveEditorCapabilities(current, selected)` and `getFormattingControls(capabilities)`.

- [ ] **Step 1: Write failing pure frontend tests**

```ts
import { describe, expect, it } from 'vitest';
import { getPlatformCapabilities } from '@gitroom/helpers/utils/platform.capabilities';
import {
  getFormattingControls,
  resolveEditorCapabilities,
} from './platform.editor.capabilities';

const selected = (id: string, provider: string) =>
  ({
    integration: {
      id,
      identifier: provider,
      capabilities: getPlatformCapabilities(provider),
    },
    settings: {},
  } as any);

it('uses selected-channel intersection in global mode', () => {
  const result = resolveEditorCapabilities('global', [
    selected('tg', 'telegram'),
    selected('vk', 'vk'),
  ]);
  expect(result.identifier).toBe('universal');
  expect(result.text.max).toBe(4096);
  expect(getFormattingControls(result)).toEqual(['bold', 'underline']);
});

it('uses the exact profile in platform-specific mode', () => {
  const result = resolveEditorCapabilities('tg', [
    selected('tg', 'telegram'),
    selected('vk', 'vk'),
  ]);
  expect(result.identifier).toBe('telegram');
  expect(result.text.mediaCaptionMax).toBe(1024);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run apps/frontend/src/components/new-launch/platform.editor.capabilities.spec.ts`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the pure resolver and toolbar list**

```ts
import { SelectedIntegrations } from './store';
import {
  intersectPlatformCapabilities,
  PlatformCapabilities,
} from '@gitroom/helpers/utils/platform.capabilities';

export type FormattingControl =
  | 'bold'
  | 'underline'
  | 'link'
  | 'list'
  | 'heading';

export const resolveEditorCapabilities = (
  current: string,
  selected: SelectedIntegrations[]
): PlatformCapabilities => {
  if (current === 'global') {
    return intersectPlatformCapabilities(
      selected.map((item) => item.integration.capabilities)
    );
  }
  return (
    selected.find((item) => item.integration.id === current)?.integration
      .capabilities || intersectPlatformCapabilities([])
  );
};

export const getFormattingControls = (
  capabilities: PlatformCapabilities
): FormattingControl[] =>
  [
    capabilities.formatting.bold !== 'unsupported' && 'bold',
    capabilities.formatting.underline !== 'unsupported' && 'underline',
    capabilities.formatting.links === 'native' && 'link',
    capabilities.formatting.lists === 'native' && 'list',
    capabilities.formatting.headings === 'native' && 'heading',
  ].filter(Boolean) as FormattingControl[];
```

In `EditorWrapper`, derive `capabilities` from `current` and
`selectedIntegration`, pass it to every `<Editor>`, and set `totalChars` to
`capabilities.text.max`. In `Editor`, replace the `editorType`/identifier toolbar
conditionals with the list from `getFormattingControls(capabilities)`.

In `withProvider`, prefer the registry value:

```ts
const resolvedMaximumCharacters =
  selectedIntegration.integration.capabilities?.text.max ??
  (typeof maximumCharacters === 'number'
    ? maximumCharacters
    : maximumCharacters(
        JSON.parse(selectedIntegration.integration.additionalSettings || '[]')
      ));
```

Use `resolvedMaximumCharacters` in `setChars`, `setTotalChars`, `isValid()`, and
preview props. This specifically removes the frontend VK `2048` versus backend
`16384` mismatch without requiring immediate edits to every provider component.

- [ ] **Step 4: Run focused frontend tests**

Run: `pnpm exec vitest run apps/frontend/src/components/new-launch/platform.editor.capabilities.spec.ts apps/frontend/src/components/new-launch/providers/telegram/telegram.preview.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/new-launch/platform.editor.capabilities.ts apps/frontend/src/components/new-launch/platform.editor.capabilities.spec.ts apps/frontend/src/components/new-launch/providers/high.order.provider.tsx apps/frontend/src/components/new-launch/editor.tsx
git commit -m "feat: make editor controls platform aware"
```

### Task 6: Show normalized delivery diagnostics and capability-aware counters

**Files:**

- Create: `apps/frontend/src/components/new-launch/platform.content.notice.tsx`
- Create: `apps/frontend/src/components/new-launch/platform.content.notice.spec.tsx`
- Modify: `apps/frontend/src/components/new-launch/editor.tsx`
- Modify: `apps/frontend/src/components/launches/information.component.tsx`
- Modify: `apps/frontend/src/components/launches/general.preview.component.tsx`
- Modify: `apps/frontend/src/components/new-launch/providers/telegram/telegram.preview.tsx`
- Modify: `apps/frontend/src/components/new-launch/providers/telegram/telegram.preview.spec.ts`

**Interfaces:**

- Consumes: `analyzePlatformContent()` and resolved editor capabilities.
- Produces: a reusable `PlatformContentNotice` and visible normalized delivery messages.

- [ ] **Step 1: Write the failing notice component test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlatformContentNotice } from './platform.content.notice';

it('renders information without marking the post invalid', () => {
  render(
    <PlatformContentNotice
      messages={[
        {
          severity: 'information',
          code: 'media-text-split',
          text: 'Media will be published first, followed by the full text as a separate message.',
        },
      ]}
    />
  );
  expect(screen.getByRole('status')).toHaveTextContent('separate message');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('renders blocking errors as alerts', () => {
  render(
    <PlatformContentNotice
      messages={[
        {
          severity: 'error',
          code: 'media-required',
          text: 'This platform requires media.',
        },
      ]}
    />
  );
  expect(screen.getByRole('alert')).toHaveTextContent('requires media');
});

it('offers a platform-specific copy for a universal warning', () => {
  const onCustomize = vi.fn();
  render(
    <PlatformContentNotice
      messages={[
        {
          platform: 'linkedin',
          severity: 'warning',
          code: 'formatting-loss',
          text: 'linkedin: Some formatting will be converted to plain text.',
        },
      ]}
      onCustomize={onCustomize}
    />
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Customize for linkedin' })
  );
  expect(onCustomize).toHaveBeenCalledWith('linkedin');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run apps/frontend/src/components/new-launch/platform.content.notice.spec.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the notice and connect analysis**

```tsx
import { PlatformContentMessage } from '@gitroom/helpers/utils/platform.content';

export const PlatformContentNotice = ({
  messages,
  onCustomize,
}: {
  messages: PlatformContentMessage[];
  onCustomize?: (platform: string) => void;
}) => (
  <div className="flex flex-col gap-2">
    {messages.map((message) => (
      <div
        key={`${message.severity}-${message.code}`}
        role={message.severity === 'error' ? 'alert' : 'status'}
        className={
          message.severity === 'error'
            ? 'rounded-md border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-200'
            : message.severity === 'warning'
            ? 'rounded-md border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200'
            : 'rounded-md border border-blue-400/40 bg-blue-400/10 p-3 text-sm text-blue-200'
        }
      >
        {message.text}
        {message.platform && message.severity === 'warning' && onCustomize && (
          <button
            type="button"
            className="ms-2 underline"
            onClick={() => onCustomize(message.platform!)}
          >
            Customize for {message.platform}
          </button>
        )}
      </div>
    ))}
  </div>
);
```

In `Editor`, calculate analysis with `props.value` and `props.pictures`. When
`identifier === 'global'`, call `analyzeSelectedPlatformContent()` with the
capabilities from `props.selectedIntegration`; otherwise call
`analyzePlatformContent()` with the resolved profile. Render
`PlatformContentNotice` below the editor. Pass the analysis to
`InformationComponent`; use `analysis.visibleLength` and
`capabilities.text.max` instead of independently stripping HTML.

In `EditorWrapper`, include the full `state.internal` array and `setCurrent` in
the store selector. Build the callback below and pass it through `Editor` to
`PlatformContentNotice` only in global mode:

```tsx
const customizePlatform = useCallback(
  (identifier: string) => {
    const target = selectedIntegration.find(
      (item) => item.integration.identifier === identifier
    );
    if (!target) return;
    if (
      !internalChannels.some(
        (item) => item.integration.id === target.integration.id
      )
    ) {
      addRemoveInternal(target.integration.id);
    }
    setCurrent(target.integration.id);
  },
  [selectedIntegration, internalChannels, addRemoveInternal, setCurrent]
);
```

This reuses the existing `addRemoveInternal()` copy behavior and never mutates
the universal source. Do not call `addRemoveInternal()` when a specific copy
already exists, because that method toggles and would delete it.

In `GeneralPreviewComponent`, replace the current unconditional normal-mode
conversion with the same shared normalization used at publish time:

```tsx
const canonicalContent = p.content.replace(
  /<span.*?data-mention-id="([.\s\S]*?)"[.\s\S]*?>([.\s\S]*?)<\/span>/gi,
  (_match, _id, label) => `[[[${label}]]]`
);
const newContent = normalizePlatformContent(
  canonicalContent,
  integration.capabilities
);
```

Import `normalizePlatformContent` from the shared helper. Keep the existing
mention highlighting and crop marker, but use
`integration.capabilities.text.max` as the primary limit. This makes the
specific-channel preview show the same HTML/plain-text conversion used by the
server. Existing custom LinkedIn and Pinterest previews already reduce content
to their plain-text presentation and remain unchanged.

Replace the bespoke Telegram warning implementation with the generic
`media-text-split` analysis while retaining a focused Telegram regression test.

- [ ] **Step 4: Run component, capability, and Telegram tests**

Run: `pnpm exec vitest run apps/frontend/src/components/new-launch/platform.content.notice.spec.tsx apps/frontend/src/components/new-launch/platform.editor.capabilities.spec.ts apps/frontend/src/components/new-launch/providers/telegram/telegram.preview.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/new-launch/platform.content.notice.tsx apps/frontend/src/components/new-launch/platform.content.notice.spec.tsx apps/frontend/src/components/new-launch/editor.tsx apps/frontend/src/components/launches/information.component.tsx apps/frontend/src/components/launches/general.preview.component.tsx apps/frontend/src/components/new-launch/providers/telegram/telegram.preview.tsx apps/frontend/src/components/new-launch/providers/telegram/telegram.preview.spec.ts
git commit -m "feat: preview platform delivery constraints"
```

### Task 7: Add the seven-platform regression matrix

**Files:**

- Create: `libraries/helpers/src/utils/platform.formatting.matrix.spec.ts`

**Interfaces:**

- Consumes: registry, normalization, diagnostics, and existing provider behavior.
- Produces: one auditable matrix showing the canonical post result for all active destinations.

- [ ] **Step 1: Add the cross-platform matrix test**

```ts
import { describe, expect, it } from 'vitest';
import { getPlatformCapabilities } from './platform.capabilities';
import { analyzePlatformContent } from './platform.content';
import { MaxProvider } from '@gitroom/nestjs-libraries/integrations/social/max.provider';
import { TumblrProvider } from '@gitroom/nestjs-libraries/integrations/social/tumblr.provider';
import { VkGroupProvider } from '@gitroom/nestjs-libraries/integrations/social/vk.group.provider';

const active = [
  'telegram',
  'max',
  'linkedin',
  'tumblr',
  'pinterest',
  'vk',
  'vk-group',
];
const canonical =
  '<h1>Launch</h1><p><strong>Bold</strong> and <u>underlined</u></p><ul><li>One</li><li>Two</li></ul>';

describe.each(active)('%s formatting matrix', (identifier) => {
  it('normalizes deterministically and stays under its configured limit', () => {
    const analysis = analyzePlatformContent({
      content: canonical,
      media: identifier === 'pinterest' ? [{ type: 'image' }] : [],
      capabilities: getPlatformCapabilities(identifier),
    });
    expect(analysis.normalized).toMatchSnapshot();
    expect(
      analysis.messages.filter((item) => item.severity === 'error')
    ).toEqual([]);
  });
});

it.each([
  ['telegram', 4096],
  ['max', 4000],
  ['linkedin', 3000],
  ['tumblr', 32768],
  ['pinterest', 500],
  ['vk', 16384],
  ['vk-group', 16384],
] as const)('%s accepts its limit and rejects limit + 1', (identifier, max) => {
  const capabilities = getPlatformCapabilities(identifier);
  const media = identifier === 'pinterest' ? [{ type: 'image' as const }] : [];
  expect(
    analyzePlatformContent({
      content: `<p>${'a'.repeat(max)}</p>`,
      media,
      capabilities,
    }).blocking
  ).toBe(false);
  expect(
    analyzePlatformContent({
      content: `<p>${'a'.repeat(max + 1)}</p>`,
      media,
      capabilities,
    }).messages
  ).toContainEqual(expect.objectContaining({ code: 'text-too-long' }));
});

it('splits a Telegram media caption only above 1024 visible characters', () => {
  const capabilities = getPlatformCapabilities('telegram');
  expect(
    analyzePlatformContent({
      content: `<p>${'a'.repeat(1024)}</p>`,
      media: [{ type: 'image' }],
      capabilities,
    }).messages
  ).not.toContainEqual(expect.objectContaining({ code: 'media-text-split' }));
  expect(
    analyzePlatformContent({
      content: `<p>${'a'.repeat(1025)}</p>`,
      media: [{ type: 'image' }],
      capabilities,
    }).messages
  ).toContainEqual(expect.objectContaining({ code: 'media-text-split' }));
});

it('keeps detailed media rules in providers', async () => {
  expect(
    await new MaxProvider().checkValidity([
      [{ path: 'clip.mp4', type: 'video' }],
    ])
  ).toBe('Video posting to MAX is not supported yet.');

  expect(
    await new TumblrProvider().checkValidity([
      Array.from({ length: 31 }, (_, index) => ({
        path: `image-${index}.jpg`,
        type: 'image' as const,
      })),
    ])
  ).toBe('Tumblr supports up to 30 images in one post.');

  expect(
    await new VkGroupProvider().checkValidity([
      Array.from({ length: 11 }, (_, index) => ({
        path: `image-${index}.jpg`,
        type: 'image' as const,
      })),
    ])
  ).toBe('VK Group supports up to 10 photographs per post.');
});
```

The provider assertions make no network calls; they verify detailed constraints
without duplicating the provider implementation inside the generic registry.

- [ ] **Step 2: Run the matrix and update snapshots once**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.formatting.matrix.spec.ts -u`

Expected: PASS and create one reviewed snapshot file. Inspect every snapshot;
do not accept tags or text that the target provider would remove later.

- [ ] **Step 3: Run all focused provider and editor tests without snapshot updates**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.capabilities.spec.ts libraries/helpers/src/utils/platform.content.spec.ts libraries/helpers/src/utils/platform.formatting.matrix.spec.ts apps/frontend/src/components/new-launch/platform.editor.capabilities.spec.ts apps/frontend/src/components/new-launch/platform.content.notice.spec.tsx apps/frontend/src/components/new-launch/providers/telegram/telegram.preview.spec.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts`

Expected: PASS with no snapshot changes.

- [ ] **Step 4: Commit**

```bash
git add libraries/helpers/src/utils/platform.formatting.matrix.spec.ts libraries/helpers/src/utils/__snapshots__/platform.formatting.matrix.spec.ts.snap
git commit -m "test: cover active platform formatting matrix"
```

### Task 8: Final verification and manual acceptance handoff

**Files:**

- Modify only files required by failures found in this task.

**Interfaces:**

- Consumes: the complete feature.
- Produces: build/test evidence and an authenticated manual checklist.

- [ ] **Step 1: Run formatting checks on changed TypeScript and Markdown**

Run: `pnpm exec prettier --check libraries/helpers/src/utils/platform.* apps/frontend/src/components/new-launch/platform.* docs/superpowers/specs/2026-08-15-platform-aware-post-formatting-design.md docs/superpowers/plans/2026-08-15-platform-aware-editor.md`

Expected: PASS.

- [ ] **Step 2: Run the focused regression suite**

Run the Task 7 focused Vitest command again.

Expected: PASS.

- [ ] **Step 3: Run workspace type/build verification**

Run: `pnpm run build`

Expected: frontend, backend, and orchestrator builds all succeed.

- [ ] **Step 4: Run the full test suite**

Run: `pnpm test`

Expected: PASS. Record any pre-existing unrelated failure separately; do not
weaken tests or change unrelated code to conceal it.

- [ ] **Step 5: Prepare the manual authenticated checklist**

Provide these checks to the user after deployment:

```text
1. Select Telegram + VK: universal toolbar shows only their common controls and a 4096 limit.
2. Switch to VK: the limit changes to 16384 without altering source content.
3. Switch to Telegram, attach media, and enter 1025 visible characters: preview says media and text will be two messages.
4. Select Pinterest without media: publishing is blocked with a clear media-required message.
5. Add a Pinterest image and required board: validation succeeds.
6. Switch between universal and specific versions: formatting is never silently deleted.
```

- [ ] **Step 6: Commit any verification-only corrections**

If verification required corrections, stage only those files and commit:

```bash
git commit -m "fix: address platform formatting verification"
```

If no files changed, do not create an empty commit.
