# Platform Capabilities V2 Batch 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `discord`, `twitch`, `kick`, `lemmy`, `wrapcast`, and `nostr` to dedicated V2 profiles (36 = 25 + 11) and land the three deferred hardening items: facet anchoring, runtime overlay clamping, Reddit multi-subreddit validation.

**Architecture:** All six profiles are declarations in the existing immutable registry resolved by the existing deterministic resolver; consumers need no per-provider changes. One contract addition: optional `runtimeMaxCeiling?: number` on `PlatformCapabilityProfileV2`, enforced in `applyRuntimeOverlay`.

**Tech Stack:** TypeScript 5.5, NestJS 11, Vitest 3, pnpm 10, Node ≥22.12.

**Spec:** `docs/superpowers/specs/2026-08-22-platform-capabilities-v2-batch-2-design.md`

## Global Constraints

- Work in the existing isolated worktree `platform-aware-post-formatting` on `feature/platform-aware-post-formatting`.
- Use only pnpm; add no dependencies.
- Keep canonical editor content as HTML; provider output is derived, never written back.
- No database migration or historical content conversion.
- Every limit declares its unit and source; application-safety limits are never labeled platform limits (`source` must be exact per the spec table).
- Variant selection is a pure function of media/settings — never text heuristics.
- Backend resolution is authoritative; client metadata cannot raise limits or flip verification.
- Breaking internal API changes are allowed; no compatibility shims.
- Do not push, merge, release, deploy, or change production state.
- Run all shell commands through `rtk`.

---

## File Structure

- `libraries/helpers/src/utils/platform.capability.types.ts` — add `runtimeMaxCeiling?: number`.
- `libraries/helpers/src/utils/platform.capability.profiles.ts` — six new profiles + ceiling declarations.
- `libraries/helpers/src/utils/platform.capability.resolver.ts` — clamp runtime text limits to `runtimeMaxCeiling`.
- `libraries/helpers/src/utils/platform.content.normalizers.ts` — facet anchoring hardening.
- `libraries/nestjs-libraries/src/integrations/social/reddit.provider.ts` — multi-subreddit strictest maximum.
- Matching spec files beside each changed module.
- `libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts` — counts after each profile task.
- Batch 2 docs at final gate.

### Task 1: Discord profile

**Files:**

- Modify: `libraries/helpers/src/utils/platform.capability.profiles.ts`
- Test: `libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
- Test: `libraries/helpers/src/utils/platform.content.normalizers.spec.ts`
- Test: `libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`

**Interfaces:**

- Produces: `discord` profile — verification `verified`, single variant `message`; body limit `{ max: 1980, unit: 'utf16-code-units', source: 'application-safety' }`, dialect `discord-markdown`, all-native formatting; media `{ type: 'optional', images: { min: 1, max: 10 }, videos: { min: 1, max: 10 }, mixed: true, maxTotal: 10 }`; structured field `channel` required.

- [ ] **Step 1: Write failing tests** — resolver: discord resolves `verified/message`, exact limit object via `toEqual`, dialect `discord-markdown`, `channel` in structuredFields with `required: true`. Normalizers: `<p>Hello <strong>world</strong></p>` renders as `Hello **world**` for discord (markdown render path). Matrix: 20 dedicated / 16 bridged.
- [ ] **Step 2: Run focused specs, confirm FAIL (bridged).**
- [ ] **Step 3: Add the profile exactly as specified.**
- [ ] **Step 4: Run focused suites, confirm PASS.**
- [ ] **Step 5: Commit**

```bash
git add libraries/helpers/src/utils/platform.capability.profiles.ts libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/helpers/src/utils/platform.content.normalizers.spec.ts libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts
git commit -m "feat: add verified discord capability profile"
```

### Task 2: Twitch and Kick chat profiles

**Files:**

- Modify: `libraries/helpers/src/utils/platform.capability.profiles.ts`
- Test: `libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
- Test: `libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`

**Interfaces:**

- Produces: `twitch` profile — verified, variant `chat`: body `{ max: 500, unit: 'utf16-code-units', source: 'platform' }`, plain dialect, formatting `{ bold: 'unsupported', underline: 'unsupported', links: 'plain', lists: 'plain', headings: 'plain' }`, media `{ type: 'none' }`, structured field `messageType` optional. `kick` profile — verified, variant `chat`: same limit/formatting/media, no structured fields.

