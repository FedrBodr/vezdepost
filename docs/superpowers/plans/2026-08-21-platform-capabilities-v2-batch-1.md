# Platform Capabilities V2 Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `bluesky`, `threads`, `youtube`, `x`, `reddit`, `instagram`, `instagram-standalone`, and `facebook` from the unverified-adapter bridge to dedicated V2 capability profiles, reaching a 36 = 19 + 17 matrix.

**Architecture:** All eight profiles are declared in the existing immutable profile registry and resolved by the existing deterministic resolver; consumers (editor, persistence validation, orchestrator pre-network checks) need no per-provider changes. Two contract-level changes: the registry exports are renamed (`PLATFORM_CAPABILITY_PROFILES`/`PROFILE_IDENTIFIERS`), and `SocialProvider.fetchCapabilityRuntime` gains an optional `settings` parameter so X (stored Premium entitlement) and Reddit (subreddit requirements) can serve runtime overlays.

**Tech Stack:** TypeScript 5.5, React 19, NestJS 11, Vitest 3, pnpm 10, Node 22.20.0.

**Spec:** `docs/superpowers/specs/2026-08-21-platform-capabilities-v2-batch-1-design.md`

## Global Constraints

- Work in the existing isolated worktree `platform-aware-post-formatting` on `feature/platform-aware-post-formatting`.
- Use only pnpm with Node 22.20.0; add no dependencies.
- Keep canonical editor content as HTML; provider output is derived, never written back.
- No database migration or historical content conversion.
- Every limit declares its unit (`graphemes`, `utf16-code-units`, `utf8-bytes`, `weighted`) and source (`platform`, `runtime`, `application-safety`); application safety limits are never labeled platform limits.
- Variant selection is a pure function of media and provider settings — never of text content.
- Backend resolution is authoritative; client metadata cannot raise limits or flip verification.
- Breaking internal API changes are allowed; no compatibility shims for renamed exports.
- Do not push, merge, release, deploy, or change production state.
- Run all shell commands through `rtk`.

---

## File Structure

- `libraries/helpers/src/utils/platform.capability.profiles.ts` — add the eight Batch 1 profiles; rename exports to `PLATFORM_CAPABILITY_PROFILES` / `PROFILE_IDENTIFIERS`.
- `libraries/helpers/src/utils/platform.capability.resolver.ts` — rename import; extend `selectVariant` with threads/x/instagram/facebook/reddit rules.
- `libraries/helpers/src/utils/platform.content.normalizers.ts` — emit link facets for the `bluesky-facets` dialect.
- `libraries/helpers/src/utils/platform.content.normalizers.spec.ts` — facet regression tests.
- `libraries/helpers/src/utils/platform.capability.resolver.spec.ts` — per-profile resolution tests.
- `libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts` — `fetchCapabilityRuntime?(integration, settings?)`.
- `libraries/nestjs-libraries/src/integrations/social/x.provider.ts` — implement `fetchCapabilityRuntime` (Premium overlay).
- `libraries/nestjs-libraries/src/integrations/social/reddit.provider.ts` — implement `fetchCapabilityRuntime` (subreddit title requirements).
- `libraries/nestjs-libraries/src/integrations/integration.manager.ts` — pass parsed settings to `fetchCapabilityRuntime`.
- `libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts` — exact matrix counts after each profile task.
- `docs/content/platform-capability-audit.md`, `docs/superpowers/specs/2026-08-20-platform-capabilities-v2-design.md`, `docs/superpowers/specs/2026-08-21-platform-capabilities-v2-batch-1-design.md` — status updates in the final task.

### Task 1: Bluesky facets normalization

**Files:**

- Modify: `libraries/helpers/src/utils/platform.content.normalizers.ts`
- Test: `libraries/helpers/src/utils/platform.content.normalizers.spec.ts`

**Interfaces:**

