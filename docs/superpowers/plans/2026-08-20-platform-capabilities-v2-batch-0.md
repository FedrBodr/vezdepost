# Platform Capabilities V2 Batch 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the V1 capability model with the V2 contract and migrate the first seven verified destinations plus LinkedIn Page, Slack, TikTok, and Mastodon to a field-, variant-, unit-, and runtime-aware resolver.

**Architecture:** Small dependency-light helper modules define the V2 contract, measurements, Batch 0 profiles, deterministic variant selection, normalization, and diagnostics. The integration manager supplies server-trusted runtime overlays, while frontend, persistence validation, and orchestrator publication all resolve the same immutable profile from destination, settings, and media. Destinations outside Batch 0 remain usable only through a named unverified adapter bridge.

**Tech Stack:** TypeScript 5.5, React 19, Next.js 16, Zustand, TipTap 3, NestJS 11, Vitest 3, pnpm 10.

## Global Constraints

- Work in the existing isolated worktree `platform-aware-post-formatting`.
- Dependencies are already bootstrapped; if the workspace bootstrap becomes invalid, run `pnpm install --frozen-lockfile` followed by `pnpm run verify:workspace` before testing.
- Use only pnpm and add no dependencies.
- Keep canonical editor content as HTML; derive provider output without writing it back into the source.
- No database migration or historical content conversion is performed.
- Limits declare `graphemes`, `utf16-code-units`, `utf8-bytes`, or `weighted` explicitly.
- Limit sources are `platform`, `runtime`, or `application-safety`; application safety limits are never labeled as official platform limits.
- Backend resolution and validation are authoritative; client metadata cannot raise limits or mark a profile verified.
- Unknown and not-yet-migrated destinations use the explicit `unverified-adapter` bridge.
- Preserve correct user-facing behavior for Telegram, MAX, LinkedIn, Tumblr, Pinterest, VK, and VK Group, allowing evidence-backed corrections.
- Do not push, merge, release, deploy, or change production state.

---

## File Structure

- `libraries/helpers/src/utils/platform.capability.types.ts` — V2 declarations and resolution input/output types.
- `libraries/helpers/src/utils/platform.content.measurement.ts` — unit-aware counters and limit measurements.
- `libraries/helpers/src/utils/platform.capability.profiles.ts` — immutable Batch 0 profiles, alias metadata, and bridge factory.
- `libraries/helpers/src/utils/platform.capability.resolver.ts` — deterministic variant selection and trusted runtime overlay application.
- `libraries/helpers/src/utils/platform.content.normalizers.ts` — dialect-selected normalized field output.
- `libraries/helpers/src/utils/platform.content.analysis.ts` — structured V2 diagnostics for fields and media.
- Matching `*.spec.ts` files beside each helper — focused contract tests.
- `libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts` — provider capability source and trusted runtime overlay interfaces.
- `libraries/nestjs-libraries/src/integrations/integration.manager.ts` — server-side V2 resolution entry point.
- `libraries/nestjs-libraries/src/integrations/social/{slack,tiktok,mastodon}.provider.ts` — corrected adapter limits and runtime declarations.
- `apps/backend/src/api/routes/integrations.controller.ts` — serialized resolved V2 summary for connected integrations.
- `apps/frontend/src/components/launches/calendar.context.tsx` — frontend V2 integration metadata type.
- `apps/frontend/src/components/new-launch/platform.editor.capabilities.ts` — selected-target resolution and editor controls.
- `apps/frontend/src/components/new-launch/editor.tsx` — field/unit counters and capability-driven toolbar.
- `apps/frontend/src/components/new-launch/platform.content.notice.tsx` — structured diagnostic rendering.
- `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts` — authoritative pre-persistence analysis.
- `apps/orchestrator/src/activities/post.activity.ts` — trusted re-resolution and pre-network validation.
- Existing focused specs beside all changed consumers — regression coverage.
- Remove `libraries/helpers/src/utils/platform.capabilities.ts` and `libraries/helpers/src/utils/platform.content.ts` after all imports move to V2 modules.

### Task 1: Define V2 types and unit-aware measurement

**Files:**

- Create: `libraries/helpers/src/utils/platform.capability.types.ts`
- Create: `libraries/helpers/src/utils/platform.content.measurement.ts`
- Create: `libraries/helpers/src/utils/platform.content.measurement.spec.ts`

