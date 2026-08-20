# Platform Capabilities V2

**Date:** 2026-08-20  
**Linear:** FED-347  
**Status:** Approved for implementation design; do not release or push

## Goal

Replace the first-wave capability contract with a clean V2 model that can
accurately describe all registered destinations, including mode-specific text
fields, non-character limits, formatting dialects, conditional media rules and
runtime provider constraints.

The application currently has one active user. Backward compatibility for
stored drafts and historical posts is not a requirement. Existing data will not
be migrated. The seven first-wave destinations must retain correct user-facing
behavior, but their verified constraints may be updated when fresher official
information is available.

## Scope

This design covers:

- replacement of `PlatformCapabilities` and its legacy fallback;
- deterministic resolution of a destination and post variant;
- runtime capability overlays for instance/account-specific platforms;
- unit-aware content normalization and diagnostics;
- capability-driven editor controls, counters, previews and server validation;
- migration of all 36 registered destination identifiers in audited batches;
- regression coverage for the seven existing profiles and each new batch.

This design does not cover:

- database migrations for existing posts;
- automatic rewriting of a user's wording or post structure;
- automatic publication without confirmation;
- release, deployment or production rollout;
- provider authentication or publishing-flow rewrites unrelated to capability
  enforcement.

## Why V1 must be replaced

V1 assumes one output editor, one `text.max`, one optional caption limit and a
mostly static media contract. That model cannot express:

- TikTok's video caption versus photo title and description limits;
- YouTube's separate title and byte-counted description;
- Slack `mrkdwn`, Discord Markdown and Bluesky facets as different dialects;
- Mastodon limits supplied by the connected instance;
- Reddit requirements supplied by a subreddit;
- media alternatives such as up to four images or exactly one video;
- platform maxima versus conservative application safety limits.

Adding more optional fields to V1 would preserve its ambiguity and create
provider-specific conditionals in consumers. V2 makes the post variant and
field being validated explicit.

## Design principles

1. One shared resolver remains authoritative for frontend and backend.
2. The canonical editor document remains HTML. Provider output is derived and
   never written back into the canonical source implicitly.
3. Every limit declares its measurement unit.
4. Every diagnostic names the destination, variant and field it concerns.
5. Static facts and runtime facts remain distinguishable.
6. An internal safety limit must never be presented as an official platform
   limit.
7. Unknown or not-yet-migrated destinations remain usable through an explicit
   unverified adapter profile, not through an implicit legacy guess.
8. Backend validation is authoritative; frontend diagnostics use the same pure
   resolver for early feedback.

## Capability contract

The V2 contract is composed from small declarations instead of a single flat
object.

### Limits

`ContentLimit` contains:

- `max`: positive integer;
- `unit`: `graphemes`, `utf16-code-units`, `utf8-bytes` or `weighted`;
- `source`: `platform`, `runtime` or `application-safety`;
- optional `recommendedMax` for APIs such as Slack that accept more than they
  recommend displaying.

The shared measurement helper returns both the measured value and the limit
metadata used. Weighted limits are delegated to a named counter such as X's
existing weighted-text implementation.

### Formatting dialects

`FormattingDialect` is one of:

- `plain`;
- `html`;
- `markdown`;
- `slack-mrkdwn`;
- `discord-markdown`;
- `bluesky-facets`.

Each dialect declares supported semantic marks: bold, underline, links, lists
and headings. The declaration controls editor buttons and normalization. A mark
can be native, Unicode fallback, plain-text fallback or unsupported.

### Text fields

`TextFieldCapability` declares:

- stable field key such as `body`, `caption`, `title`, `description` or
  `contentWarning`;
- label and requiredness;
- formatting dialect;
- optional `ContentLimit`;
- whether the field is sourced from the canonical editor document or a
  structured provider setting.

This allows one variant to use the editor body while another uses a caption and
separate provider fields without pretending they share one maximum.

### Media rules

`MediaRule` is an explicit union:

- no media;
- optional media with allowed image/video cardinalities;
- required media with allowed image/video cardinalities;
- exclusive alternatives such as `images(1..4) | video(1)`;
- provider-runtime media rule.

Additional flags describe cover requirements, mixed carousels and whether a
poll excludes media. File size, duration and dimension constraints are included
only when the application can validate them before upload.

### Variants

A `PostVariantCapability` combines text fields, media rules, structured fields
and delivery behavior. Examples include:

- `tiktok.video` and `tiktok.photo`;
- `instagram.feed`, `instagram.story`, `instagram.reel` and
  `instagram.trial-reel`;
- `facebook.feed`, `facebook.story` and `facebook.reel`;
- `reddit.self`, `reddit.link` and `reddit.media`;
- `gmb.standard`, `gmb.event` and `gmb.offer`.

Each platform has a deterministic `selectVariant(context)` function. Selection
uses existing provider settings and media, never heuristics based on text.

### Platform profiles

`PlatformCapabilityProfileV2` contains:

- destination identifier and display name;
- verification state and evidence date;
- default variant;
- variant map;
- optional runtime overlay declaration;
- preview behavior;
- aliases that reuse a profile while preserving the selected identifier.

