# Platform Capabilities V2 Batch 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `medium`, `devto`, `hashnode`, `wordpress`, and `listmonk` to dedicated V2 article/campaign profiles (36 = 30 + 6) and land the two carried hardening minors: key-scoped runtime ceilings and the wrapcast exact-boundary test.

**Architecture:** Five single-variant profile declarations in the existing immutable registry; no new selection branches. One contract addition: optional `runtimeCeilings?: Readonly<Record<string, number>>` on `PlatformCapabilityProfileV2`, taking precedence over the global `runtimeMaxCeiling` in `applyRuntimeOverlay`.

**Tech Stack:** TypeScript 5.5, NestJS 11, Vitest 3, pnpm 10, node@22 (Homebrew v22.23.x — default shell node is v23 and out of engine range).

**Spec:** `docs/superpowers/specs/2026-08-22-platform-capabilities-v2-batch-3-design.md`

## Global Constraints

- Work in the existing isolated worktree `platform-aware-post-formatting` on `feature/platform-aware-post-formatting`.
- Use only pnpm; add no dependencies. Run all shell commands through `rtk`.
- Canonical editor content stays HTML; provider output derived, never written back.
- No database migration or historical content conversion.
- Limits declare unit and source exactly per the spec table; application-safety limits are never labeled platform limits.
- Titles are provider-settings WITHOUT declared limits — invent none.
- Single constant variant per profile; no new `selectVariant` branches.
- Breaking internal API changes allowed; no compatibility shims.
- Do not push, merge, release, deploy, or change production state.

---

## File Structure

- `libraries/helpers/src/utils/platform.capability.types.ts` — `runtimeCeilings?: Readonly<Record<string, number>>`.
- `libraries/helpers/src/utils/platform.capability.profiles.ts` — five new profiles + reddit ceilings move.
- `libraries/helpers/src/utils/platform.capability.resolver.ts` — per-key ceiling precedence in `applyRuntimeOverlay`.
- `libraries/helpers/src/utils/platform.content.normalizers.spec.ts` — markdown normalization evidence for new profiles.
- `libraries/helpers/src/utils/platform.content.analysis.spec.ts` — wrapcast exact boundary.
- `libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts` — counts after tasks.
- Batch 3 docs at final gate.

### Task 1: Medium and DevTo article profiles

**Files:**

- Modify: `libraries/helpers/src/utils/platform.capability.profiles.ts`
- Test: `libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
- Test: `libraries/helpers/src/utils/platform.content.normalizers.spec.ts`
- Test: `libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`

**Interfaces:**

- Produces: `medium` profile — verified, variant `article`: body canonical-editor Markdown `{ max: 100000, unit: 'utf16-code-units', source: 'application-safety' }`, native formatting, media `{ type: 'none' }`; structuredFields `title` (required), `tags` (optional), `canonical` (optional), `publication` (optional). `devto` profile — verified, variant `article`: same body limit/dialect; media `{ type: 'optional', images: { min: 1, max: 1 } }`; structuredFields `title` (required), `tags`, `organization`, `canonical` (all optional).

- [ ] **Step 1: Write failing tests** — both resolve `verified/article`; exact body limit objects via `toEqual`; title structured field required WITHOUT a text-field entry (no invented title limit); markdown normalization evidence (`<p>Hello <strong>world</strong></p>` → `Hello **world**`); devto media single optional image vs medium none. Matrix: 27 / 9.
- [ ] **Step 2: Run focused specs, confirm FAIL.**
- [ ] **Step 3: Add both profiles.**
- [ ] **Step 4: Run focused specs, confirm PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: add medium and devto article capability profiles"` (stage the four files).

### Task 2: Hashnode and WordPress profiles

**Files:**

- Modify: `libraries/helpers/src/utils/platform.capability.profiles.ts`
- Test: `libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
- Test: `libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`

**Interfaces:**

- Produces: `hashnode` profile — verified, variant `article`: body Markdown `{ max: 10000, unit: 'utf16-code-units', source: 'application-safety' }`; media optional `images(1..1)` cover; structuredFields `title` (required), `publication` (required), `tags`, `subtitle`, `canonical` (optional). `wordpress` profile — verified, variant `post`: body HTML dialect (native formatting) `{ max: 100000, unit: 'utf16-code-units', source: 'application-safety' }`; media optional `images(1..1)` featured; structuredFields `title` (required), `type` (required), `status`, `categories`, `tags` (optional).

- [ ] **Step 1: Write failing tests** — hashnode `verified/article` markdown with required publication; wordpress `verified/post` HTML dialect evidence (`<p>Hello <strong>world</strong></p>` stays HTML via normalizeHtml path); both media single optional image; exact limit objects. Matrix: 29 / 7.
- [ ] **Step 2: Run, confirm FAIL.**
- [ ] **Step 3: Add both profiles.**
- [ ] **Step 4: Run, confirm PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: add hashnode and wordpress capability profiles"`.