**Interfaces:**

- Produces: `ContentUnit`, `ContentLimit`, `FormattingDialect`, `TextFieldCapability`, `MediaRule`, `PostVariantCapability`, `PlatformCapabilityProfileV2`, `CapabilityResolutionContext`, `ResolvedPlatformCapabilityV2`, `measureContent(value, limit)`.
- Consumes: existing `weightedLength(value)` for the named `x-weighted` counter.

- [ ] **Step 1: Write failing measurement contract tests**

```ts
import { describe, expect, it } from 'vitest';
import { measureContent } from './platform.content.measurement';

describe('measureContent', () => {
  it.each([
    ['graphemes', '👨‍👩‍👧‍👦a', 2],
    ['utf16-code-units', '😀a', 3],
    ['utf8-bytes', '😀a', 5],
  ] as const)('measures %s exactly', (unit, value, measured) => {
    expect(
      measureContent(value, { max: measured, unit, source: 'platform' })
    ).toEqual({ measured, exceeded: false });
  });

  it('delegates weighted limits to the declared counter', () => {
    expect(
      measureContent('https://example.com/' + 'x'.repeat(80), {
        max: 280,
        unit: 'weighted',
        counter: 'x-weighted',
        source: 'runtime',
      }).measured
    ).toBeLessThan(105);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the missing-module failure**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.content.measurement.spec.ts`

Expected: FAIL because `platform.content.measurement.ts` does not exist.

- [ ] **Step 3: Add the complete V2 type vocabulary**

```ts
export type ContentUnit =
  | 'graphemes'
  | 'utf16-code-units'
  | 'utf8-bytes'
  | 'weighted';
export type LimitSource = 'platform' | 'runtime' | 'application-safety';
export type WeightedCounter = 'x-weighted';
export type FormattingDialect =
  | 'plain'
  | 'html'
  | 'markdown'
  | 'slack-mrkdwn'
  | 'discord-markdown'
  | 'bluesky-facets';
export type FormattingSupport = 'native' | 'unicode' | 'plain' | 'unsupported';

export interface ContentLimit {
  max: number;
  unit: ContentUnit;
  source: LimitSource;
  recommendedMax?: number;
  counter?: WeightedCounter;
}

export interface TextFieldCapability {
  key: string;
  label: string;
  required: boolean;
  source: 'canonical-editor' | 'provider-setting';
  dialect: FormattingDialect;
  limit?: ContentLimit;
  formatting: Record<
    'bold' | 'underline' | 'links' | 'lists' | 'headings',
    FormattingSupport
  >;
}

export interface StructuredFieldCapability {
  key: string;
  label: string;
  required: boolean;
}

export type StaticMediaRule =
  | { type: 'none' }
  | {
      type: 'optional' | 'required';
      images?: { min: number; max: number };
      videos?: { min: number; max: number; coverRequired?: boolean };
      mixed?: boolean;
    }
  | {
      type: 'exclusive';
      alternatives: Array<
        | { kind: 'images'; min: number; max: number }
        | { kind: 'video'; min: 1; max: 1; coverRequired?: boolean }
      >;
    };

export type MediaRule =
  | StaticMediaRule
  | { type: 'provider-runtime'; fallback: StaticMediaRule };

export interface PostVariantCapability {
  key: string;
  fields: TextFieldCapability[];
  structuredFields: StructuredFieldCapability[];
  media: MediaRule;
  delivery: {
    longMediaText: 'caption' | 'split-after-media' | 'not-applicable';
    stripRawUrls: boolean;
  };
}

export interface PlatformCapabilityProfileV2 {
  identifier: string;
  displayName: string;
  verification: 'verified' | 'runtime' | 'unverified-adapter';
  evidenceDate: string;
  defaultVariant: string;
  variants: Readonly<Record<string, PostVariantCapability>>;
  aliasOf?: string;
  runtimeKeys?: readonly ('text-limit' | 'media-rule')[];
  runtimeMaxAgeSeconds?: number;
}

export interface CapabilityRuntimeOverlay {
  observedAt: string;
  textLimits?: Readonly<Record<string, ContentLimit>>;
  mediaRule?: MediaRule;
}

export interface CapabilityResolutionContext {
  identifier: string;
  settings: Readonly<Record<string, unknown>>;
  media: ReadonlyArray<{ type?: 'image' | 'video' }>;
  runtimeOverlay?: CapabilityRuntimeOverlay;
  now?: string;
  adapter?: {
    editor: 'none' | 'normal' | 'markdown' | 'html';
    maximum: number;
    stripRawUrls: boolean;
  };
}

export interface ResolvedPlatformCapabilityV2 {
  identifier: string;
  profileIdentifier: string;
  verification: PlatformCapabilityProfileV2['verification'];
  evidenceDate: string;
  variant: string;
  fields: readonly TextFieldCapability[];
  media: MediaRule;
  delivery: PostVariantCapability['delivery'];
  runtimeOverlay?: CapabilityRuntimeOverlay;
  runtimeObservedAt?: string;
  diagnostics: readonly CapabilityDiagnostic[];
}

export interface CapabilityDiagnostic {
  code: string;
  severity: 'information' | 'warning' | 'error';
  destination: string;
  variant: string;
  field?: string;
  measured?: number;
  limit?: number;
  unit?: ContentUnit;
  message: string;
}
```