- Consumes: `getHttpUrlRanges(value)` from `./strip.links`; `NormalizedPlatformField = { value: string; facets?: readonly unknown[] }`.
- Produces: for a field whose `dialect === 'bluesky-facets'`, `normalizePlatformFields` returns `{ value: <plain text>, facets: [{ index: { byteStart, byteEnd }, features: [{ '$type': 'app.bsky.richtext.facet#link', uri }] }] }`. Fields without links get `facets: undefined`.

- [ ] **Step 1: Write failing facet tests**

Add to the normalizers spec:

```ts
const blueskyCapability = (stripRawUrls = false) => ({
  identifier: 'bluesky',
  profileIdentifier: 'bluesky',
  verification: 'verified',
  evidenceDate: '2026-08-21',
  variant: 'post',
  fields: [
    {
      key: 'body',
      label: 'Body',
      required: false,
      source: 'canonical-editor',
      dialect: 'bluesky-facets',
      formatting: { bold: 'unsupported', underline: 'unsupported', links: 'native', lists: 'plain', headings: 'plain' },
    },
  ],
  structuredFields: [],
  media: { type: 'optional' },
  delivery: { longMediaText: 'not-applicable', stripRawUrls },
  diagnostics: [],
});

it('emits utf8 byte-indexed link facets for bluesky', () => {
  const result = normalizePlatformFields({
    canonicalHtml: '<p>see <a href="https://example.com">this</a> 😀</p>',
    settings: {},
    capability: blueskyCapability(),
  });
  const prefix = 'see this 😀';
  expect(result.body.value).toBe(prefix);
  expect(result.body.facets).toEqual([
    {
      index: { byteStart: 4, byteEnd: 8 },
      features: [{ '$type': 'app.bsky.richtext.facet#link', uri: 'https://example.com' }],
    },
  ]);
});

it('omits facets when no link is present', () => {
  const result = normalizePlatformFields({
    canonicalHtml: '<p>plain words</p>',
    settings: {},
    capability: blueskyCapability(),
  });
  expect(result.body.facets).toBeUndefined();
});
```

The multibyte emoji at the end proves byte indices (not UTF-16 indices) are used.

- [ ] **Step 2: Run the spec and confirm failure**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.content.normalizers.spec.ts`
Expected: FAIL — facets are currently always `undefined`.

- [ ] **Step 3: Implement facet extraction**

In `normalizeCanonicalField`, treat `'bluesky-facets'` separately from `'plain'`: normalize plain text as today, then compute facets over the resulting value using `getHttpUrlRanges(value)`; convert each character range to UTF-8 byte offsets by encoding `value.slice(0, range.start)` and `value.slice(0, range.end)` with `TextEncoder`. Return the facets array on the field entry. Facet computation must not mutate the plain-text value.

- [ ] **Step 4: Run the spec**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.content.normalizers.spec.ts`
Expected: PASS including all existing regressions.

- [ ] **Step 5: Commit**

```bash
git add libraries/helpers/src/utils/platform.content.normalizers.ts libraries/helpers/src/utils/platform.content.normalizers.spec.ts
git commit -m "feat: emit bluesky link facets during normalization"
```

### Task 2: Registry rename and Bluesky profile

**Files:**

- Modify: `libraries/helpers/src/utils/platform.capability.profiles.ts`
- Modify: `libraries/helpers/src/utils/platform.capability.resolver.ts`
- Modify: every importer of `BATCH_0_PROFILES`/`BATCH_0_IDENTIFIERS` (find via `rg "BATCH_0_(PROFILES|IDENTIFIERS)" apps libraries`)
- Test: `libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
- Test: `libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`

**Interfaces:**

- Produces: exported `PLATFORM_CAPABILITY_PROFILES: Readonly<Record<string, PlatformCapabilityProfileV2>>` and `PROFILE_IDENTIFIERS: readonly string[]` (currently the 11 Batch 0 identifiers plus `bluesky`). The old export names are removed.

- [ ] **Step 1: Write failing resolver tests for Bluesky**

```ts
it('resolves bluesky as a verified grapheme-limited profile', () => {
  const capability = resolvePlatformCapabilityV2(ctx('bluesky'));
  expect(capability).toMatchObject({
    verification: 'verified',
    profileIdentifier: 'bluesky',
    variant: 'post',
  });
  expect(capability.fields[0].limit).toEqual({
    max: 300,
    unit: 'graphemes',
    source: 'platform',
  });
  expect(capability.fields[0].dialect).toBe('bluesky-facets');
});

