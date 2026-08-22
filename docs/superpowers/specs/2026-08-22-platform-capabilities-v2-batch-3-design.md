# Platform Capabilities V2 — Batch 3 Design

**Date:** 2026-08-22
**Linear:** FED-347
**Status:** Approved boundaries (audit Batch 3 + carried minors); not started
**Parent design:** `docs/superpowers/specs/2026-08-20-platform-capabilities-v2-design.md`

## Goal

Migrate the five article/CMS/email destinations — `medium`, `devto`,
`hashnode`, `wordpress`, `listmonk` — to dedicated V2 profiles under an
article/campaign contract (title + body + structured metadata + publish
state), and land the two carried hardening minors. After Batch 3 the matrix
becomes 36 = 30 + 6. Batch 4 (`gmb`, `dribbble`, `moltbook`, `whop`,
`skool`, `mewe`) remains out of scope.

## Profile decisions (adapter code + official contracts)

All five are single-variant profiles (constant variant, no selection
branches). Titles are provider-settings with no declared limit — no
universal title maximum exists for any of these APIs, and none is invented.

| Destination | Verification | Body contract | Media | Structured fields |
| --- | --- | --- | --- | --- |
| `medium` | `verified` | Markdown, 100,000 UTF-16 `application-safety` (no documented API body limit; adapter sentinel kept, never labeled platform) | none | `title` required; `tags` optional (≤4, DTO cap); `canonical`, `publication` optional |
| `devto` | `verified` | Markdown, 100,000 UTF-16 `application-safety` (same rationale) | optional `images(1..1)` cover (`main_image`) | `title` required; `tags` optional (≤4); `organization`, `canonical` optional |
| `hashnode` | `verified` | Markdown, 10,000 UTF-16 `application-safety` (adapter cap; no documented maximum) | optional `images(1..1)` cover | `title` required; `publication` required; `tags` (ids), `subtitle`, `canonical` optional |
| `wordpress` | `verified` | HTML (native dialect), 100,000 UTF-16 `application-safety` (no WordPress-wide content maximum) | optional `images(1..1)` featured image | `title` required; `type` required; `status`, `categories`, `tags` optional |
| `listmonk` | `verified` | HTML (native), 1,000,000 UTF-16 `application-safety` — **corrects the meaningless 100,000,000 adapter sentinel** to a bounded application cap | none | `subject` required; `list` required; `template`, `preview` optional |

Evidence notes recorded in docs: Medium API is legacy/archived; dev.to is
the official Forem API; hashnode uses the official gql.hashnode.com GraphQL
contract; wordpress the official REST posts API; listmonk the official
campaigns API. Publish state (medium draft-to-publication, devto always
published, wordpress status enum) remains adapter behavior — capabilities
declare the fields, not the workflow.

## Carried hardening minors (from Batch 2 final review)

1. **Key-scoped ceilings.** `PlatformCapabilityProfileV2` gains optional
   `runtimeCeilings?: Readonly<Record<string, number>>` taking precedence
   over the global `runtimeMaxCeiling`. Reddit moves to
   `runtimeCeilings: { title: 300 }` so a future reddit body overlay is not
   wrongly clamped to 300. X keeps its global 4000. The
   `runtime-limit-clamped` diagnostic is unchanged.
2. **Wrapcast exact-boundary test.** Add a mixed-content case measuring
   exactly 320 UTF-8 bytes (e.g. 105 CJK + 5 ASCII) that passes, alongside
   the existing 321-byte blocking case.

## Testing strategy

TDD per task as in Batches 0–2: contract tests per profile (exact limit
objects, dialect, structured fields, media rules, immutability), markdown
normalization evidence for the three markdown profiles, clamp precedence
tests (per-key beats global; global still applies to unlisted keys),
wrapcast boundary test, matrix updated to 36 = 30 + 6 after the profile
tasks, full suite plus all three production builds at the final gate on
node@22 via pnpm.

## Operational boundary

Local commits only in the isolated worktree. No push, merge, release,
deployment, or production-state change.