- [ ] **Step 4: Implement deterministic counters**

Use `Intl.Segmenter` with `granularity: 'grapheme'`, `value.length` for UTF-16 units, `new TextEncoder().encode(value).length` for UTF-8 bytes, and `weightedLength(value)` for `x-weighted`. Reject a weighted limit without `counter: 'x-weighted'` with `new Error('Weighted content limit requires a supported counter')`.

- [ ] **Step 5: Run focused tests and type-check the helper package through Vitest**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.content.measurement.spec.ts`

Expected: PASS with 4 tests.

- [ ] **Step 6: Commit the contract**

```bash
git add libraries/helpers/src/utils/platform.capability.types.ts libraries/helpers/src/utils/platform.content.measurement.ts libraries/helpers/src/utils/platform.content.measurement.spec.ts
git commit -m "feat: define platform capabilities v2 contract"
```

### Task 2: Add Batch 0 profiles, variants, aliases, and bridge resolution

**Files:**

- Create: `libraries/helpers/src/utils/platform.capability.profiles.ts`
- Create: `libraries/helpers/src/utils/platform.capability.resolver.ts`
- Create: `libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
- Test: `libraries/helpers/src/utils/platform.formatting.matrix.spec.ts`

**Interfaces:**

- Consumes: all types from Task 1.
- Produces: `BATCH_0_IDENTIFIERS`, `resolvePlatformCapabilityV2(context)`, `createUnverifiedAdapterProfile(context)`.

- [ ] **Step 1: Write failing registry and resolution tests**

Cover all of these assertions in one table-driven spec:

```ts
expect(resolvePlatformCapabilityV2(ctx('linkedin-page'))).toMatchObject({
  identifier: 'linkedin-page',
  profileIdentifier: 'linkedin',
  variant: 'feed',
});
expect(resolvePlatformCapabilityV2(ctx('slack')).fields[0].limit).toEqual({
  max: 40_000,
  recommendedMax: 4_000,
  unit: 'utf16-code-units',
  source: 'platform',
});
expect(
  resolvePlatformCapabilityV2(ctx('tiktok', [{ type: 'video' }]))
).toMatchObject({ variant: 'video' });
expect(
  resolvePlatformCapabilityV2(ctx('tiktok', [{ type: 'image' }]))
).toMatchObject({ variant: 'photo' });
expect(resolvePlatformCapabilityV2(ctx('mastodon'))).toMatchObject({
  verification: 'runtime',
  fields: [
    expect.objectContaining({
      limit: expect.objectContaining({
        max: 500,
        source: 'application-safety',
      }),
    }),
  ],
});
expect(resolvePlatformCapabilityV2(ctx('youtube'))).toMatchObject({
  verification: 'unverified-adapter',
  variant: 'adapter',
});
```

Also freeze the supplied settings, media, and runtime overlay and assert that resolution does not mutate any of them.

