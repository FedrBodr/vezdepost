# Platform Capabilities V2 — Batch 2 Design

**Date:** 2026-08-22
**Linear:** FED-347
**Status:** Implemented and verified locally on 2026-08-22 (see the verified
local pause point at the end); not pushed, merged, released, or deployed
**Parent design:** `docs/superpowers/specs/2026-08-20-platform-capabilities-v2-design.md`

## Goal

Migrate the six remaining chat/federated destinations to dedicated V2 profiles —
`discord`, `twitch`, `kick`, `lemmy`, `wrapcast`, `nostr` (slack and mastodon
were already migrated in Batch 0) — and land the three deferred hardening items
from the Batch 1 final review. After Batch 2 the matrix becomes
36 = 25 + 11.

## Profile decisions (adapter code + official contracts)

| Destination | Verification | Text contract                                                                                                                                                             | Media                                                                                                                                 | Selection          |
| ----------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `discord`   | `verified`   | body 1,980 UTF-16 units, `application-safety` (deliberate margin below the 2,000 platform maximum; never labeled platform), dialect `discord-markdown`, native formatting | optional mixed images/videos, `maxTotal: 10` (Discord attachment cap); `channel` structured field required                            | constant `message` |
| `twitch`    | `verified`   | body 500 UTF-16 units `platform` (official Helix chat limits), plain, bold and underline `unsupported`; links, lists, and headings render as plain text    | none; `messageType` structured field optional (`message` \| `announcement`)                                                           | constant `chat`    |
| `kick`      | `verified`   | body 500 UTF-16 units `platform` (official `chat.send` public API), plain, bold and underline `unsupported`; links, lists, and headings render as plain text | none                                                                                                                                  | constant `chat`    |
| `lemmy`     | `verified`   | `title` provider-setting required (no universal platform max — no limit declared); body Markdown 10,000 UTF-16 units `application-safety` (per-deployment variance)       | optional `images(1..1)` used as `custom_thumbnail` only; `url` structured field optional; multi-community loop stays adapter behavior | constant `post`    |
| `wrapcast`  | `verified`   | body 320 **UTF-8 bytes** `platform` (Farcaster cast protocol maximum; corrects the stale adapter 800)                                                                     | optional `images(1..2)` (cast embed cap); `channelId` structured field optional                                                       | constant `cast`    |
| `nostr`     | `verified`   | body 100,000 UTF-16 units `application-safety` (no protocol-wide maximum; adapter sentinel kept but never labeled platform), plain                                        | optional mixed (adapter appends media paths as text URLs; NIP-92 metadata out of scope)                                               | constant `note`    |

Editor-mode correction: lemmy's adapter declares `editor: 'normal'` while
publishing Markdown bodies — the dedicated profile fixes the dialect to
`markdown` without changing the adapter's editor declaration.

## Hardening items (from Batch 1 final review)

1. **Facet anchoring hardening** (bluesky): anchor labels are searched forward
   from the previous facet end (no `indexOf` mis-anchoring on duplicate
   labels), nested anchors never emit duplicate facets, and bare-URL ranges
   are dropped when they partially overlap an anchor-derived facet (Bluesky
   rejects overlapping index ranges).
2. **Runtime overlay clamping**: `PlatformCapabilityProfileV2` gains optional
   `runtimeMaxCeiling?: number`; `applyRuntimeOverlay` clamps any runtime text
   limit to the declared ceiling. X declares `4000`; reddit declares `300`
   (its overlays only lower today). Provider mistakes become non-exploitable.
3. **Reddit multi-subreddit validation**: `extractSubreddit` yields all
   configured subreddits; `fetchCapabilityRuntime` queries each (bounded to
   the first 10) and applies the strictest (minimum) title maximum, matching
   the adapter's fan-out loop.

## Contract changes

- One new optional profile field: `runtimeMaxCeiling?: number`. No new units,
  dialects, or media-rule shapes are required.

## Testing strategy

TDD per task as in Batches 0–1: contract tests per profile (limits, units,
variants, media, structured fields, immutability), facet hardening regressions,
clamp tests (overlay above ceiling is clamped, X premium still reaches 4,000),
reddit strictest-maximum tests with mocked multi-subreddit responses, matrix
updated to 36 = 25 + 11 after each profile task, full suite plus all three
production builds at the final gate on Node ≥22.12 via pnpm.

## Operational boundary

Local commits only in the isolated worktree. No push, merge, release,
deployment, or production-state change.

## Verified local pause point (2026-08-22)

All six profiles landed as specified above with `verification: 'verified'`
and the audited evidence date 2026-08-20, together with the three hardening
items. The matrix is 36 unique registered identifiers = 25 dedicated profiles

- 11 bridged; the remaining bridged identifiers are `gmb`, `dribbble`,
  `medium`, `devto`, `hashnode`, `wordpress`, `listmonk`, `moltbook`, `whop`,
  `skool`, and `mewe`.

Verification used Node v22.23.2 (Homebrew `node@22`): the full `pnpm test`
gate passed 1094/1094 tests across 97 files, and the frontend, backend, and
orchestrator production builds all exited 0. Static integrity proofs passed:
no `unverified-adapter` record remains in the profile file, and the matrix
spec proves exactly 36 unique registered identifiers resolve through V2. This
is a local pause point only.
