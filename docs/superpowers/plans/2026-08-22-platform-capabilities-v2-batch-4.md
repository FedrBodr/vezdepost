# Platform Capabilities V2 Batch 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `gmb` and `dribbble` to dedicated V2 profiles, land the five carried minors, and document the four destinations that deliberately stay bridged — terminal matrix 36 = 32 + 4.

**Architecture:** Two new profile declarations (gmb with topic-type variant selection; dribbble media-first), one provider constant alignment (listmonk maxLength), clamp helper extraction, and test-coverage hardening. No new contract vocabulary.

**Tech Stack:** TypeScript 5.5, NestJS 11, Vitest 3, pnpm 10, node@22 (Homebrew v22.23.x; default shell node is v23, out of engine range).

**Spec:** `docs/superpowers/specs/2026-08-22-platform-capabilities-v2-batch-4-design.md`

## Global Constraints

- Work in the existing isolated worktree `platform-aware-post-formatting` on `feature/platform-aware-post-formatting`.
- Use only pnpm; add no dependencies. Run all shell commands through `rtk`.
- Canonical editor content stays HTML; provider output derived, never written back.
- Limits declare unit and source exactly per spec; application-safety limits never labeled platform limits.
- Variant selection is a pure function of settings/media — never text heuristics.
- Do not model the out-of-scope adapter defects listed in the spec (languageCode, error copy, dead VIDEO branch, dribbble team setting).
- Breaking internal API changes allowed; no compatibility shims.
- Do not push, merge, release, deploy, or change production state.

---

## File Structure

- `libraries/helpers/src/utils/platform.capability.profiles.ts` — gmb + dribbble profiles.
- `libraries/helpers/src/utils/platform.capability.resolver.ts` — gmb selection branch; clamp helper extraction.
- `libraries/nestjs-libraries/src/integrations/social/listmonk.provider.ts` — maxLength 1,000,000.
- Matching spec files beside each changed module.
- `libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts` — final matrix.
- Batch 4 docs at final gate.

### Task 1: GMB profile with topic-type variants

**Files:**

- Modify: `libraries/helpers/src/utils/platform.capability.profiles.ts`
- Modify: `libraries/helpers/src/utils/platform.capability.resolver.ts` (`selectVariant`)
- Test: `libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
- Test: `libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`

**Interfaces:**

- Produces: `gmb` profile — verified, default variant `standard`; variants share body (canonical-editor, plain, `{ max: 1500, unit: 'utf16-code-units', source: 'platform' }`, plain unicode-fallback formatting) and media `{ type: 'optional', images: { min: 1, max: 1 } }`:
  - `standard`: structuredFields `callToActionType`, `callToActionUrl` optional;
  - `event`: adds `eventTitle` required + `eventStartDate`, `eventEndDate`, `eventStartTime`, `eventEndTime` optional;
  - `offer`: adds `offerCouponCode`, `offerRedeemUrl`, `offerTerms` optional.
- Selection: `settings.topicType === 'EVENT'` → `event`; `=== 'OFFER'` → `offer`; otherwise `standard`.

- [ ] **Step 1: Write failing tests** — table-driven: no topicType → standard; 'STANDARD' → standard; 'EVENT' → event with required `eventTitle` structured field and optional schedule fields; 'OFFER' → offer with coupon fields. Exact body limit object via `toEqual`. Matrix: 31 / 5.
- [ ] **Step 2: Run, confirm FAIL.**
- [ ] **Step 3: Add profile + selection branch.**
- [ ] **Step 4: Run, confirm PASS.**
- [ ] **Step 5: Commit** — `feat: add gmb local post capability profile`.

### Task 2: Dribbble media-first profile

**Files:**

- Modify: `libraries/helpers/src/utils/platform.capability.profiles.ts`
- Test: `libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
- Test: `libraries/helpers/src/utils/platform.content.analysis.spec.ts`
- Test: `libraries/nestjs-libraries/src/integrations/platform.capability.matrix.spec.ts`