- [ ] **Step 2: Run the resolver spec and confirm the missing-module failure**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.capability.resolver.spec.ts`

Expected: FAIL because the resolver does not exist.

- [ ] **Step 3: Declare the Batch 0 profile map**

Create profiles for `telegram`, `max`, `linkedin`, `tumblr`, `pinterest`, `vk`, `vk-group`, `slack`, `tiktok`, and `mastodon`, plus the `linkedin-page` alias. Encode these exact corrections:

- Telegram body 4,096 graphemes, media caption 1,024 graphemes, HTML normalization, split-after-media delivery.
- MAX body 4,000 graphemes, HTML normalization.
- LinkedIn and LinkedIn Page body 3,000 graphemes, plain delivery.
- Tumblr body 32,768 graphemes and structured `title`, `link`, `sourceUrl`, and `tags` settings.
- Pinterest body 500 graphemes, media required, up to five images or one video with cover, `board` required.
- VK body 16,384 graphemes; VK Group body 16,384 graphemes and images only, maximum ten.
- Slack body 40,000 UTF-16 units with 4,000 recommendation and `slack-mrkdwn` dialect.
- TikTok `video` caption 2,200 UTF-16 units; `photo` title 90 UTF-16 units and description 4,000 UTF-16 units; exactly one video or one-to-35 images.
- Mastodon body fallback 500 graphemes with source `application-safety`, `runtimeKeys: ['text-limit', 'media-rule']`, and `contentWarning` as a structured setting.

- [ ] **Step 4: Implement deterministic selection and trusted overlay replacement**

Selection rules are exact: TikTok chooses `video` only when the single media item is a video and `photo` when every selected item is an image; invalid mixed/empty input resolves to the default `video` variant and emits `invalid-media-variant`. All other Batch 0 profiles select their default variant. Runtime overlays replace only keys named by the profile, preserve the runtime source, and never change verification state. Treat Mastodon data older than its declared `runtimeMaxAgeSeconds` as stale, compare against injected `context.now` in tests, and fall back with `runtime-data-missing`. Alias resolution retains the requested identifier.

- [ ] **Step 5: Implement the explicit adapter bridge**

Map `none` to plain unsupported formatting, `normal` to plain formatting, `markdown` to Markdown, and `html` to HTML. Use one canonical `body` field whose limit is `{ max: adapter.maximum, unit: 'utf16-code-units', source: 'application-safety' }`, variant `adapter`, verification `unverified-adapter`, optional media, and the adapter's URL-stripping flag.

- [ ] **Step 6: Run resolver and first-wave matrix tests**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/helpers/src/utils/platform.formatting.matrix.spec.ts`

Expected: PASS; the seven first-wave snapshots retain their effective output.

- [ ] **Step 7: Commit profiles and resolution**

```bash
git add libraries/helpers/src/utils/platform.capability.profiles.ts libraries/helpers/src/utils/platform.capability.resolver.ts libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/helpers/src/utils/platform.formatting.matrix.spec.ts libraries/helpers/src/utils/__snapshots__/platform.formatting.matrix.spec.ts.snap
git commit -m "feat: resolve batch zero platform profiles"
```

### Task 3: Normalize fields and emit structured diagnostics

**Files:**

- Create: `libraries/helpers/src/utils/platform.content.normalizers.ts`
- Create: `libraries/helpers/src/utils/platform.content.normalizers.spec.ts`
- Create: `libraries/helpers/src/utils/platform.content.analysis.ts`
- Create: `libraries/helpers/src/utils/platform.content.analysis.spec.ts`
- Reuse: `libraries/helpers/src/utils/verified.html.normalization.ts`
- Reuse: `libraries/helpers/src/utils/html.structure.ts`
- Reuse: `libraries/helpers/src/utils/strip.html.validation.ts`

**Interfaces:**

- Consumes: `ResolvedPlatformCapabilityV2`, canonical HTML, provider settings, media, and `measureContent`.
- Produces: `normalizePlatformFields(input)` and `analyzePlatformContentV2(input)`.

- [ ] **Step 1: Write failing normalization tests**

```ts
expect(
  normalizePlatformFields({
    canonicalHtml: '<p>Hello <strong>world</strong></p>',
    settings: {},
    capability: telegram,
  })
).toEqual({
  body: { value: 'Hello <b>world</b>', facets: undefined },
});
expect(
  normalizePlatformFields({
    canonicalHtml: '<p>Hello <strong>world</strong></p>',
    settings: {},
    capability: slack,
  })
).toEqual({
  body: { value: 'Hello *world*', facets: undefined },
});
expect(
  normalizePlatformFields({
    canonicalHtml: '<p>Caption</p>',
    settings: { title: 'Photo title' },
    capability: tiktokPhoto,
  })
).toEqual({
  title: { value: 'Photo title', facets: undefined },
  description: { value: 'Caption', facets: undefined },
});
```

