# Platform capability audit: remaining integrations

**Date:** 2026-08-20  
**Linear:** FED-346  
**Scope:** The 29 registered destinations that are not part of the first verified
wave (`telegram`, `max`, `linkedin`, `tumblr`, `pinterest`, `vk`, `vk-group`).

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

| Destination            | Text and formatting                                                                   |                                                                                                 Text limit | Media and required fields                                                                                                    | Evidence                                                                                                                                                                                                         | Recommended treatment                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------: | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `x`                    | Plain text with entities; rich text toolbar should use Unicode/plain fallbacks        |                                      280, or 4,000 for the premium path currently supported by the adapter | Images, video, or GIF through uploaded media IDs; poll/reply/community options are mutually constrained                      | [Official post API](https://docs.x.com/x-api/posts/create-post), [official post model](https://docs.x.com/x-api/posts/lookup/introduction), adapter                                                              | Keep the account-aware limit resolver; add explicit media cardinality and weighted-length diagnostics before marking verified |
| `linkedin-page`        | Same plain-text delivery model as personal LinkedIn                                   |                                                                             3,000 in the inherited adapter | Images and one video; organization-specific settings and analytics                                                           | Adapter inheritance from `LinkedinProvider`                                                                                                                                                                      | Alias the existing verified `linkedin` profile, preserving the page identifier                                                |
| `facebook`             | Plain text; links are native entities rather than editor HTML                         |                                                                                      63,206 in the adapter | Text/link/photo/video/reel; story requires media; `post_type` changes the contract                                           | Meta Page adapter; public Meta docs are unstable in search                                                                                                                                                       | Split feed, story, and reel modes instead of one permissive profile                                                           |
| `instagram`            | Plain caption; formatting is not HTML/Markdown                                        |                                                                                       2,200 in the adapter | Media required; up to 10 carousel items; reels/stories/trial reels have distinct constraints                                 | [Official Meta Instagram collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), adapter                                                                                        | Model feed/carousel, story, reel, and trial-reel variants; retain runtime audio/collaborator checks                           |
| `instagram-standalone` | Same caption model as `instagram`                                                     |                                                                                       2,200 in the adapter | Media required; trial reel must be one video; feature surface is smaller than the Meta-login adapter                         | Adapter                                                                                                                                                                                                          | Reuse the Instagram base profile but intersect it with standalone capabilities                                                |
| `threads`              | Plain text with link/mention entities; the API is gaining explicit styling metadata   |                                                                                         500 in the adapter | Text, single image/video, or carousel; container then publish flow                                                           | [Official Meta Threads collection](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api), adapter                                                                                              | Add a dedicated profile; keep styling disabled until the production adapter emits styling metadata                            |
| `youtube`              | Plain metadata, not post-body rich text                                               |                                                            Description: 5,000 bytes; title: 100 characters | Video required; title, category, privacy, tags, thumbnail and made-for-kids/synthetic-media settings are separate fields     | [Official video resource](https://developers.google.com/youtube/v3/docs/videos), [official insert method](https://developers.google.com/youtube/v3/docs/videos/insert)                                           | Treat as video-first; do not map the editor message directly to a generic social-post limit                                   |
| `tiktok`               | Plain caption with hashtags and mentions                                              | Video caption: 2,200 UTF-16 units; photo title: 90 and description: 4,000. Adapter currently returns 2,000 | Video or photo post; creator-info controls privacy and interaction options; brand/AIGC flags and cover are special fields    | [Official video direct-post API](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post), [official photo API](https://developers.tiktok.com/doc/content-posting-api-reference-photo-post/) | Fix the stale 2,000 limit and introduce media-mode-specific limits before marking verified                                    |
| `bluesky`              | Plain text plus byte-indexed facets for links and mentions; not Markdown              |                                                                                         300 in the adapter | Up to four images or one video in the current adapter; image alt text and aspect ratio belong to embeds                      | [Official post guide](https://docs.bsky.app/docs/advanced-guides/posts), [official rich-text guide](https://docs.bsky.app/docs/advanced-guides/post-richtext), adapter                                           | High-confidence dedicated profile; keep facets separate from editor HTML                                                      |
| `mastodon`             | Plain text interpreted by the target server; content warning is a separate field      |              Runtime instance configuration; 500 is only the Mastodon default and current adapter fallback | Media, poll, visibility, language, sensitive flag and content warning; media/poll are mutually constrained                   | [Official status API](https://docs.joinmastodon.org/methods/statuses/), [official posting guide](https://docs.joinmastodon.org/user/posting/), adapter                                                           | Resolve limits and media configuration from the connected instance; never mark a global 500-character profile verified        |
| `reddit`               | Markdown self-text; link and media posts are structurally different                   |     Adapter body limit: 10,000; title has a site maximum of 300 and subreddit requirements can be stricter | Subreddit and title required; kind, flair, URL/media, NSFW, spoiler and community requirements vary                          | [Official submit API](https://www.reddit.com/dev/api/#POST_api_submit), adapter                                                                                                                                  | Use a structured Reddit profile with runtime subreddit requirements; change editor output to Markdown only for self-post mode |
| `slack`                | Slack `mrkdwn`, not CommonMark/HTML                                                   |                             Recommend 4,000; API truncates after 40,000. Adapter currently returns 400,000 | Channel required; blocks, attachments, thread and unfurl controls alter rendering                                            | [Official `chat.postMessage`](https://api.slack.com/methods/chat.postMessage), adapter                                                                                                                           | Correct the unsafe adapter limit first; model `mrkdwn` as its own output dialect                                              |
| `discord`              | Discord Markdown                                                                      |                                                        API maximum 2,000; adapter intentionally uses 1,980 | Attachments, embeds and threads are supported; mention policy must be controlled                                             | [Official message resource](https://docs.discord.com/developers/resources/message), adapter                                                                                                                      | Keep the 1,980 safety margin and expose it explicitly as an implementation-safe maximum                                       |
| `kick`                 | Plain chat text                                                                       |                                                                                         500 in the adapter | Chat message; no post media path in the current adapter                                                                      | Adapter only                                                                                                                                                                                                     | Low-risk chat profile, but keep `verified: false` until Kick's stable public chat contract is captured                        |
| `twitch`               | Plain chat text with platform emoticons                                               |                                                                                                        500 | Chat message only in the current provider; no post media                                                                     | [Official Send Chat Message API](https://dev.twitch.tv/docs/api/reference#send-chat-message), adapter                                                                                                            | Dedicated chat profile; media unsupported                                                                                     |
| `lemmy`                | Markdown body with a separate title and optional URL                                  |                                       10,000 adapter safety limit; deployments and API versions can differ | Community and title required; optional URL/image cover; current adapter accepts one cover image                              | [Official API overview](https://join-lemmy.org/docs/contributors/04-api.html), [official federation model](https://join-lemmy.org/docs/en/contributors/05-federation.html), adapter                              | Runtime/version-aware federated profile; Markdown is native                                                                   |
| `wrapcast`             | Plain cast text with embeds                                                           |                                                                        800 in the current Warpcast adapter | Current adapter accepts images and rejects video                                                                             | Adapter only                                                                                                                                                                                                     | Treat as a provider-specific Farcaster gateway; verify the gateway contract before using protocol-level assumptions           |
| `nostr`                | Kind-1 simple plaintext; Markdown and HTML should not be used                         |                                                     No protocol-wide content maximum; adapter uses 100,000 | URLs/media are represented through content and optional NIPs; relay limits vary                                              | [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md), [NIP-10](https://github.com/nostr-protocol/nips/blob/master/10.md), adapter                                                                  | Plain-text profile with a conservative product limit and relay-error handling; never call the limit protocol-verified         |
| `medium`               | Native Markdown or semantic HTML                                                      |                                     Adapter safety limit: 100,000; no durable API body limit is documented | Title required; canonical URL, up to three effective tags, publication and publish status                                    | [Archived official API docs](https://github.com/Medium/medium-api-docs), adapter                                                                                                                                 | Keep an article-specific profile and flag the API as legacy/archived                                                          |
| `devto`                | Native Markdown plus Forem Liquid tags                                                |                                                                              Adapter safety limit: 100,000 | Title and body required; tags, series, cover image, canonical URL, organization and draft/publish state                      | [Official Forem API](https://developers.forem.com/api/v1), adapter                                                                                                                                               | Article profile with native Markdown and structured metadata                                                                  |
| `hashnode`             | Native Markdown in the current adapter                                                |                                                                                      Adapter limit: 10,000 | Publication, title, tags, cover and canonical/original URL are structured settings                                           | Adapter; public API search did not yield a stable current field contract                                                                                                                                         | Keep unverified until the current GraphQL contract used by the adapter is captured in a contract test                         |
| `wordpress`            | Native HTML content                                                                   |                                           No WordPress-wide content maximum; adapter safety limit: 100,000 | Title, status, categories, tags and featured media are separate fields                                                       | [Official REST posts API](https://developer.wordpress.org/rest-api/reference/posts/), adapter                                                                                                                    | HTML article profile; do not present 100,000 as a WordPress platform limit                                                    |
| `listmonk`             | HTML, Markdown, plain, richtext or visual campaign source depending on `content_type` |                                      No documented universal body maximum; adapter sentinel is 100,000,000 | Subject, lists, sender, campaign type, template, schedule and alternate plain body                                           | [Official campaign API](https://listmonk.app/docs/apis/campaigns/), adapter                                                                                                                                      | Email-campaign profile, not a social-post profile; select output from `content_type`                                          |
| `gmb`                  | Plain summary text                                                                    |                                                                                       1,500 in the adapter | Zero or one image, no video in current Local Posts flow; event title/date, offer and CTA fields depend on topic type         | [Official Google Business Profile post guide](https://developers.google.com/my-business/content/posts-data), adapter                                                                                             | Structured local-post profile with topic-type variants                                                                        |
| `dribbble`             | Description accepts limited HTML/autolinks; title is separate                         |                         Adapter safety limit: 40,000; official API does not document a description maximum | Exactly one image in the current create API, 400x300 or 800x600, max 8 MB; title required; API video creation is unsupported | [Official shots API](https://developer.dribbble.com/v2/shots/), [official description media types](https://developer.dribbble.com/v2/media/), adapter                                                            | Media-first profile; fix the misleading generic text-first UX                                                                 |
| `moltbook`             | Plain content in the current adapter                                                  |                                                                                         300 in the adapter | Submolt and title required; text or link post; current adapter has no media post path                                        | [Moltbook API instructions](https://www.moltbook.com/post/2eddec41-96dd-4d71-9c28-59330384faef), adapter                                                                                                         | Niche structured profile; keep unverified because the public contract is mutable                                              |
| `whop`                 | Native Markdown message content                                                       |                        Adapter limit: 50,000; no maximum is exposed in the current public method reference | Channel required; attachments, polls, replies and link previews supported by the API                                         | [Official create-message API](https://docs.whop.com/api-reference/messages/create-message), adapter                                                                                                              | Chat/community profile; retain the adapter limit as unverified until server behavior is tested                                |
| `skool`                | Plain text in the current adapter                                                     |                                                                                       5,000 in the adapter | Community/category identifiers are adapter-specific; no public media contract is established                                 | Adapter only                                                                                                                                                                                                     | Defer until authenticated contract tests can capture the private/partner API behavior                                         |
| `mewe`                 | Plain text in the current adapter                                                     |                                                                                      63,206 in the adapter | Group/profile destination and media behavior are adapter-specific                                                            | Adapter only                                                                                                                                                                                                     | Defer; do not reuse Facebook's coincidentally identical limit without evidence                                                |

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