- [ ] **Step 1: Write failing tests** — both resolve `verified/chat`, exact 500/platform limits, media `{ type: 'none' }`, twitch has `messageType` structured field, kick does not. Matrix: 22 / 14.
- [ ] **Step 2: Run, confirm FAIL.**
- [ ] **Step 3: Add both profiles.**
- [ ] **Step 4: Run, confirm PASS.**
- [ ] **Step 5: Commit**

```bash
git add libraries/helpers/src/utils/platform.capability.profiles.ts libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts
git commit -m "feat: add twitch and kick chat capability profiles"
```

### Task 3: Lemmy profile

**Files:**

- Modify: `libraries/helpers/src/utils/platform.capability.profiles.ts`
- Test: `libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
- Test: `libraries/helpers/src/utils/platform.content.normalizers.spec.ts`
- Test: `libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`

**Interfaces:**

- Produces: `lemmy` profile — verified, variant `post`: fields `title` (provider-setting, required, plain, NO limit declared) and `body` (canonical-editor, Markdown dialect, `{ max: 10000, unit: 'utf16-code-units', source: 'application-safety' }`, native formatting); media `{ type: 'optional', images: { min: 1, max: 1 } }`; structured field `url` optional.

- [ ] **Step 1: Write failing tests** — lemmy resolves `verified/post`; body dialect `markdown` with markdown-render normalization evidence; title required provider-setting without a limit key; media single optional image; `url` structured field present. Matrix: 23 / 13.
- [ ] **Step 2: Run, confirm FAIL.**
- [ ] **Step 3: Add the profile.**
- [ ] **Step 4: Run, confirm PASS.**
- [ ] **Step 5: Commit**

```bash
git add libraries/helpers/src/utils/platform.capability.profiles.ts libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/helpers/src/utils/platform.content.normalizers.spec.ts libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts
git commit -m "feat: add verified lemmy markdown capability profile"
```

### Task 4: Wrapcast and Nostr profiles

**Files:**

- Modify: `libraries/helpers/src/utils/platform.capability.profiles.ts`
- Test: `libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
- Test: `libraries/helpers/src/utils/platform.content.analysis.spec.ts`
- Test: `libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`

**Interfaces:**

- Produces: `wrapcast` profile — verified, variant `cast`: body `{ max: 320, unit: 'utf8-bytes', source: 'platform' }` (corrects adapter 800), plain dialect, links `plain`, media `{ type: 'optional', images: { min: 1, max: 2 } }`, structured field `channelId` optional. `nostr` profile — verified, variant `note`: body `{ max: 100000, unit: 'utf16-code-units', source: 'application-safety' }`, plain dialect, links `plain`, media `{ type: 'optional', images: { min: 1 }, videos: { min: 1 }, mixed: true }`.

- [ ] **Step 1: Write failing tests** — wrapcast resolves 320 utf8-bytes platform (analysis: 100 CJK chars = 300 bytes pass, 107 CJK chars = 321 bytes block); nostr resolves application-safety 100000 utf16; wrapcast media caps at two images (three images block); nostr mixed optional. Matrix: 25 / 11 — FINAL Batch 2 shape; assert the remaining 11 bridged identifiers are exactly `gmb, dribbble, medium, devto, hashnode, wordpress, listmonk, moltbook, whop, skool, mewe`.
- [ ] **Step 2: Run, confirm FAIL.**
- [ ] **Step 3: Add both profiles.**
- [ ] **Step 4: Run, confirm PASS.**
- [ ] **Step 5: Commit**

```bash
git add libraries/helpers/src/utils/platform.capability.profiles.ts libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/helpers/src/utils/platform.content.analysis.spec.ts libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts
git commit -m "feat: add wrapcast and nostr capability profiles"
```

### Task 5: Hardening — facets, overlay clamp, reddit fan-out

**Files:**