### Task 3: Listmonk campaign profile + carried hardening minors

**Files:**

- Modify: `libraries/helpers/src/utils/platform.capability.types.ts`
- Modify: `libraries/helpers/src/utils/platform.capability.profiles.ts`
- Modify: `libraries/helpers/src/utils/platform.capability.resolver.ts`
- Test: `libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
- Test: `libraries/helpers/src/utils/platform.content.analysis.spec.ts`
- Test: `libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`

**Interfaces:**

- Produces: `listmonk` profile — verified, variant `campaign`: body canonical-editor HTML `{ max: 1000000, unit: 'utf16-code-units', source: 'application-safety' }` (corrects the 100,000,000 sentinel); media `{ type: 'none' }`; structuredFields `subject` (required), `list` (required), `template`, `preview` (optional).
- Contract addition: `runtimeCeilings?: Readonly<Record<string, number>>` on `PlatformCapabilityProfileV2`. Resolution precedence in `applyRuntimeOverlay`: per-key `runtimeCeilings[key]` first, then global `runtimeMaxCeiling`, else no clamp. Reddit moves from `runtimeMaxCeiling: 300` to `runtimeCeilings: { title: 300 }`; X keeps global 4000. Diagnostic behavior unchanged.
- Wrapcast boundary test: mixed content measuring exactly 320 UTF-8 bytes passes analysis (e.g. `'😀'.repeat(78)` + padding to land exactly — compute in the test from measured byte length rather than hardcoding blind counts).

- [ ] **Step 1: Write failing tests** — listmonk resolves `verified/campaign` with exact 1,000,000 application-safety HTML body, subject+list required; matrix 30 / 6 (remaining bridged exactly `gmb, dribbble, moltbook, whop, skool, mewe`). Resolver: reddit overlay `title: 500` still clamps to 300 via per-key ceiling; hypothetical reddit `body: 40000` overlay is NOT clamped anymore (no key entry, no global ceiling); X forged 10,000 still clamps to 4,000 globally; diagnostic fires as before. Analysis: wrapcast mixed-content at exactly 320 bytes does not block.
- [ ] **Step 2: Run, confirm FAIL.**
- [ ] **Step 3: Implement profile, type addition, resolver precedence, boundary test.**
- [ ] **Step 4: Run all specs plus integration.manager.spec.ts, confirm PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: add listmonk campaign profile and scope runtime ceilings"`.

### Task 4: Full gate, docs, and Batch 3 pause point

**Files:**

- Modify: `docs/content/platform-capability-audit.md`
- Modify: `docs/superpowers/specs/2026-08-20-platform-capabilities-v2-design.md`
- Modify: `docs/superpowers/specs/2026-08-22-platform-capabilities-v2-batch-3-design.md`

- [ ] **Step 1: `rtk pnpm test`** with Homebrew node@22 — record exact counts; STOP and report BLOCKED if red.
- [ ] **Step 2: Builds** — build:frontend, build:backend, build:orchestrator each exit 0 (node@22, not default v23).
- [ ] **Step 3: Static proofs** — no `unverified-adapter` in the profile record; matrix identifiers list matches `socialIntegrationList` (36).
- [ ] **Step 4: Prettier check over changed files + `git diff --check`.**
- [ ] **Step 5: Update docs** — 36 = 30 + 6 matrix; five new destinations with evidence notes (Medium API legacy/archived; Forem official; gql.hashnode.com official; WP REST official; Listmonk campaigns official); titles carry no invented limits; listmonk sentinel correction 100,000,000 → 1,000,000; carried minors landed (key-scoped ceilings, wrapcast boundary); remaining 6 bridged identifiers; exact verification numbers.
- [ ] **Step 6: Commit** — `git commit -m "docs: record platform capabilities v2 batch three completion"`.
- [ ] **Step 7: Stop before external state changes** — clean worktree; no push/merge/release/deploy.
