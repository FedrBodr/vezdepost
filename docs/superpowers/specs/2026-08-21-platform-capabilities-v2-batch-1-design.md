# Platform Capabilities V2 — Batch 1 Design

**Date:** 2026-08-21
**Linear:** FED-347
**Status:** Approved boundaries; not started
**Parent design:** `docs/superpowers/specs/2026-08-20-platform-capabilities-v2-design.md`

## Goal

Migrate the eight remaining high-usage public publishing destinations from the
explicit `unverified-adapter` bridge to dedicated V2 profiles:
`bluesky`, `threads`, `youtube`, `x`, `reddit`, `instagram`,
`instagram-standalone`, and `facebook`.

After Batch 1 the matrix becomes 36 destinations: 19 with dedicated profiles,
17 still on the bridge. No database migration and no historical content
conversion is performed. Breaking changes to internal APIs are allowed.

## Evidence basis

Each profile records an `evidenceDate` and separates platform facts from
adapter behavior, following the audit in `docs/content/platform-capability-audit.md`
and the current adapter code:

| Destination | Verification | Text contract | Media contract | Selection inputs |
| --- | --- | --- | --- | --- |
| `bluesky` | `verified` | body 300 **graphemes**, dialect `bluesky-facets`; link facets computed with UTF-8 byte indices | exclusive optional `images(1..4) \| video(1)` (already enforced in `checkValidity`) | media |
| `threads` | `verified` | body 500 UTF-16 units, plain | `text` (none), `single` (exclusive image\|video), `carousel` (required, mixed, maxTotal 20) | media count |
| `youtube` | `verified` | `title` provider-setting 100 UTF-16 units; `description` (editor body) 5,000 **UTF-8 bytes** | required `video(1)` | constant |
| `x` | `runtime` | body weighted (`x-weighted`); 280 platform fallback, 4,000 via runtime overlay from the stored Premium entitlement | exclusive optional `images(1..4) \| video(1)` | media |
| `reddit` | `runtime` | `title` provider-setting 300 UTF-16 units (site maximum); `self` body Markdown 10,000 application-safety | `link` (URL required), `image` (exactly 1 image), `video` (exactly 1 video, cover required); subreddit `submission_type` via runtime overlay | settings URL, media, subreddit runtime |
| `instagram` | `verified` | caption 2,200 UTF-16 units, plain | `feed` (required, mixed, maxTotal 10), `story` (required, mixed), `reel` (1 video), `trial-reel` (exactly 1 video) | `post_type`, `is_trial_reel`, media |
| `instagram-standalone` | `verified` | alias of `instagram` | alias of `instagram` | alias |
| `facebook` | `verified` | feed body 63,206 UTF-16 units; `story` publishes **no text** (body field absent); video/reel uses body as description | `feed` (optional photos/link), `story` (media required), `video` (exactly 1 mp4) | `post_type`, media |

## Contract changes

No new type vocabulary is required. The existing `ContentUnit` values
(`graphemes`, `utf8-bytes`, `weighted`), `FormattingDialect` value
`bluesky-facets`, `exclusive` media rules, aliases, and runtime overlays cover
every case above. Two deliberate changes:

1. **Registry rename.** `BATCH_0_PROFILES`/`BATCH_0_IDENTIFIERS` become
   `PLATFORM_CAPABILITY_PROFILES`/`PROFILE_IDENTIFIERS`. Batch 1 profiles live
   in the same immutable record. No compatibility shim.
2. **Runtime fetch signature.** `SocialProvider.fetchCapabilityRuntime`
   gains an optional second parameter `settings` so Reddit can resolve
   subreddit requirements from post settings. Mastodon ignores it.

## Normalization additions

- `bluesky-facets`: plain-text output plus link facets
  (`app.bsky.richtext.facet#link`) with `byteStart`/`byteEnd` UTF-8 indices
  computed from the normalized visible text. Mention facets stay the
  adapter's responsibility (DID resolution happens at post time).
- `markdown` for Reddit self-posts reuses the existing deterministic
  HTML-to-Markdown traversal.
- Facebook `story` has no canonical-editor field, so nothing derived from the
  editor is silently dropped: the variant simply declares no body field.

## Runtime overlays

- **X:** `fetchCapabilityRuntime(integration)` builds the overlay from the
  server-stored Premium entitlement (`additionalSettings` entry written at
  authenticate time); `observedAt` is the integration's last update time. No
  staleness window: the entitlement is auth-time data, not a live probe.
  Missing overlay resolves 280 with a `runtime-data-missing` warning.
- **Reddit:** `fetchCapabilityRuntime(integration, settings)` queries the
  configured subreddit (`post_requirements`) and maps any stricter title
  maximum to the runtime `title` limit. `submission_type` remains
  adapter-enforced in Batch 1; failures resolve the static fallback with the
  standard warning. Client data can never raise a limit or flip verification.

## Resolution rules (deterministic, never text heuristics)

- `bluesky`, `threads`, `youtube`, `facebook`, `instagram`: pure functions of
  media array and provider settings as listed in the table above. Invalid
  combinations (e.g. Instagram trial-reel without exactly one video) resolve
  to the default variant plus an `invalid-media-variant` error diagnostic,
  matching the TikTok precedent.
- `x`: default variant `post`; media-independent.
- `reddit`: `url` setting present → `link`; exactly one image → `image`;
  exactly one video → `video`; otherwise `self`.

## Testing strategy

TDD per task, following Batch 0 practice:

- Contract tests per profile: limits, units, variants, selection diagnostics,
  immutability, alias identity preservation.
- Facet tests: byte indices over multibyte content, multiple links, no-link
  absence.
- Manager tests: X premium overlay from stored settings, Reddit subreddit
  overlay, client-supplied escalation rejected.
- Matrix test updated to the exact 36 = 19 + 17 result after every profile
  task.
- Full suite plus frontend/backend/orchestrator production builds at the
  final gate, on Node 22.20.0 via pnpm.

## Operational boundary

Local commits only in the isolated worktree. No push, merge, release,
deployment, or production-state change.
