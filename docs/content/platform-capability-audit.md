# Platform capability audit: remaining integrations

**Date:** 2026-08-20  
**Linear:** FED-346  
**Scope:** The 29 registered destinations that are not part of the first verified
wave (`telegram`, `max`, `linkedin`, `tumblr`, `pinterest`, `vk`, `vk-group`).
Batch 0 verified or made runtime-aware four of those destinations, Batch 1
migrated eight high-usage publishers onto dedicated profiles, Batch 2
migrated the six remaining chat/federated destinations, and Batch 3 migrated
the five article/CMS/email destinations; the remaining 6 use the explicit V2
`unverified-adapter` bridge.

**Batch 0 status:** Complete and verified locally on 2026-08-21; not pushed,
merged, released, or deployed.

**Batch 1 status:** Complete and verified locally on 2026-08-22; not pushed,
merged, released, or deployed.

**Batch 2 status:** Complete and verified locally on 2026-08-22; not pushed,
merged, released, or deployed.

**Batch 3 status:** Complete and verified locally on 2026-08-22; not pushed,
merged, released, or deployed.

## Evidence policy

This audit separates three kinds of evidence:

- **Official** — a current first-party API or protocol contract was available.
- **Adapter** — behavior is confirmed by the provider implementation currently
  registered in `socialIntegrationList`, but no stable public contract was found.
- **Runtime** — the value is controlled by an account, community, instance, or
  creator-info response and must not be frozen into a global static profile.

The existing `maxLength()` values are recorded as implementation behavior, not
automatically treated as platform truth. This distinction exposes several
existing mismatches that should be fixed before a profile is marked `verified`.

## Confirmed inventory