it('rejects five bluesky images beyond the exclusive rule', () => {
  const analysis = analyzePlatformContentV2({
    canonicalHtml: '<p>hi</p>',
    settings: {},
    media: Array.from({ length: 5 }, () => ({ type: 'image' as const })),
    capability: resolvePlatformCapabilityV2(ctx('bluesky')),
  });
  expect(analysis.blocking).toBe(true);
});
```

Also assert the resolver does not mutate frozen inputs (pattern already present for TikTok).

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
Expected: FAIL — `bluesky` still resolves through the bridge (utf16 units, dialect plain).

- [ ] **Step 3: Rename registry exports and add the profile**

Rename `BATCH_0_PROFILES` → `PLATFORM_CAPABILITY_PROFILES` and `BATCH_0_IDENTIFIERS` → `PROFILE_IDENTIFIERS`; update the resolver import and every other importer. Add:

```ts
bluesky: {
  identifier: 'bluesky',
  displayName: 'Bluesky',
  verification: 'verified',
  evidenceDate: '2026-08-21',
  defaultVariant: 'post',
  variants: {
    post: simpleVariant('post', 300, 'bluesky-facets', {
      bold: 'unsupported', underline: 'unsupported', links: 'native', lists: 'plain', headings: 'plain',
    }, {
      type: 'exclusive',
      optional: true,
      alternatives: [
        { kind: 'images', min: 1, max: 4 },
        { kind: 'video', min: 1, max: 1 },
      ],
    }),
  },
},
```

Note: `simpleVariant` derives unit from dialect; ensure it maps `bluesky-facets` to `graphemes` explicitly rather than falling into the slack branch.

- [ ] **Step 4: Update the matrix test**

Replace the `BATCH_0_IDENTIFIERS` import with `PROFILE_IDENTIFIERS`; assert `PROFILE_IDENTIFIERS.length` is 12, bridged count is 24, and `bluesky` resolves with `verification: 'verified'` while `profileIdentifier === 'bluesky'`.

- [ ] **Step 5: Run focused suites**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/helpers/src/utils/platform.content.normalizers.spec.ts libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libraries/helpers/src/utils/platform.capability.profiles.ts libraries/helpers/src/utils/platform.capability.resolver.ts libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts
git commit -m "feat: add verified bluesky capability profile"
```

(Also stage any additional importers of the renamed exports found in Step 3.)

### Task 3: Threads profile

**Files:**

- Modify: `libraries/helpers/src/utils/platform.capability.profiles.ts`
- Modify: `libraries/helpers/src/utils/platform.capability.resolver.ts` (`selectVariant`)
- Test: `libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
- Test: `libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`

**Interfaces:**

- Produces: `threads` profile with variants `text` (media none), `single` (exclusive `images(1..1) | video(1..1)`), `carousel` (required, mixed, `maxTotal: 20`). Body 500 `utf16-code-units`, `platform`, plain dialect, plain unicode-fallback formatting. Selection: `media.length === 0 → text`, `=== 1 → single`, `> 1 → carousel`.

- [ ] **Step 1: Write failing selection and limit tests**

```ts
it.each([
  [[], 'text'],
  [[{ type: 'image' }], 'single'],
  [[{ type: 'video' }], 'single'],
  [[{ type: 'image' }, { type: 'image' }], 'carousel'],
])('selects threads variant %j -> %s', (media, variant) => {
  expect(resolvePlatformCapabilityV2(ctx('threads', media)).variant).toBe(variant);
});