Retain escaped-tag, raw-URL stripping, mention conversion, paragraph, list, and heading regressions from `platform.content.spec.ts`.

- [ ] **Step 2: Write failing diagnostic tests**

Assert full diagnostic payloads for `text-too-long`, `recommended-limit-exceeded`, `required-field-missing`, `runtime-data-missing`, `unsupported-media`, `invalid-media-variant`, `formatting-loss`, and `media-text-split`. Each expected object includes destination, variant, field where applicable, measured, limit, unit, severity, and user-facing message.

- [ ] **Step 3: Run both specs and confirm missing-module failures**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.content.normalizers.spec.ts libraries/helpers/src/utils/platform.content.analysis.spec.ts`

Expected: FAIL because the V2 content modules do not exist.

- [ ] **Step 4: Implement dialect-selected normalization**

Reuse verified Telegram/MAX HTML normalization. Plain output preserves visible text, line boundaries, and raw URLs unless delivery explicitly strips them. Implement a deterministic HTML-to-Markdown traversal for paragraphs, strong text, links, ordered/unordered lists, and headings; parameterize the same traversal for Slack `*bold*` and `_italic_` syntax without treating it as CommonMark. Return `Readonly<Record<string, { value: string; facets?: readonly unknown[] }>>` keyed by field.

- [ ] **Step 5: Implement field and media analysis**

Measure each normalized field with its declared unit. Emit `recommended-limit-exceeded` as a warning and `text-too-long` as an error. Validate required provider settings and the media union. Merge resolver diagnostics without changing their destination or variant. Return `{ fields, diagnostics, blocking }`, where `blocking` is true when any diagnostic severity is `error`.

- [ ] **Step 6: Run V2 and first-wave normalization regressions**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.content.normalizers.spec.ts libraries/helpers/src/utils/platform.content.analysis.spec.ts libraries/helpers/src/utils/platform.content.spec.ts libraries/helpers/src/utils/platform.formatting.matrix.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit normalization and diagnostics**

```bash
git add libraries/helpers/src/utils/platform.content.normalizers.ts libraries/helpers/src/utils/platform.content.normalizers.spec.ts libraries/helpers/src/utils/platform.content.analysis.ts libraries/helpers/src/utils/platform.content.analysis.spec.ts
git commit -m "feat: analyze normalized platform fields"
```

### Task 4: Expose server-trusted resolution and correct adapters

**Files:**

- Modify: `libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/integration.manager.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/slack.provider.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/tiktok.provider.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/mastodon.provider.ts`
- Modify: `apps/backend/src/api/routes/integrations.controller.ts`
- Test: `apps/backend/src/api/routes/integrations.controller.spec.ts`

**Interfaces:**

- Consumes: `resolvePlatformCapabilityV2(context)` from Task 2.
- Produces: async `IntegrationManager.resolveCapabilitiesV2({ providerName, settings, media, integration })` and serialized `capabilitiesV2` integration metadata.

- [ ] **Step 1: Write failing manager tests**

Test LinkedIn Page aliasing, Slack's 40,000/4,000 limits, TikTok media variant selection, Mastodon's safe fallback warning, a valid Mastodon runtime response, and an attempted client limit escalation that is ignored because runtime data comes only from the provider method.

- [ ] **Step 2: Run focused manager/controller tests and observe V1-shaped failures**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts apps/backend/src/api/routes/integrations.controller.spec.ts`

Expected: FAIL because `resolveCapabilitiesV2` and `capabilitiesV2` do not exist.

- [ ] **Step 3: Add provider declarations and manager resolution**

Add optional `fetchCapabilityRuntime?(integration: Integration): Promise<CapabilityRuntimeOverlay | undefined>` to `SocialProvider`. Make `resolveCapabilitiesV2` async: it obtains the provider, constructs the bridge only from server-side adapter `editor`, `maxLength(settings)`, and `stripLinks()`, awaits the provider runtime method only when a stored integration is supplied, and never reads capability limits or verification flags from post settings.