`linkedin-page` is an alias of the LinkedIn profile unless a page-specific rule
overrides it. Aliases are resolved deliberately and are covered by tests.

## Runtime capability overlays

Static profiles define the contract shape. Runtime overlays replace only values
declared as runtime-controlled.

Initial runtime consumers are:

- Mastodon instance character and media configuration;
- Reddit subreddit posting requirements;
- TikTok creator-info privacy and interaction options;
- X account entitlement for long-form posts.

Connected integration metadata carries a serializable runtime overlay with an
`observedAt` timestamp. A missing or stale overlay produces an unverified
diagnostic and uses a conservative application-safety value. It must not be
silently relabeled as a platform maximum.

The backend re-resolves the profile immediately before publication from the
provider identifier, settings, media and available runtime overlay. Client data
cannot raise a backend limit or mark a profile verified.

## Resolution and data flow

1. The integration manager exposes the V2 static profile summary and any
   trusted runtime overlay available for a connected integration.
2. The editor supplies destination identifier, provider settings and selected
   media to `resolvePlatformCapabilityV2`.
3. The resolver selects a variant, applies allowed runtime values and returns a
   fully resolved immutable capability object.
4. Editor schema, toolbar, counters and notices consume the resolved object.
5. Preview receives normalized field values plus diagnostics and renders the
   chosen delivery mode.
6. Before persistence and again before the provider API call, the backend runs
   the same resolution and analysis with server-trusted inputs.
7. Blocking diagnostics prevent publication; warnings require no source rewrite
   and remain visible to the user.

## Normalization

Normalization is selected by field dialect:

- HTML retains the verified sanitizer and provider-specific tag mapping;
- Markdown emits deterministic Markdown from canonical HTML;
- Slack and Discord use dedicated emitters because their dialects differ;
- Bluesky emits plain text plus UTF-8 byte-indexed facets;
- plain output preserves visible text, line boundaries and raw URLs unless the
  profile explicitly removes them.

Normalization returns structured output by field key instead of one anonymous
message string. Provider adapters consume the field they publish. During batch
migration, an explicit unverified adapter profile can still expose a single
`body` field derived from the adapter's current editor mode and safety maximum.

## Diagnostics and errors

Every diagnostic contains:

- stable code;
- severity: information, warning or error;
- destination identifier;
- selected variant;
- field key;
- measured value, limit and unit when relevant;
- user-facing message without provider secrets.

The resolver reports invalid or unknown variants as blocking errors. Missing
runtime data is a warning when a conservative safe value can be enforced and a
blocking error when the provider requires a value that cannot be derived.

Provider API errors remain provider errors, but deterministic capability
violations must be caught before the network call.

## Migration strategy

No database migration or historical content conversion is performed. The code
migration proceeds in independently testable batches:

### Batch 0: contract and correctness guardrails

- introduce V2 types, field measurement and variant resolution;
- migrate the seven first-wave profiles and update them from newer official
  evidence where appropriate;
- add the `linkedin-page` alias;
- replace Slack's 400,000 maximum with 40,000 platform maximum and 4,000
  recommendation;
- represent TikTok video and photo limits separately;
- make Mastodon runtime-controlled;
- preserve an explicit unverified adapter bridge for not-yet-migrated
  providers.

### Batch 1: high-usage public publishing APIs

`x`, `facebook`, `instagram`, `instagram-standalone`, `threads`, `youtube`,
`tiktok`, `bluesky`, `reddit`, `linkedin-page`.

### Batch 2: chat and federated destinations

`slack`, `discord`, `twitch`, `kick`, `mastodon`, `lemmy`, `wrapcast`, `nostr`.

### Batch 3: articles, CMS and email

`medium`, `devto`, `hashnode`, `wordpress`, `listmonk`.

### Batch 4: niche and partner/private APIs

`gmb`, `dribbble`, `moltbook`, `whop`, `skool`, `mewe`.

Each batch removes its destinations from the unverified bridge and adds static,
runtime, normalization, frontend and backend regression coverage.

## Testing strategy

Testing follows TDD for every batch.

- Contract tests cover units, aliases, variant selection and immutable runtime
  overlays.
- Normalization tests cover each dialect and preserve visible-text boundaries.
- A 36-destination matrix proves that every registered provider resolves to a
  V2 profile or the explicit unverified bridge.
- First-wave snapshot tests protect Telegram, MAX, LinkedIn, Tumblr, Pinterest,
  VK and VK Group behavior; snapshots change only when supported by updated
  evidence recorded in the test.
- Frontend tests cover toolbar visibility, field counters, media-dependent
  variants and diagnostic rendering.
- Backend tests prove that client-supplied metadata cannot raise limits or skip
  required fields.
- Provider activity tests prove that invalid effective output is blocked before
  any API call.
- Focused tests run after each task; the full suite and frontend/backend/
  orchestrator production builds run before any later release decision.

## Operational boundary

Implementation may create local commits in the existing isolated worktree. It
must not push, merge, open a release, deploy or change production state without
a separate explicit instruction. The first safe pause point is the committed
design and implementation plan; subsequent pause points are the verified end of
each batch.