**Interfaces:**

- Produces: `dribbble` profile — verified, single variant `shot`: body (canonical-editor, plain, `{ max: 40000, unit: 'utf16-code-units', source: 'application-safety' }`, links `plain` only, bold/underline/lists/headings `unsupported`); media `{ type: 'required', images: { min: 1, max: 1 } }`; structuredFields `title` required. No dimension modeling (stays adapter-enforced per spec).

- [ ] **Step 1: Write failing tests** — dribbble resolves `verified/shot`; required media: analysis with zero media blocks (`unsupported-media`/required violation), with one image passes, with two blocks; exact limit object; title required structured field. Matrix: 32 / 4 — FINAL: assert remaining bridged are exactly `moltbook, whop, skool, mewe`.
- [ ] **Step 2: Run, confirm FAIL.**
- [ ] **Step 3: Add the profile.**
- [ ] **Step 4: Run, confirm PASS.**
- [ ] **Step 5: Commit** — `feat: add dribbble shot capability profile`.

### Task 3: Carried minors — listmonk alignment, clamp helper, coverage

**Files:**

- Modify: `libraries/nestjs-libraries/src/integrations/social/listmonk.provider.ts` (`maxLength()` → `1_000_000`)
- Modify: `libraries/helpers/src/utils/platform.capability.resolver.ts` (extract named clamp helper from the IIFE in `applyRuntimeOverlay`)
- Test: `libraries/helpers/src/utils/platform.capability.resolver.spec.ts`
- Test: `libraries/helpers/src/utils/platform.content.analysis.spec.ts`

- [ ] **Step 1: Write failing tests** — (a) synthetic profile declaring both `runtimeCeilings: { title: 100 }` and `runtimeMaxCeiling: 500` with an overlay carrying `title: 400` and `body: 900`: title clamps to 100 (per-key wins), body clamps to 500 (global fallback), both with `runtime-limit-clamped` diagnostics; (b) tighten reddit body-unclamped test to full-object `toEqual`; (c) title-field absence assertions (`fields.every(f => f.key !== 'title')` or structured-only proof) for hashnode, wordpress, listmonk.
- [ ] **Step 2: Run, confirm FAIL on the new cases.**
- [ ] **Step 3: Implement helper extraction + listmonk constant.**
- [ ] **Step 4: Run resolver, analysis, integration.manager, matrix specs — PASS.**
- [ ] **Step 5: Commit** — `refactor: align listmonk limit and extract overlay clamp helper`.

### Task 4: Full gate, docs, and migration completion

**Files:**

- Modify: `docs/content/platform-capability-audit.md`
- Modify: `docs/superpowers/specs/2026-08-20-platform-capabilities-v2-design.md`
- Modify: `docs/superpowers/specs/2026-08-22-platform-capabilities-v2-batch-4-design.md`

- [ ] **Step 1: `rtk pnpm test`** with Homebrew node@22 — exact counts; STOP and report BLOCKED if red.
- [ ] **Step 2: Builds** — frontend, backend, orchestrator each exit 0 (node@22).
- [ ] **Step 3: Static proofs** — matrix spec proves 36 = 32 + 4 with the exact bridged list.
- [ ] **Step 4: Prettier check over changed files + `git diff --check`.**
- [ ] **Step 5: Update docs** — final matrix 36 = 32 + 4; gmb/dribbble profiles with evidence; the four terminal bridge destinations with per-destination reasons (moltbook: mutable niche public contract; whop: adapter limit unverified against server behavior; skool: private/partner API requires authenticated contract tests; mewe: adapter-specific behavior, no public evidence); carried minors landed; out-of-scope adapter defects recorded (gmb languageCode/error copy/dead VIDEO branch, dribbble pinterest refreshToken copy-paste); exact verification numbers.
- [ ] **Step 6: Commit** — `docs: complete platform capabilities v2 migration`.
- [ ] **Step 7: Stop before external state changes** — clean worktree; no push/merge/release/deploy.