- [ ] **Step 4: Correct current adapter limits**

Change `SlackProvider.maxLength()` from `400000` to `40000` and `TiktokProvider.maxLength()` from `2000` to `2200`. Keep `MastodonProvider.maxLength()` at 500 as the conservative adapter fallback. Implement `MastodonProvider.fetchCapabilityRuntime()` by requesting `${process.env.MASTODON_URL || 'https://mastodon.social'}/api/v2/instance`, then map `configuration.statuses.max_characters` to the `body` runtime limit and `configuration.statuses.max_media_attachments` to the runtime media maximum. Return `undefined` for a malformed response so resolution keeps the safe fallback warning.

- [ ] **Step 5: Serialize V2 metadata**

Return `capabilitiesV2` from `/integrations` by awaiting manager resolution with provider identifier, parsed provider settings, empty media, and the stored integration. Include the applied runtime overlay in this immutable response so the browser can reselect a media-dependent variant locally; treat it as advisory on the client. Do not accept a capability profile, runtime overlay, or verification flag from request data.

- [ ] **Step 6: Run manager, controller, and provider validation tests**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts apps/backend/src/api/routes/integrations.controller.spec.ts libraries/nestjs-libraries/src/integrations/social/tiktok.provider.spec.ts libraries/nestjs-libraries/src/integrations/social/mastodon.provider.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit server metadata and adapter corrections**

```bash
git add libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts libraries/nestjs-libraries/src/integrations/integration.manager.ts libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts libraries/nestjs-libraries/src/integrations/social/slack.provider.ts libraries/nestjs-libraries/src/integrations/social/tiktok.provider.ts libraries/nestjs-libraries/src/integrations/social/mastodon.provider.ts libraries/nestjs-libraries/src/integrations/social/mastodon.provider.spec.ts apps/backend/src/api/routes/integrations.controller.ts apps/backend/src/api/routes/integrations.controller.spec.ts
git commit -m "feat: expose trusted platform capability resolution"
```

### Task 5: Drive editor controls, counters, and notices from V2

**Files:**

- Modify: `apps/frontend/src/components/launches/calendar.context.tsx`
- Modify: `apps/frontend/src/components/new-launch/platform.editor.capabilities.ts`
- Modify: `apps/frontend/src/components/new-launch/platform.editor.capabilities.spec.ts`
- Modify: `apps/frontend/src/components/new-launch/editor.tsx`
- Modify: `apps/frontend/src/components/new-launch/editor.schema.spec.tsx`
- Modify: `apps/frontend/src/components/new-launch/platform.content.notice.tsx`
- Modify: `apps/frontend/src/components/new-launch/platform.content.notice.spec.tsx`
- Modify: `apps/frontend/src/components/launches/information.component.tsx`
- Modify: `apps/frontend/src/components/launches/information.component.spec.tsx`

**Interfaces:**

- Consumes: serialized `ResolvedPlatformCapabilityV2`, `resolvePlatformCapabilityV2`, and `analyzePlatformContentV2`.
- Produces: `resolveEditorCapabilityV2(current, selected, internal, content, media)` and V2-driven editor UI.

- [ ] **Step 1: Write failing editor behavior tests**

Assert that Telegram shows native bold/underline, LinkedIn uses Unicode fallbacks without a link button, Slack exposes its own dialect controls and recommended-limit warning, TikTok changes from video caption to photo title/description when media changes, Mastodon shows an unverified runtime warning without connected runtime data, and LinkedIn Page renders like LinkedIn while retaining its destination identifier.

- [ ] **Step 2: Run focused frontend tests and observe type/behavior failures**

Run: `pnpm exec vitest run apps/frontend/src/components/new-launch/platform.editor.capabilities.spec.ts apps/frontend/src/components/new-launch/editor.schema.spec.tsx apps/frontend/src/components/new-launch/platform.content.notice.spec.tsx apps/frontend/src/components/launches/information.component.spec.tsx`

Expected: FAIL because consumers still use V1 `PlatformCapabilities` and anonymous `text.max`.

- [ ] **Step 3: Replace frontend integration metadata and selection helpers**