- Modify: `libraries/helpers/src/utils/platform.capability.types.ts` (`runtimeMaxCeiling?: number` on `PlatformCapabilityProfileV2`)
- Modify: `libraries/helpers/src/utils/platform.capability.resolver.ts` (clamp in `applyRuntimeOverlay`; ceiling on x=4000, reddit=300)
- Modify: `libraries/helpers/src/utils/platform.capability.profiles.ts` (ceiling declarations)
- Modify: `libraries/helpers/src/utils/platform.content.normalizers.ts` (facet anchoring)
- Modify: `libraries/nestjs-libraries/src/integrations/social/reddit.provider.ts` (multi-subreddit)
- Test: `libraries/helpers/src/utils/platform.content.normalizers.spec.ts`
- Test: `libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
- Test: `libraries/nestjs-libraries/src/integrations/social/reddit.provider.spec.ts`

**Interfaces:**

- Produces: facet anchoring that searches labels forward from the previous facet end, emits at most one facet per anchor element, and drops bare-URL ranges partially overlapping anchor facets. Overlay clamping: any runtime text limit whose `max` exceeds the profile's `runtimeMaxCeiling` is clamped to it (X premium 4,000 still passes; a forged/buggy 10,000 X overlay clamps to 4,000; reddit overlay above 300 clamps to 300). Reddit: `fetchCapabilityRuntime` queries every configured subreddit up to the first 10 and applies the minimum title maximum across responses; failures for individual subreddits are skipped rather than failing the overlay.

- [ ] **Step 1: Write failing tests** — normalizers: duplicate-label case `<p>this <a href="https://a.example">this</a></p>` anchors the facet to the SECOND occurrence (the link text), not index 0; nested anchors emit one facet; a bare URL overlapping an anchor range produces non-overlapping facets only. Resolver: forged X overlay `max: 10000` clamps to 4000 with unchanged `source: 'runtime'`; legitimate premium 4000 unaffected; reddit overlay 500 clamps to 300. Provider: mocked requirements for two subreddits (40 and 60) yield title max 40; one failing subreddit is skipped; >10 subreddits bounded.
- [ ] **Step 2: Run all four specs, confirm FAIL.**
- [ ] **Step 3: Implement the three hardening changes.**
- [ ] **Step 4: Run the four specs plus integration.manager.spec.ts, confirm PASS.**
- [ ] **Step 5: Commit**

```bash
git add libraries/helpers/src/utils/platform.capability.types.ts libraries/helpers/src/utils/platform.capability.profiles.ts libraries/helpers/src/utils/platform.capability.resolver.ts libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/helpers/src/utils/platform.content.normalizers.ts libraries/helpers/src/utils/platform.content.normalizers.spec.ts libraries/nestjs-libraries/src/integrations/social/reddit.provider.ts libraries/nestjs-libraries/src/integrations/social/reddit.provider.spec.ts
git commit -m "feat: harden facets, clamp runtime overlays, validate all subreddits"
```

### Task 6: Full gate, docs, and Batch 2 pause point

**Files:**

- Modify: `docs/content/platform-capability-audit.md`
- Modify: `docs/superpowers/specs/2026-08-20-platform-capabilities-v2-design.md`
- Modify: `docs/superpowers/specs/2026-08-22-platform-capabilities-v2-batch-2-design.md`
- Modify: `.superpowers/sdd/progress.md` (on-disk note; file is gitignored)

- [ ] **Step 1: Run `pnpm test`** — record exact counts; STOP and report BLOCKED if red.
- [ ] **Step 2: Run builds** — `pnpm run build:frontend`, `pnpm run build:backend`, `pnpm run build:orchestrator`; each must exit 0.
- [ ] **Step 3: Static proofs** — `rg -n "unverified-adapter" libraries/helpers/src/utils/platform.capability.profiles.ts` empty; matrix identifiers list matches `socialIntegrationList` (36).
- [ ] **Step 4: Prettier check over changed files + `git diff --check`.**
- [ ] **Step 5: Update docs** — 36 = 25 + 11 matrix, six new destinations with evidence dates, wrapcast 800→320 correction, lemmy dialect correction, the three hardening items landed, remaining 11 bridged identifiers, exact verification numbers. Fix the Batch 1 design prose claiming uniform 2026-08-20 evidence dates (bluesky is 2026-08-21).
- [ ] **Step 6: Commit**

```bash
git add docs
git commit -m "docs: record platform capabilities v2 batch two completion"
```

- [ ] **Step 7: Stop before external state changes** — clean worktree, local commits only; no push/merge/release/deploy.
