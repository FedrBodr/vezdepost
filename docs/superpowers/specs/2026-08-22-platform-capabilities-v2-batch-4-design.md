# Platform Capabilities V2 — Batch 4 Design

**Date:** 2026-08-22
**Linear:** FED-347
**Status:** Complete and verified locally on 2026-08-22 (final batch;
migration terminal at 36 = 32 + 4)
**Parent design:** `docs/superpowers/specs/2026-08-20-platform-capabilities-v2-design.md`

## Goal

Migrate `gmb` and `dribbble` to dedicated V2 profiles, land the minors
carried from Batch 3, and document why the remaining four destinations
(`moltbook`, `whop`, `skool`, `mewe`) deliberately stay on the
unverified-adapter bridge. After Batch 4 the matrix becomes 36 = 32 + 4 —
the terminal state of the migration.

## Profile decisions

### `gmb` — verified, three topic-type variants

Official Google Business Profile local-post contract; adapter enforces the
same shapes (`gmb.provider.ts`).

- Body (`summary`) 1,500 UTF-16 units, source `platform`.
- Plain dialect, plain unicode-fallback formatting.
- Media: optional `images(1..1)`; video rejected by the adapter
  (`checkValidity`) and not modeled.
- Variant selection from `settings.topicType` (deterministic, never text):
  - `standard` (default) — structured fields: `callToActionType`,
    `callToActionUrl` optional;
  - `event` — adds `eventTitle` **required** (adapter rejects EVENT without
    it), plus `eventStartDate`, `eventEndDate`, `eventStartTime`,
    `eventEndTime` optional;
  - `offer` — adds `offerCouponCode`, `offerRedeemUrl`, `offerTerms`
    optional.
- Known adapter defects explicitly OUT of scope: hardcoded
  `languageCode: 'en'`; the "reconnect your YouTube account" error copy;
  dead VIDEO branch.

### `dribbble` — verified, media-first

Official Dribbble shots API; adapter enforces one image with exact
400×300 / 800×600 dimensions pre-upload.

- Body (`description`) 40,000 UTF-16 units, `application-safety` (no
  documented API maximum; adapter sentinel kept, never labeled platform).
- Plain dialect; links `plain`.
- Media: **required** `images(1..1)` — the shot IS the post. The exact
  pixel-dimension constraint stays adapter-enforced in `checkValidity`: the
  V2 resolution context carries only media types, so a dimension rule would
  be undeclarable and unenforceable in the shared analyzer (per the parent
  design: dimension constraints appear only where the app can validate
  them; here validation lives at the existing earlier boundary).
- Structured fields: `title` required (DTO MinLength(1)); the `team`
  setting is dead in the adapter and is NOT modeled.

### Remaining bridge destinations (terminal state)

`moltbook`, `whop`, `skool`, `mewe` stay on `unverified-adapter` with
documented reasons (mutable/niche public contract, partner-only API,
private community API, adapter-specific behavior respectively). The matrix
spec asserts exactly these four remain bridged.

## Carried minors landed

1. `ListmonkProvider.maxLength()` returns `1_000_000` — aligns the public
   API advertisement (`GET /integration-settings/:id`) with the enforced
   capability ceiling. Only X consumes the `additionalSettings` argument;
   listmonk ignores it today and keeps ignoring it.
2. Clamp logic in `applyRuntimeOverlay` extracted from the side-effecting
   IIFE into a named helper.
3. Synthetic dual-ceiling test: a profile declaring BOTH `runtimeCeilings`
   and `runtimeMaxCeiling` proves per-key precedence with global fallback
   for unlisted keys.
4. Reddit overlay test tightened to full-object `toEqual`.
5. Title-field absence asserted for hashnode, wordpress, and listmonk
   (matching the existing medium/devto proofs).

No new contract vocabulary. No new units, dialects, or media-rule shapes.

## Testing strategy

TDD per task: variant-selection table for gmb (topicType mapping +
required eventTitle diagnostic path), media-required enforcement for
dribbble, exact limit objects, matrix 36 = 32 + 4 after Task 2, clamp
helper refactor covered by existing tests plus the new dual-ceiling case,
full suite plus all three production builds at the gate on node@22.

## Operational boundary

Local commits only. No push, merge, release, deployment, or production-state change.

## Completion record

Implemented across commits 47ef3fea (gmb profile), 2d8b79d7 (dribbble
profile), and 112ba5ea (listmonk alignment, clamp helper extraction,
dual-ceiling test, reddit `toEqual`, title-absence proofs), followed by the
final docs commit. All profile decisions above landed as specified; the
out-of-scope adapter defects (gmb `languageCode: 'en'` hardcode,
"reconnect your YouTube account" error copy, dead VIDEO branch; dribbble
refreshToken copied from Pinterest hitting pinterest endpoints; listmonk
`maxConcurrentJob` comment saying Bluesky) are recorded in
`docs/content/platform-capability-audit.md`.

Gate on Node v22.23.2 (Homebrew `node@22`): full `pnpm test` passed
1117/1117 tests across 97 files; frontend, backend, and orchestrator
production builds all exited 0. The matrix spec proves exactly 36 unique
registered identifiers = 32 dedicated + 4 bridged (`moltbook`, `whop`,
`skool`, `mewe`), matching `socialIntegrationList`. Prettier check over the
changed docs and `git diff --check` are clean. No external state changed.