Change `Integrations.capabilities` to `capabilitiesV2?: ResolvedPlatformCapabilityV2`. Resolve each selected integration from its identifier, current provider settings, current media, and `capabilitiesV2.runtimeOverlay`; never reuse the server's empty-media TikTok variant after media changes. For the global editor, expose only formatting controls supported by every selected canonical-editor field and show per-destination counters when units or field keys differ.

- [ ] **Step 4: Render field-aware counters and diagnostics**

Replace `capabilities.text.max` reads with the active canonical-editor field's `ContentLimit`. Label counters with their units when they are not graphemes. Render recommendation warnings separately from blocking errors. Preserve the existing Customize action for destination warnings.

- [ ] **Step 5: Keep the canonical HTML editor stable across variants**

Build the TipTap extension policy from semantic formatting support, not output dialect. Variant changes may alter buttons, counters, and structured setting fields but must not rewrite `props.value` or recreate the editor unless the semantic extension set changes.

- [ ] **Step 6: Run focused frontend and first-wave regression tests**

Run: `pnpm exec vitest run apps/frontend/src/components/new-launch/platform.editor.capabilities.spec.ts apps/frontend/src/components/new-launch/editor.schema.spec.tsx apps/frontend/src/components/new-launch/platform.content.notice.spec.tsx apps/frontend/src/components/launches/information.component.spec.tsx apps/frontend/src/components/launches/general.preview.component.spec.tsx`

Expected: PASS.

- [ ] **Step 7: Commit V2 editor consumption**

```bash
git add apps/frontend/src/components/launches/calendar.context.tsx apps/frontend/src/components/new-launch/platform.editor.capabilities.ts apps/frontend/src/components/new-launch/platform.editor.capabilities.spec.ts apps/frontend/src/components/new-launch/editor.tsx apps/frontend/src/components/new-launch/editor.schema.spec.tsx apps/frontend/src/components/new-launch/platform.content.notice.tsx apps/frontend/src/components/new-launch/platform.content.notice.spec.tsx apps/frontend/src/components/launches/information.component.tsx apps/frontend/src/components/launches/information.component.spec.tsx
git commit -m "feat: drive editor diagnostics from capabilities v2"
```

### Task 6: Enforce V2 before persistence and provider network calls

**Files:**

- Modify: `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts`
- Modify: `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts`
- Modify: `apps/orchestrator/src/activities/post.activity.ts`
- Modify: `apps/orchestrator/src/activities/post.activity.formatting.spec.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts`

**Interfaces:**

- Consumes: server-trusted `resolveCapabilitiesV2` and `analyzePlatformContentV2`.
- Produces: normalized `PostDetails.fields` plus the existing `message` compatibility value consumed by Batch 0 adapters.

- [ ] **Step 1: Write failing backend authority tests**

Cover: forged client capability metadata cannot raise Slack's limit; TikTok photo and video select different limits from persisted media; missing required Pinterest media blocks persistence; Mastodon runtime data can lower but not be spoofed to raise the server limit; a deterministic violation prevents `provider.post` and `provider.comment` from being called.

- [ ] **Step 2: Run persistence and activity tests and observe missing V2 enforcement**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts apps/orchestrator/src/activities/post.activity.formatting.spec.ts`

Expected: FAIL because both paths still analyze V1 content and the activity normalizes without blocking.

- [ ] **Step 3: Add structured normalized fields to provider input**

Extend `PostDetails` with `fields?: Readonly<Record<string, { value: string; facets?: readonly unknown[] }>>`. Set `message` to `fields.body?.value ?? fields.caption?.value ?? fields.description?.value ?? ''` so existing Batch 0 adapters continue receiving the field they already publish while TikTok can consume its explicit field during its migration.

- [ ] **Step 4: Replace persistence validation**

Resolve from the stored provider identifier, stored post settings, stored media, and server-trusted runtime overlay. Analyze all normalized fields and throw the first blocking diagnostic message while preserving the existing legacy too-long error only for destinations still on the unverified adapter bridge.

- [ ] **Step 5: Re-resolve immediately before publication**

After `updateTags` and `updateMedia`, parse settings, resolve V2 again, analyze, and throw before calling the provider when blocking. Pass both normalized fields and the derived message to `post` and `comment`. Do not trust serialized frontend capabilities.

- [ ] **Step 6: Run focused server tests**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts apps/orchestrator/src/activities/post.activity.formatting.spec.ts apps/orchestrator/src/activities/post.activity.spec.ts`