| Destination            | Text and formatting                                                                   |                                                                                             Text limit | Media and required fields                                                                                                                    | Evidence                                                                                                                                                                                                         | Recommended treatment                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------- | -----------------------------------------------------------------------------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `x`                    | Plain text with entities; rich text toolbar should use Unicode/plain fallbacks        |                                  280, or 4,000 for the premium path currently supported by the adapter | Images, video, or GIF through uploaded media IDs; poll/reply/community options are mutually constrained                                      | [Official post API](https://docs.x.com/x-api/posts/create-post), [official post model](https://docs.x.com/x-api/posts/lookup/introduction), adapter                                                              | Keep the account-aware limit resolver; add explicit media cardinality and weighted-length diagnostics before marking verified    |
| `linkedin-page`        | Same plain-text delivery model as personal LinkedIn                                   |                                                                         3,000 in the inherited adapter | Images and one video; organization-specific settings and analytics                                                                           | Adapter inheritance from `LinkedinProvider`                                                                                                                                                                      | Batch 0 aliases the verified `linkedin` profile while preserving the requested page identifier                                   |
| `facebook`             | Plain text; links are native entities rather than editor HTML                         |                                                                                  63,206 in the adapter | Text/link/photo/video/reel; story requires media; `post_type` changes the contract                                                           | Meta Page adapter; public Meta docs are unstable in search                                                                                                                                                       | Split feed, story, and reel modes instead of one permissive profile                                                              |
| `instagram`            | Plain caption; formatting is not HTML/Markdown                                        |                                                                                   2,200 in the adapter | Media required; up to 10 carousel items; reels/stories/trial reels have distinct constraints                                                 | [Official Meta Instagram collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), adapter                                                                                        | Model feed/carousel, story, reel, and trial-reel variants; retain runtime audio/collaborator checks                              |
| `instagram-standalone` | Same caption model as `instagram`                                                     |                                                                                   2,200 in the adapter | Media required; trial reel must be one video; feature surface is smaller than the Meta-login adapter                                         | Adapter                                                                                                                                                                                                          | Reuse the Instagram base profile but intersect it with standalone capabilities                                                   |
| `threads`              | Plain text with link/mention entities; the API is gaining explicit styling metadata   |                                                                                     500 in the adapter | Text, single image/video, or carousel; container then publish flow                                                                           | [Official Meta Threads collection](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api), adapter                                                                                              | Add a dedicated profile; keep styling disabled until the production adapter emits styling metadata                               |
| `youtube`              | Plain metadata, not post-body rich text                                               |                                                        Description: 5,000 bytes; title: 100 characters | Video required; title, category, privacy, tags, thumbnail and made-for-kids/synthetic-media settings are separate fields                     | [Official video resource](https://developers.google.com/youtube/v3/docs/videos), [official insert method](https://developers.google.com/youtube/v3/docs/videos/insert)                                           | Treat as video-first; do not map the editor message directly to a generic social-post limit                                      |
| `tiktok`               | Plain caption with hashtags and mentions                                              |                 Video caption: 2,200 UTF-16 units; photo title: 90 and description: 4,000 UTF-16 units | Exactly one video, or one to 35 images; creator-info controls privacy and interaction options; brand/AIGC flags and cover are special fields | [Official video direct-post API](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post), [official photo API](https://developers.tiktok.com/doc/content-posting-api-reference-photo-post/) | Batch 0 uses verified media-selected `video` and `photo` variants and corrects the adapter fallback to 2,200                     |
| `bluesky`              | Plain text plus byte-indexed facets for links and mentions; not Markdown              |                                                                                     300 in the adapter | Up to four images or one video in the current adapter; image alt text and aspect ratio belong to embeds                                      | [Official post guide](https://docs.bsky.app/docs/advanced-guides/posts), [official rich-text guide](https://docs.bsky.app/docs/advanced-guides/post-richtext), adapter                                           | High-confidence dedicated profile; keep facets separate from editor HTML                                                         |
| `mastodon`             | Plain text interpreted by the target server; content warning is a separate field      | Runtime instance configuration; 500-grapheme application-safety fallback when data is missing or stale | Runtime media maximum, poll, visibility, language, sensitive flag and content warning; media/poll are mutually constrained                   | [Official status API](https://docs.joinmastodon.org/methods/statuses/), [official posting guide](https://docs.joinmastodon.org/user/posting/), adapter                                                           | Batch 0 resolves text/media limits from `/api/v2/instance`, keeps `verification: runtime`, and warns on safe fallback            |
| `reddit`               | Markdown self-text; link and media posts are structurally different                   | Adapter body limit: 10,000; title has a site maximum of 300 and subreddit requirements can be stricter | Subreddit and title required; kind, flair, URL/media, NSFW, spoiler and community requirements vary                                          | [Official submit API](https://www.reddit.com/dev/api/#POST_api_submit), adapter                                                                                                                                  | Use a structured Reddit profile with runtime subreddit requirements; change editor output to Markdown only for self-post mode    |
| `slack`                | Slack `mrkdwn`, not CommonMark/HTML                                                   |                                                         40,000 UTF-16 units; recommended maximum 4,000 | Channel required; blocks, attachments, thread and unfurl controls alter rendering                                                            | [Official `chat.postMessage`](https://api.slack.com/methods/chat.postMessage), adapter                                                                                                                           | Batch 0 corrects the adapter to 40,000 and models `slack-mrkdwn` with a separate nonblocking 4,000 recommendation                |
| `discord`              | Discord Markdown                                                                      |                                                    API maximum 2,000; adapter intentionally uses 1,980 | Attachments, embeds and threads are supported; mention policy must be controlled                                                             | [Official message resource](https://docs.discord.com/developers/resources/message), adapter                                                                                                                      | Keep the 1,980 safety margin and expose it explicitly as an implementation-safe maximum                                          |
| `kick`                 | Plain chat text                                                                       |                                                                                     500 in the adapter | Chat message; no post media path in the current adapter                                                                                      | Adapter only                                                                                                                                                                                                     | Low-risk chat profile, but keep `verified: false` until Kick's stable public chat contract is captured                           |
| `twitch`               | Plain chat text with platform emoticons                                               |                                                                                                    500 | Chat message only in the current provider; no post media                                                                                     | [Official Send Chat Message API](https://dev.twitch.tv/docs/api/reference#send-chat-message), adapter                                                                                                            | Dedicated chat profile; media unsupported                                                                                        |
| `lemmy`                | Markdown body with a separate title and optional URL                                  |                                   10,000 adapter safety limit; deployments and API versions can differ | Community and title required; optional URL/image cover; current adapter accepts one cover image                                              | [Official API overview](https://join-lemmy.org/docs/contributors/04-api.html), [official federation model](https://join-lemmy.org/docs/en/contributors/05-federation.html), adapter                              | Runtime/version-aware federated profile; Markdown is native                                                                      |
| `wrapcast`             | Plain cast text with embeds                                                           |                                                                    800 in the current Warpcast adapter | Current adapter accepts images and rejects video                                                                                             | Adapter only                                                                                                                                                                                                     | Treat as a provider-specific Farcaster gateway; verify the gateway contract before using protocol-level assumptions              |
| `nostr`                | Kind-1 simple plaintext; Markdown and HTML should not be used                         |                                                 No protocol-wide content maximum; adapter uses 100,000 | URLs/media are represented through content and optional NIPs; relay limits vary                                                              | [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md), [NIP-10](https://github.com/nostr-protocol/nips/blob/master/10.md), adapter                                                                  | Plain-text profile with a conservative product limit and relay-error handling; never call the limit protocol-verified            |
| `medium`               | Native Markdown or semantic HTML                                                      |                                 Adapter safety limit: 100,000; no durable API body limit is documented | Title required; canonical URL, up to three effective tags, publication and publish status                                                    | [Archived official API docs](https://github.com/Medium/medium-api-docs), adapter                                                                                                                                 | Batch 3 ships a verified Markdown article profile; the API is legacy/archived and 100,000 stays application-safety               |
| `devto`                | Native Markdown plus Forem Liquid tags                                                |                                                                          Adapter safety limit: 100,000 | Title and body required; tags, series, cover image, canonical URL, organization and draft/publish state                                      | [Official Forem API](https://developers.forem.com/api/v1), adapter                                                                                                                                               | Batch 3 ships a verified Markdown article profile with an optional cover image                                                   |
| `hashnode`             | Native Markdown in the current adapter                                                |                                                                                  Adapter limit: 10,000 | Publication, title, tags, cover and canonical/original URL are structured settings                                                           | Adapter; public API search did not yield a stable current field contract                                                                                                                                         | Batch 3 ships a verified Markdown article profile on the official gql.hashnode.com contract with `publication` required          |
| `wordpress`            | Native HTML content                                                                   |                                       No WordPress-wide content maximum; adapter safety limit: 100,000 | Title, status, categories, tags and featured media are separate fields                                                                       | [Official REST posts API](https://developer.wordpress.org/rest-api/reference/posts/), adapter                                                                                                                    | Batch 3 ships a verified HTML post profile on the official WP REST contract; 100,000 is never presented as a WordPress limit     |
| `listmonk`             | HTML, Markdown, plain, richtext or visual campaign source depending on `content_type` |                                  No documented universal body maximum; adapter sentinel is 100,000,000 | Subject, lists, sender, campaign type, template, schedule and alternate plain body                                                           | [Official campaign API](https://listmonk.app/docs/apis/campaigns/), adapter                                                                                                                                      | Batch 3 ships a verified HTML campaign profile on the official campaigns API; the 100,000,000 sentinel is corrected to 1,000,000 |
| `gmb`                  | Plain summary text                                                                    |                                                                                   1,500 in the adapter | Zero or one image, no video in current Local Posts flow; event title/date, offer and CTA fields depend on topic type                         | [Official Google Business Profile post guide](https://developers.google.com/my-business/content/posts-data), adapter                                                                                             | Structured local-post profile with topic-type variants                                                                           |
| `dribbble`             | Description accepts limited HTML/autolinks; title is separate                         |                     Adapter safety limit: 40,000; official API does not document a description maximum | Exactly one image in the current create API, 400x300 or 800x600, max 8 MB; title required; API video creation is unsupported                 | [Official shots API](https://developer.dribbble.com/v2/shots/), [official description media types](https://developer.dribbble.com/v2/media/), adapter                                                            | Media-first profile; fix the misleading generic text-first UX                                                                    |
| `moltbook`             | Plain content in the current adapter                                                  |                                                                                     300 in the adapter | Submolt and title required; text or link post; current adapter has no media post path                                                        | [Moltbook API instructions](https://www.moltbook.com/post/2eddec41-96dd-4d71-9c28-59330384faef), adapter                                                                                                         | Niche structured profile; keep unverified because the public contract is mutable                                                 |
| `whop`                 | Native Markdown message content                                                       |                    Adapter limit: 50,000; no maximum is exposed in the current public method reference | Channel required; attachments, polls, replies and link previews supported by the API                                                         | [Official create-message API](https://docs.whop.com/api-reference/messages/create-message), adapter                                                                                                              | Chat/community profile; retain the adapter limit as unverified until server behavior is tested                                   |
| `skool`                | Plain text in the current adapter                                                     |                                                                                   5,000 in the adapter | Community/category identifiers are adapter-specific; no public media contract is established                                                 | Adapter only                                                                                                                                                                                                     | Defer until authenticated contract tests can capture the private/partner API behavior                                            |
| `mewe`                 | Plain text in the current adapter                                                     |                                                                                  63,206 in the adapter | Group/profile destination and media behavior are adapter-specific                                                                            | Adapter only                                                                                                                                                                                                     | Defer; do not reuse Facebook's coincidentally identical limit without evidence                                                   |

## Findings that require correction before expansion

1. **Slack is currently dangerously permissive.** `maxLength()` returns 400,000,
   while `chat.postMessage` truncates text beyond 40,000 and recommends 4,000.
2. **TikTok uses one stale generic limit.** The adapter returns 2,000, while the
   current API has distinct video-caption and photo title/description limits.
3. **Mastodon cannot have one static verified profile.** Character and media
   limits must come from the connected instance configuration.
4. **LinkedIn Page is an avoidable fallback.** It inherits the audited personal
   LinkedIn behavior and should resolve through a deliberate profile alias.
5. **Several large numbers are product sentinels, not platform contracts.** This
   applies especially to Listmonk, Nostr, WordPress, Medium, DEV and Whop.
6. **Media-first and article/email destinations do not fit one `text.max`
   abstraction.** YouTube, TikTok photo/video modes, Dribbble and Listmonk need
   mode-specific text fields rather than a single generic message limit.

## Batch 0 completion evidence

The V1 `PlatformCapabilities` and single-message analysis modules have been
removed. Every identifier is read directly from `socialIntegrationList` and
resolved by `IntegrationManager.resolveCapabilitiesV2`:

- 36 unique registered identifiers resolve through V2;
- 11 Batch 0 identifiers resolve without the bridge: `telegram`, `max`,
  `linkedin`, `linkedin-page`, `tumblr`, `pinterest`, `vk`, `vk-group`,
  `slack`, `tiktok`, and `mastodon`;
- `linkedin-page` is the only alias and preserves its requested identifier
  while using the `linkedin` profile;
- the remaining 25 identifiers resolve explicitly with
  `verification: 'unverified-adapter'`: `x`, `reddit`, `instagram`,
  `instagram-standalone`, `facebook`, `threads`, `youtube`, `gmb`, `dribbble`,
  `discord`, `kick`, `twitch`, `bluesky`, `lemmy`, `wrapcast`, `nostr`,
  `medium`, `devto`, `hashnode`, `wordpress`, `listmonk`, `moltbook`, `whop`,
  `skool`, and `mewe`.

Local verification used Node 22.20.0. The focused Task 7 gate passed 195/195
tests, `pnpm test` passed 976/976 tests, and the frontend, backend, and
orchestrator production builds all exited successfully. These results are a
local Batch 0 pause point only; no external state changed.

## Batch 1 completion evidence

Batch 1 migrated the eight remaining high-usage public publishing destinations
off the `unverified-adapter` bridge onto dedicated V2 profiles:

- `bluesky` — verified 2026-08-21 evidence date; body 300 graphemes with the
  `bluesky-facets` dialect and UTF-8 byte-indexed link facets;
- `threads` — verified 2026-08-20; body 500 UTF-16 units with `text`,
  `single`, and `carousel` variants;
- `youtube` — verified 2026-08-20; required `title` (100 UTF-16 units) and
  5,000-byte `description`, required single video;
- `x` — runtime 2026-08-20; weighted body with a 280 platform fallback and a
  4,000 runtime overlay from the stored Premium entitlement;
- `reddit` — runtime 2026-08-20; structured variants (`self`, `link`,
  `image`, `video`) with subreddit `post_requirements` runtime overlay;
- `instagram` — verified 2026-08-20; caption 2,200 UTF-16 units with `feed`,
  `story`, `reel`, and `trial-reel` variants;
- `instagram-standalone` — verified alias of `instagram` preserving the
  requested identifier;
- `facebook` — verified 2026-08-20; `feed`, `story` (no text), and `video`
  variants.

The matrix is now 36 unique registered identifiers = 19 with dedicated
profiles + 17 on the bridge:

- 19 dedicated: `telegram`, `max`, `linkedin`, `linkedin-page`, `tumblr`,
  `pinterest`, `vk`, `vk-group`, `slack`, `tiktok`, `mastodon`, `bluesky`,
  `threads`, `youtube`, `x`, `reddit`, `instagram`, `instagram-standalone`,
  and `facebook`;
- 2 aliases: `linkedin-page` (Batch 0, resolves the `linkedin` profile) and
  `instagram-standalone` (Batch 1, resolves the `instagram` profile), both
  preserving the requested identifier;
- runtime overlays: X Premium entitlement (no staleness window; auth-time
  data) and Reddit subreddit `post_requirements` (title maximum; failures
  resolve the static fallback with a warning). Client data can never raise a
  limit or flip verification;
- 17 bridged identifiers remain with `verification: 'unverified-adapter'`:
  `gmb`, `dribbble`, `discord`, `kick`, `twitch`, `lemmy`, `wrapcast`,
  `nostr`, `medium`, `devto`, `hashnode`, `wordpress`, `listmonk`,
  `moltbook`, `whop`, `skool`, and `mewe`.

Two deliberate behavior changes shipped with Batch 1:

1. `STRIP_LINKS_FROM_X_POSTS` was removed entirely; X no longer strips raw
   URLs at transport or capability level, and raw URLs are preserved and
   counted by the weighted counter (23 units per URL).
2. `fetchCapabilityRuntime` receives post settings as its second argument so
   Reddit can resolve subreddit requirements; Mastodon ignores it.

Batch 1 also reordered publication media authorization to run before
capability analysis, so SSRF authorization of secondary sources (such as
`settings.thumbnail.path` and `media.thumbnail`) can no longer be masked by
required-field diagnostics.

Local verification used Node v22.23.2 (Homebrew `node@22`, satisfying the
`>=22.12.0 <23.0.0` engine range). The full `pnpm test` gate passed
1072/1072 tests across 97 files, the frontend, backend, and orchestrator
production builds all exited 0, and the static integrity proofs
(`BATCH_0_*` symbols absent; no `unverified-adapter` in the profile record)
passed. These results are a local Batch 1 pause point only; no external
state changed.

## Batch 2 completion evidence

Batch 2 migrated the six remaining chat/federated destinations off the
`unverified-adapter` bridge onto dedicated verified profiles, all recording
the audited evidence date 2026-08-20:

- `discord` — verified; body 1,980 UTF-16 units with dialect
  `discord-markdown`. The 1,980 maximum is an explicit application-safety
  margin below Discord's 2,000 platform maximum and is never labeled
  platform. Optional mixed images/videos up to a total of 10 attachments and
  a required structured `channel` field.
- `twitch` — verified; body 500 UTF-16 units `platform` from the official
  Helix chat limits; plain dialect with links plain only; no media.
- `kick` — verified; body 500 UTF-16 units `platform` from the official
  public `chat.send` API; plain dialect with links plain only; no media.
- `lemmy` — verified; required `title` provider setting (no universal
  platform maximum is declared) and a Markdown body of 10,000 UTF-16 units
  `application-safety` for per-deployment variance. The adapter declares
  editor mode `normal` while publishing Markdown bodies; the dedicated
  profile fixes the output dialect to `markdown` without changing the
  adapter's declaration. One optional image used as a custom thumbnail only.
- `wrapcast` — verified; body 320 **UTF-8 bytes** `platform`, the Farcaster
  cast protocol maximum. This corrects the stale adapter limit of 800
  characters. Optional one-to-two images and an optional `channelId`
  structured field.
- `nostr` — verified; body 100,000 UTF-16 units `application-safety`. There
  is no protocol-wide content maximum; the adapter sentinel is kept but never
  labeled platform. Plain text only.

The three hardening items deferred from the Batch 1 final review landed in
commit d6826030 (with commit 37774a2c narrowing the Reddit subreddit entry
types for production builds):

1. **Facet anchoring hardening (bluesky):** anchor labels are searched
   forward from the previous facet end, nested anchors never emit duplicate
   facets, and bare-URL ranges partially overlapping anchor-derived facets
   are dropped because Bluesky rejects overlapping index ranges.
2. **Runtime overlay clamping:** `PlatformCapabilityProfileV2` gained the
   optional `runtimeMaxCeiling` field and `applyRuntimeOverlay` clamps any
   runtime text limit to it; `x` declares 4,000 and reddit declares 300, so
   provider mistakes cannot become exploitable limits.
3. **Reddit multi-subreddit validation:** all configured subreddits are
   extracted (bounded to the first 10), each queried at runtime, and the
   strictest (minimum) title maximum applied.

The matrix is now 36 unique registered identifiers = 25 dedicated profiles +
11 bridged:

- 25 dedicated: the 19 from Batch 1 plus `discord`, `twitch`, `kick`,
  `lemmy`, `wrapcast`, and `nostr`;
- 2 aliases unchanged: `linkedin-page` → `linkedin` and
  `instagram-standalone` → `instagram`;
- runtime overlays unchanged in kind: X Premium entitlement (clamped at
  4,000), Mastodon instance configuration, TikTok creator info, and Reddit
  subreddit requirements (clamped at 300; strictest maximum across all
  configured subreddits);
- 11 bridged identifiers remain with `verification: 'unverified-adapter'`:
  `gmb`, `dribbble`, `medium`, `devto`, `hashnode`, `wordpress`, `listmonk`,
  `moltbook`, `whop`, `skool`, and `mewe`.

Local verification used Node v22.23.2 (Homebrew `node@22`). The full
`pnpm test` gate passed 1094/1094 tests across 97 files, the frontend,
backend, and orchestrator production builds all exited 0, and the static
integrity proofs passed (`unverified-adapter` absent from the profile record;
the matrix spec proves exactly 36 unique registered identifiers = 25
dedicated + 11 bridged). These results are a local Batch 2 pause point only;
no external state changed.

## Batch 3 completion evidence

Batch 3 migrated the five article/CMS/email destinations off the
`unverified-adapter` bridge onto dedicated verified profiles, all recording
the audited evidence date 2026-08-20:

- `medium` — verified; Markdown article body of 100,000 UTF-16 units
  `application-safety` (no durable API body limit is documented; the adapter
  sentinel is kept but never labeled platform). Evidence note: the Medium API
  is legacy/archived. Required `title` plus optional `tags`, `canonical`, and
  `publication`; no media. Titles carry no invented limit.
- `devto` — verified; Markdown article body of 100,000 UTF-16 units
  `application-safety` on the same rationale. Evidence note: the official
  Forem API contract. Required `title` plus optional `tags`, `organization`,
  and `canonical`; one optional cover image. Titles carry no invented limit.
- `hashnode` — verified; Markdown article body of 10,000 UTF-16 units
  `application-safety` (adapter cap; no documented maximum). Evidence note:
  the official gql.hashnode.com GraphQL contract. Required `title` and
  required `publication`, plus optional `tags`, `subtitle`, and `canonical`;
  one optional cover image. Titles carry no invented limit.
- `wordpress` — verified; native HTML post body of 100,000 UTF-16 units
  `application-safety` (no WordPress-wide content maximum). Evidence note:
  the official WP REST posts API. Required `title` and required `type`, plus
  optional `status`, `categories`, and `tags`; one optional featured image.
  Titles carry no invented limit.
- `listmonk` — verified; native HTML campaign body of 1,000,000 UTF-16 units
  `application-safety`. Evidence note: the official Listmonk campaigns API.
  **The meaningless 100,000,000 adapter sentinel is corrected to the bounded
  1,000,000 application cap.** Required `subject` and required `list`, plus
  optional `template` and `preview`; no media. Titles carry no invented limit.

The two hardening minors carried from the Batch 2 final review landed in
commit 09d2f662:

1. **Key-scoped runtime ceilings:** `PlatformCapabilityProfileV2` gained the
   optional `runtimeCeilings` map taking precedence over the global
   `runtimeMaxCeiling`; reddit declares `runtimeCeilings: { title: 300 }` and
   x keeps its global 4,000, so a future reddit body overlay is not wrongly
   clamped to 300.
2. **Wrapcast exact-boundary test:** a mixed-content case measuring exactly
   320 UTF-8 bytes passes alongside the existing 321-byte blocking case
   (`platform.content.analysis.spec.ts`).

The matrix is now 36 unique registered identifiers = 30 dedicated profiles +
6 bridged:

- 30 dedicated: the 25 from Batch 2 plus `medium`, `devto`, `hashnode`,
  `wordpress`, and `listmonk`;
- 2 aliases unchanged: `linkedin-page` → `linkedin` and
  `instagram-standalone` → `instagram`;
- runtime overlays unchanged in kind: X Premium entitlement (clamped at
  4,000), Mastodon instance configuration, TikTok creator info, and Reddit
  subreddit requirements (clamped per key at `title: 300`; strictest maximum
  across all configured subreddits);
- 6 bridged identifiers remain with `verification: 'unverified-adapter'`:
  `gmb`, `dribbble`, `moltbook`, `whop`, `skool`, and `mewe` (Batch 4 scope).

One fixture drift was corrected during the final gate: the pre-Batch-3
wordpress secondary-source fixture in
`apps/orchestrator/src/activities/post.activity.formatting.spec.ts` carried
no `title`/`type` settings and a video primary; the verified wordpress
profile now requires both settings and images-only media, so the fixture was
updated to match the WP REST contract.

Local verification used Node v22.23.2 (Homebrew `node@22`). The full
`pnpm test` gate passed 1104/1104 tests across 97 files, the frontend,
backend, and orchestrator production builds all exited 0, and the static
integrity proofs passed (`unverified-adapter` absent from the profile record;
the matrix spec proves exactly 36 unique registered identifiers = 30
dedicated + 6 bridged, matching `socialIntegrationList`). These results are a
local Batch 3 pause point only; no external state changed.

## Prioritized implementation batches for FED-347

### Batch 0 — correctness guardrails

No new destination should be marked verified until these are addressed:

- Slack safe maximum and `mrkdwn` dialect;
- TikTok video/photo mode-specific limits;
- runtime Mastodon capability resolution;
- `linkedin-page` profile alias;
- distinction between platform limits and internal safety sentinels.

### Batch 1 — high-usage public publishing APIs

`x`, `facebook`, `instagram`, `instagram-standalone`, `threads`, `youtube`,
`tiktok`, `bluesky`, `reddit`, `linkedin-page`.

These have the largest user impact and the clearest public contracts. Implement
mode variants where a destination has materially different post structures.

### Batch 2 — chat and federated destinations

`slack`, `discord`, `twitch`, `kick`, `mastodon`, `lemmy`, `wrapcast`, `nostr`.

This batch needs explicit output dialects (`mrkdwn`, Discord Markdown,
plaintext) and runtime/server capability support.

### Batch 3 — articles, CMS and email

`medium`, `devto`, `hashnode`, `wordpress`, `listmonk`.

These should use an article/campaign contract with title, body, metadata and
publish state instead of pretending to be short social posts.

### Batch 4 — niche and partner/private APIs

`gmb`, `dribbble`, `moltbook`, `whop`, `skool`, `mewe`.

Google Business Profile and Dribbble have usable public contracts. The other
four should stay unverified until authenticated contract tests or stable partner
documentation can prove their current behavior.

## Required model changes discovered by the audit

The current `PlatformCapabilities` shape is sufficient for the first seven
destinations but cannot accurately represent the remaining inventory without:

- named content fields with independent limits and units (`characters`,
  `UTF-16`, `bytes`);
- post variants/modes with conditional requirements;
- an explicit formatting dialect instead of only `EditorMode`;
- runtime capability sources for instance/account/community constraints;
- separation of platform-enforced maxima from conservative application limits;
- media cardinality rules that can express exclusive combinations such as
  images versus one video, media versus poll, or media-required modes.

FED-347 should begin with these contract extensions and migrations, then add
profiles batch by batch. Existing first-wave behavior must remain the default
compatibility baseline during the migration.