it('limits threads body to 500 utf16 units', () => {
  expect(resolvePlatformCapabilityV2(ctx('threads')).fields[0].limit).toEqual({
    max: 500,
    unit: 'utf16-code-units',
    source: 'platform',
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
Expected: FAIL — threads resolves through the bridge.

- [ ] **Step 3: Add the profile and selection rule**

Add the `threads` profile; extend `selectVariant` with a `threads` branch implementing the three-way rule above.

- [ ] **Step 4: Update the matrix test**

`PROFILE_IDENTIFIERS.length` is 13, bridged 23, threads non-bridge.

- [ ] **Step 5: Run focused suites**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libraries/helpers/src/utils/platform.capability.profiles.ts libraries/helpers/src/utils/platform.capability.resolver.ts libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts
git commit -m "feat: add verified threads capability profile"
```

### Task 4: YouTube profile

**Files:**

- Modify: `libraries/helpers/src/utils/platform.capability.profiles.ts`
- Test: `libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
- Test: `libraries/helpers/src/utils/platform.content.analysis.spec.ts`
- Test: `libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`

**Interfaces:**

- Produces: `youtube` profile, single variant `upload`: fields `title` (provider-setting, required, plain, 100 `utf16-code-units`, `platform`) and `description` (canonical-editor body key `description`, plain, 5,000 `utf8-bytes`, `platform`); media required `videos: { min: 1, max: 1 }`; delivery `longMediaText: 'not-applicable'`.

- [ ] **Step 1: Write failing tests**

Resolver:

```ts
it('models youtube as video-first with byte-counted description', () => {
  const capability = resolvePlatformCapabilityV2(ctx('youtube'));
  expect(capability.variant).toBe('upload');
  expect(capability.fields.map((f) => f.key)).toEqual(['title', 'description']);
  expect(capability.fields[0]).toMatchObject({ source: 'provider-setting', required: true });
  expect(capability.fields[1].limit).toEqual({ max: 5000, unit: 'utf8-bytes', source: 'platform' });
  expect(capability.media).toEqual({ type: 'required', videos: { min: 1, max: 1 } });
});
```

Analysis: a 100-character CJK description (300 UTF-8 bytes) passes while a 1,700-character CJK description (>5,000 bytes) blocks; a missing title setting produces `required-field-missing`.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/helpers/src/utils/platform.content.analysis.spec.ts`
Expected: FAIL — youtube is bridged with one generic body field.

- [ ] **Step 3: Add the profile**

Declare the `youtube` profile exactly as specified. No new selection rule needed (single variant).

- [ ] **Step 4: Update the matrix test**

14 profiles, 22 bridged.

- [ ] **Step 5: Run focused suites**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/helpers/src/utils/platform.content.analysis.spec.ts libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libraries/helpers/src/utils/platform.capability.profiles.ts libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/helpers/src/utils/platform.content.analysis.spec.ts libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts
git commit -m "feat: add verified youtube capability profile"
```

### Task 5: X runtime profile with Premium overlay

**Files:**

- Modify: `libraries/helpers/src/utils/platform.capability.profiles.ts`
- Modify: `libraries/helpers/src/utils/platform.capability.resolver.ts` (no-op selection: X uses its default variant)
- Modify: `libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/x.provider.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/integration.manager.ts`
- Test: `libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
- Test: `libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts`
- Test: `libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`

**Interfaces:**

- Interface change: `fetchCapabilityRuntime?(integration: Integration, settings?: unknown): Promise<CapabilityRuntimeOverlay | undefined>`.
- Produces: `x` profile — verification `runtime`, single variant `post`, body limit `{ max: 280, unit: 'weighted', counter: 'x-weighted', source: 'platform' }`, media exclusive optional `images(1..4) | video(1)`, `runtimeKeys: ['text-limit']`, no `runtimeMaxAgeSeconds`. `XProvider.fetchCapabilityRuntime` returns `{ observedAt, textLimits: { body: { max: 4000, unit: 'weighted', counter: 'x-weighted', source: 'runtime' } } }` when the stored `additionalSettings` contain the truthy `Verified` entry, else `undefined`. `observedAt` is `integration.updatedAt?.toString() ?? new Date().toISOString()`.

- [ ] **Step 1: Write failing resolver tests**

```ts
it('falls back to weighted 280 without an x runtime overlay', () => {
  const capability = resolvePlatformCapabilityV2(ctx('x'));
  expect(capability.verification).toBe('runtime');
  expect(capability.fields[0].limit).toMatchObject({ max: 280, unit: 'weighted', counter: 'x-weighted' });
  expect(capability.diagnostics.some((d) => d.code === 'runtime-data-missing')).toBe(true);
});

it('raises x to premium 4000 only through a trusted overlay', () => {
  const capability = resolvePlatformCapabilityV2({
    ...ctx('x'),
    runtimeOverlay: {
      observedAt: new Date().toISOString(),
      textLimits: { body: { max: 4000, unit: 'weighted', counter: 'x-weighted', source: 'runtime' } },
    },
  });
  expect(capability.fields[0].limit).toMatchObject({ max: 4000, source: 'runtime' });
  expect(capability.diagnostics).toHaveLength(0);
});
```

Manager tests: with a stored integration whose `additionalSettings` contain `[{"title":"Verified","value":true}]`, `resolveCapabilitiesV2({ providerName: 'x', settings: {}, media: [], integration })` yields the 4,000 runtime limit; a forged `settings.capabilitiesV2` payload cannot produce it; without the flag the fallback stays 280 with the warning.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts`
Expected: FAIL — x is bridged/unverified and `fetchCapabilityRuntime` does not exist on XProvider.

- [ ] **Step 3: Implement profile, interface change, provider method, manager plumbing**

Add the `x` profile. Extend the interface signature. Implement `XProvider.fetchCapabilityRuntime(integration)` mirroring the existing `maxLength()` Premium detection (parse `integration.additionalSettings` JSON array, find entry `title === 'Verified'` with truthy value). In `IntegrationManager.resolveCapabilitiesV2`, pass the already-parsed `additionalSettings` as the second argument to `fetchCapabilityRuntime`. Mastodon's implementation gains an ignored second parameter.

- [ ] **Step 4: Update the matrix test**

15 profiles, 21 bridged; `x` resolves with `verification: 'runtime'` even without an integration (fallback path).

- [ ] **Step 5: Run focused suites**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts libraries/nestjs-libraries/src/integrations/social/mastodon.provider.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libraries/helpers/src/utils/platform.capability.profiles.ts libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts libraries/nestjs-libraries/src/integrations/social/x.provider.ts libraries/nestjs-libraries/src/integrations/social/mastodon.provider.ts libraries/nestjs-libraries/src/integrations/integration.manager.ts libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts
git commit -m "feat: resolve x premium entitlement as runtime capability"
```

### Task 6: Reddit runtime profile with subreddit requirements

**Files:**

- Modify: `libraries/helpers/src/utils/platform.capability.profiles.ts`
- Modify: `libraries/helpers/src/utils/platform.capability.resolver.ts` (`selectVariant`)
- Modify: `libraries/nestjs-libraries/src/integrations/social/reddit.provider.ts`
- Test: `libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
- Test: `libraries/nestjs-libraries/src/integrations/social/reddit.provider.spec.ts`
- Test: `libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`

**Interfaces:**

- Produces: `reddit` profile — verification `runtime`, `runtimeKeys: ['text-limit']`, variants:
  - `self` (default): `title` provider-setting required 300 `utf16-code-units` `platform`; `body` canonical-editor Markdown dialect 10,000 `application-safety`; media none;
  - `link`: same `title`; structured field `url` required; media none;
  - `image`: same `title`; required `images: { min: 1, max: 1 }`;
  - `video`: same `title`; required `videos: { min: 1, max: 1, coverRequired: true }`.
- Selection: `settings.url` truthy string → `link`; exactly one image → `image`; exactly one video → `video`; otherwise `self`.
- `RedditProvider.fetchCapabilityRuntime(integration, settings)`: reads the first configured subreddit from `settings.subreddit`, requests its `post_requirements`, and when a numeric stricter title maximum exists returns `textLimits.title = { max, unit: 'utf16-code-units', source: 'runtime' }` with `observedAt` now; any fetch/parse failure returns `undefined`.

- [ ] **Step 1: Write failing tests**

Resolver: table-driven selection cases (url → link, image → image, video → video, empty → self); markdown dialect asserted on `self.body`; missing overlay emits `runtime-data-missing` while keeping the 10,000 application-safety limit; a trusted overlay lowering `title` to 40 replaces the limit with `source: 'runtime'`.

Provider: mock HTTP returning `{ title_required_max: 40 }`-shaped data proves the overlay mapping; a rejected fetch returns `undefined` instead of throwing.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/nestjs-libraries/src/integrations/social/reddit.provider.spec.ts`
Expected: FAIL — reddit is bridged; `fetchCapabilityRuntime` missing.

- [ ] **Step 3: Implement profile, selection, provider runtime fetch**

Follow the interfaces above. Reuse the provider's existing authenticated request helpers for `post_requirements` (the same endpoints its `restrictions()` tool already calls).

- [ ] **Step 4: Update the matrix test**

16 profiles, 20 bridged.

- [ ] **Step 5: Run focused suites**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/nestjs-libraries/src/integrations/social/reddit.provider.spec.ts libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libraries/helpers/src/utils/platform.capability.profiles.ts libraries/helpers/src/utils/platform.capability.resolver.ts libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/nestjs-libraries/src/integrations/social/reddit.provider.ts libraries/nestjs-libraries/src/integrations/social/reddit.provider.spec.ts libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts
git commit -m "feat: resolve reddit subreddit requirements as runtime capability"
```

### Task 7: Instagram profile and instagram-standalone alias

**Files:**

- Modify: `libraries/helpers/src/utils/platform.capability.profiles.ts`
- Modify: `libraries/helpers/src/utils/platform.capability.resolver.ts` (`selectVariant`)
- Test: `libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
- Test: `libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`

**Interfaces:**

- Produces: `instagram` profile — verification `verified`, caption field (canonical-editor, key `caption`, 2,200 `utf16-code-units`, `platform`, plain) shared by all variants:
  - `feed`: required mixed media, `maxTotal: 10`;
  - `story`: required mixed media (published individually);
  - `reel`: required `videos: { min: 1, max: 1 }`;
  - `trial-reel`: required `videos: { min: 1, max: 1 }`.
- Selection: `is_trial_reel` truthy → `trial-reel` when media is exactly one video, otherwise error diagnostic `invalid-media-variant` with default `feed`; `post_type === 'story'` → `story`; exactly one video → `reel`; otherwise `feed`.
- `instagram-standalone`: `{ aliasOf: 'instagram' }` preserving the requested identifier.

- [ ] **Step 1: Write failing tests**

Table-driven: story setting + any media → `story`; single video → `reel`; two images → `feed`; `is_trial_reel` + one video → `trial-reel`; `is_trial_reel` + two images → `feed` plus an `invalid-media-variant` error diagnostic. Alias: `resolvePlatformCapabilityV2(ctx('instagram-standalone'))` has `identifier: 'instagram-standalone'`, `profileIdentifier: 'instagram'`, `verification: 'verified'`.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
Expected: FAIL — both identifiers are bridged.

- [ ] **Step 3: Implement profile, selection, alias**

Follow the interfaces above; mirror the TikTok invalid-media diagnostic pattern.

- [ ] **Step 4: Update the matrix test**

18 profiles, 18 bridged; `instagram-standalone` keeps its identifier with `profileIdentifier: 'instagram'` (second deliberate alias alongside `linkedin-page`).

- [ ] **Step 5: Run focused suites**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libraries/helpers/src/utils/platform.capability.profiles.ts libraries/helpers/src/utils/platform.capability.resolver.ts libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts
git commit -m "feat: add instagram capability profile with standalone alias"
```

### Task 8: Facebook profile

**Files:**

- Modify: `libraries/helpers/src/utils/platform.capability.profiles.ts`
- Modify: `libraries/helpers/src/utils/platform.capability.resolver.ts` (`selectVariant`)
- Test: `libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
- Test: `libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`

**Interfaces:**

- Produces: `facebook` profile — verification `verified`, variants:
  - `feed`: body 63,206 `utf16-code-units` `platform`, plain dialect; optional photos media (`type: 'optional'`); structured field `link` optional;
  - `story`: **no canonical-editor field** (text is not published); required mixed media;
  - `video`: body acts as the video description (same limit); required `videos: { min: 1, max: 1 }`.
- Selection: `post_type === 'story'` → `story`; first media type `video` → `video`; otherwise `feed`.

- [ ] **Step 1: Write failing tests**

Selection table (story setting → story; video media → video; images/no media → feed); feed limit equals 63,206 UTF-16 units; story variant has zero canonical-editor fields so analysis cannot block on text; video requires exactly one video.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
Expected: FAIL — facebook is bridged.

- [ ] **Step 3: Implement profile and selection**

Follow the interfaces above.

- [ ] **Step 4: Update the matrix test to the final Batch 1 shape**

36 unique identifiers; 19 with dedicated profiles; 17 bridged; aliases exactly `linkedin-page → linkedin` and `instagram-standalone → instagram`; every other identifier resolves with `profileIdentifier === identifier`.

- [ ] **Step 5: Run focused suites**

Run: `pnpm exec vitest run libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libraries/helpers/src/utils/platform.capability.profiles.ts libraries/helpers/src/utils/platform.capability.resolver.ts libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts
git commit -m "feat: add facebook capability profile with story split"
```

### Task 9: Full gate, docs, and Batch 1 pause point

**Files:**

- Modify: `docs/content/platform-capability-audit.md`
- Modify: `docs/superpowers/specs/2026-08-20-platform-capabilities-v2-design.md`
- Modify: `docs/superpowers/specs/2026-08-21-platform-capabilities-v2-batch-1-design.md`
- Modify: `.superpowers/sdd/progress.md`

**Interfaces:**

- Consumes: all Batch 1 tasks complete with clean reviews.
- Produces: documented pause point with fresh verification numbers.

- [ ] **Step 1: Run the full repository suite**

Run: `pnpm test`
Expected: all tests pass; record the exact count.

- [ ] **Step 2: Run production builds**

Run each and require exit 0: `pnpm run build:frontend`, `pnpm run build:backend`, `pnpm run build:orchestrator`.

- [ ] **Step 3: Static integrity proofs**

Run: `rg -n "BATCH_0_PROFILES|BATCH_0_IDENTIFIERS" apps libraries` — expected: no output.
Run: `rg -n "unverified-adapter" libraries/helpers/src/utils/platform.capability.profiles.ts` — expected: no output (bridge lives only in the resolver).

- [ ] **Step 4: Formatting and diff hygiene**

Run: `pnpm exec prettier --check` over every changed file and `git diff --check` (and `--cached`) — both must exit 0.

- [ ] **Step 5: Update docs**

Record in the audit and both design docs: the 36 = 19 + 17 matrix, the eight newly verified destinations with their evidence dates, the two aliases, the runtime overlays (X Premium, Reddit subreddit), the exact test/build numbers, and the remaining 17 bridged identifiers (`gmb`, `dribbble`, `discord`, `kick`, `twitch`, `lemmy`, `wrapcast`, `nostr`, `medium`, `devto`, `hashnode`, `wordpress`, `listmonk`, `moltbook`, `whop`, `skool`, `mewe`). Append the Batch 1 outcome line to `.superpowers/sdd/progress.md`.

- [ ] **Step 6: Commit the pause point**

```bash
git add docs .superpowers/sdd/progress.md
git commit -m "docs: record platform capabilities v2 batch one completion"
```

- [ ] **Step 7: Stop before external state changes**

Run: `git status --short --branch`
Expected: clean worktree, local commits only. No push, merge, release, or deploy.