Expected: PASS and provider spies remain uncalled for blocking cases.

- [ ] **Step 7: Commit authoritative enforcement**

```bash
git add libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts apps/orchestrator/src/activities/post.activity.ts apps/orchestrator/src/activities/post.activity.formatting.spec.ts
git commit -m "feat: enforce capabilities v2 before publishing"
```

### Task 7: Remove V1, prove the 36-destination bridge matrix, and verify Batch 0

**Files:**

- Delete: `libraries/helpers/src/utils/platform.capabilities.ts`
- Delete: `libraries/helpers/src/utils/platform.content.ts`
- Delete or rewrite: `libraries/helpers/src/utils/platform.capabilities.spec.ts`
- Delete or rewrite: `libraries/helpers/src/utils/platform.content.spec.ts`
- Modify every remaining import reported by `rg "platform\.capabilities|platform\.content" apps libraries`.
- Create: `libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`
- Modify: `docs/content/platform-capability-audit.md`
- Modify: `docs/superpowers/specs/2026-08-20-platform-capabilities-v2-design.md`

**Interfaces:**

- Consumes: all Batch 0 V2 modules.
- Produces: no V1 imports, an exact registered-destination resolution matrix, and a documented Batch 0 pause point.

- [ ] **Step 1: Write the failing 36-destination matrix**

Map identifiers directly from the exported `socialIntegrationList`, resolve them through `IntegrationManager.resolveCapabilitiesV2`, and assert exactly 36 unique identifiers. The 11 Batch 0 identifiers resolve without the bridge and every other identifier resolves with `verification: 'unverified-adapter'`. Assert no identifier silently resolves to another destination except the explicit `linkedin-page` alias.

- [ ] **Step 2: Run the matrix before cleanup**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`

Expected: FAIL until the test receives the registered inventory and all V2 bridges resolve.

- [ ] **Step 3: Move remaining consumers and remove V1 modules**

Use `rg -l "platform\.capabilities|platform\.content" apps libraries` as the exhaustive list. Replace each production and test import with the responsible V2 module, then delete the two V1 implementation files and obsolete V1-only assertions.

- [ ] **Step 4: Prove no V1 symbols or implicit fallback remain**

Run: `rg -n "PlatformCapabilities|LegacyCapabilityFallback|getPlatformCapabilities\(|analyzePlatformContent\(|normalizePlatformContent\(" apps libraries`

Expected: no output. `ResolvedPlatformCapabilityV2`, `resolvePlatformCapabilityV2`, and `analyzePlatformContentV2` are the only capability APIs.

- [ ] **Step 5: Run formatting and static integrity checks**

Run: `pnpm exec prettier --write libraries/helpers/src/utils/platform.capability*.ts libraries/helpers/src/utils/platform.content.*.ts libraries/nestjs-libraries/src/integrations apps/backend/src/api/routes/integrations.controller.ts apps/frontend/src/components/new-launch apps/frontend/src/components/launches/calendar.context.tsx apps/frontend/src/components/launches/information.component.tsx apps/orchestrator/src/activities/post.activity.ts docs/content/platform-capability-audit.md docs/superpowers/specs/2026-08-20-platform-capabilities-v2-design.md`

Run: `git diff --check`

Expected: both commands exit 0.

- [ ] **Step 6: Run the complete test and production-build gate**

Run: `pnpm test`

Expected: all tests pass.

Run: `pnpm run build:frontend`

Expected: frontend production build exits 0.

Run: `pnpm run build:backend`

Expected: backend production build exits 0.

Run: `pnpm run build:orchestrator`

Expected: orchestrator production build exits 0.

- [ ] **Step 7: Record Batch 0 completion and commit the stable pause point**

Update the audit and design status with the exact test count, build results, corrected Slack/TikTok/Mastodon behavior, and the list of destinations still using the explicit bridge.

```bash
git add apps libraries docs/content/platform-capability-audit.md docs/superpowers/specs/2026-08-20-platform-capabilities-v2-design.md
git commit -m "feat: complete platform capabilities v2 batch zero"
```

- [ ] **Step 8: Stop before external state changes**

Run: `git status --short --branch`

Expected: clean `feature/platform-aware-post-formatting` worktree with local commits only. Do not push, merge, release, or deploy.
