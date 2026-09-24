Project: vezdepost
Document: design-spec

# Telegram Business Stories Connector Design

## Status

Approved by the product owner on 2026-09-23 (Codex session, WOK-408) and
confirmed with additions on 2026-09-25: video transcoding through ffmpeg,
central Telegram update intake, per-organization rollout flag, MCP support.

## Problem

Vezdepost publishes to Telegram groups and channels through the bot, but
cannot publish to a user's personal Telegram Stories. The Bot API method
`postStory` can do this on behalf of a Telegram Business account that has
connected our bot and granted it the "Manage stories" right. Telegram Business
requires Telegram Premium.

Channel stories (MTProto, phone login) are out of scope.

## Product behavior

### Connection

1. A new channel card **Telegram Stories** appears in "Add channel" for
   organizations enabled by the rollout flag.
2. The wizard explains the prerequisites: Telegram Premium and Telegram
   Business.
3. Step 1: the user opens our bot through a personal link
   `https://t.me/<bot>?start=<nonce>`. This binds the attempt to the user's
   Telegram ID.
4. Step 2: the wizard guides the user to
   `Settings → Telegram Business → Chatbots`, where they add the bot and enable
   **Manage stories**.
5. The wizard polls and shows one of: waiting for `/start`, waiting for the
   business connection, missing "Manage stories" right, connection disabled,
   ready.
6. Only when the `/start <nonce>` sender and the `business_connection` user are
   the same Telegram user, the connection is enabled and `can_manage_stories`
   is true, the integration is created.

The existing Telegram group and channel connector keeps its behavior.

### Publishing

- Every attached photo or video becomes a separate story, published in the
  post's media order. At least one media file is required; at most 10 per post.
- Text placement per frame: by default the post text goes on the first story
  only. Each frame can instead use no text or its own text.
- Story lifetime: 24 hours by default; 6, 12 or 48 hours selectable.
- Photos are converted to 1080×1920 JPEG (contained over a blurred cover of the
  same image), at most 10 MB.
- Videos are transcoded to 720×1280 H.265 MPEG-4, key frame every second,
  faststart, at most 60 seconds and 30 MB. Videos longer than 60 seconds are
  rejected before scheduling.
- Captions support bold, italic, underline, strikethrough and safe links
  (Telegram caption dialect); headings degrade to bold. Limit 2048 visible
  characters.
- The series is sent sequentially. Published frames are never re-sent: on a
  partial failure the post fails with an exact per-frame result, and a retry
  publishes only the frames that did not go out.
- Interactive story areas, editing and deleting stories are a later stage.

### MCP

The connector is available to AI agents through the existing Postiz MCP
tools with no new tools:

- `integrationList` shows the Telegram Stories channel.
- `integrationSchema` returns the settings schema and rules (media required,
  lifetime values, per-frame text by media position).
- `integrationSchedulePostTool` accepts the settings. Because MCP media gets
  generated IDs, per-frame text is addressed by media **position**.

## Architecture

### Provider

`TelegramStoriesProvider` (`identifier: 'telegram-stories'`, `isWeb3: true`,
editor `html`) in `libraries/nestjs-libraries/src/integrations/social/`,
registered in the integration manager. It reuses the existing bot token
`TELEGRAM_TOKEN`.

The integration stores:

- `internalId`: the Telegram user ID of the owner;
- `token`: the `business_connection_id`;
- `name`, `username`, `picture`: the owner's Telegram profile.

The bot token remains a server secret only.

Operational prerequisite: Business Mode must be enabled for the bot in
BotFather (owner's manual step).

### Central update intake

Today every wizard poll calls `getUpdates` with
`allowed_updates: ['message', 'channel_post']` and a client-provided offset.
Telegram drops update types that are not in `allowed_updates`, so
`business_connection` would never arrive. Concurrent wizards also confirm each
other's updates.

`TelegramUpdatesHub` replaces direct polling for both Telegram connectors:

- A Redis lock (`SET NX PX`) ensures one `getUpdates` call at a time; the
  offset is stored in Redis.
- `allowed_updates` is the union `message`, `channel_post`,
  `business_connection`.
- Updates are indexed in Redis with a 15-minute TTL: connection commands by
  nonce, business connections by Telegram user ID.
- Readers first trigger a poll (if the lock is free), then read the index.
- The existing `/integrations/telegram/updates` endpoint keeps its query
  contract; the client offset `id` is accepted and ignored.

### Connection verification

- `GET /integrations/telegram-stories/updates?word=<nonce>` resolves the
  status from the hub. On `ready` it stores a verified record
  `{ telegramUserId, businessConnectionId }` under the nonce in Redis
  (15 minutes).
- The wizard then completes with the nonce as the code. The provider's
  `authenticate` reads the verified record — it never trusts IDs from the
  client — re-checks the connection with `getBusinessConnection` and returns
  the integration data.
- Before each publication the provider calls `getBusinessConnection`. If the
  connection is disabled or the stories right was revoked, it raises the
  existing refresh-needed error so the integration is marked as requiring
  reconnection, and the UI shows reconnection instructions.

### Settings DTO

`TelegramStoriesDto`, registered in `allProviders` (used by the editor and MCP):

- `active_period`: one of `21600`, `43200`, `86400`, `172800`; default `86400`.
- `frames`: optional array aligned with media positions, each item
  `{ text: 'post' | 'none' | 'custom', caption?: string }`. Missing items
  default to `post` for the first frame and `none` for the rest.

The editor keeps `frames` aligned when media are reordered.

### Media processing

Runs inside the provider during publication (orchestrator):

- Download with the existing SSRF-safe fetch helpers.
- Photos: `sharp`.
- Videos: `ffmpeg` / `ffprobe` spawned with an argument array (no shell),
  temporary files in the OS temp directory, always cleaned up. `ffmpeg` is
  added to `Dockerfile.dev` (the production image).
- The pre-scheduling check (`checkValidity`) verifies types, count and video
  duration via `ffprobe`.

### Sending

`postStory` needs a multipart upload (`attach://`). A multipart variant of the
existing Bot API transport (`telegram.rich.api.ts`) uses the same node `https`
stack. Request: `business_connection_id`, `content` (photo or video),
`active_period`, `caption`, `parse_mode: 'HTML'`.

### Idempotent series

Per-frame progress is stored in Redis under the post ID and media position with
a 30-day TTL:

- a frame is marked `in_flight` before the call and `done` with the story ID
  after it;
- a retry skips `done` frames;
- an `in_flight` frame without a result (the outcome is unknown) is not re-sent
  automatically; the error asks the user to check their stories;
- a partial failure throws an error listing every frame's result;
- on full success the post result is the first story's ID and URL
  (`https://t.me/<username>/s/<id>` when the owner has a username).

### Capability profile

A `telegram-stories` profile: media required (image or video, 1–10), caption
field limit 2048 with the Telegram caption formatting.

### Rollout flag

`TELEGRAM_STORIES_ORG_IDS` (comma-separated organization IDs). If it is empty,
the connector is hidden and new connections are refused for everyone. It gates
the "Add channel" list and the connection endpoints; already connected
integrations keep publishing. If production sets
`ENABLED_SOCIAL_INTEGRATIONS`, `telegram-stories` must be added there too.

### Frontend

- Wizard `apps/frontend/src/components/launches/web3/providers/telegram.stories.provider.tsx`,
  registered in `web3.list.tsx`, following the Telegram and MAX wizards.
  Russian and English texts.
- Settings component `apps/frontend/src/components/new-launch/providers/telegram-stories/`:
  lifetime select and a per-frame text list (one row per attached media).
- Preview: the general preview.

## Testing

Automated tests cover:

- hub: lock, offset persistence, union `allowed_updates`, indexing, the
  existing Telegram connector reading through the hub;
- connection: user ID match, `is_enabled`, `can_manage_stories`, statuses,
  `authenticate` ignoring client IDs;
- DTO and frame text resolution (default, none, custom, positions);
- media: photo conversion to 1080×1920, ffmpeg arguments, duration rejection;
- publication: series order, captions per frame, partial failure, retry
  skipping published frames, `in_flight` handling, revoked right → refresh
  needed;
- rollout flag and MCP schema exposure.

## Rollout

1. Deploy with `TELEGRAM_STORIES_ORG_IDS` empty; verify the existing Telegram
   group/channel connection still works (server smoke).
2. Owner enables Business Mode for the bot in BotFather.
3. Set `TELEGRAM_STORIES_ORG_IDS` to our organization.
4. Owner connects their personal account and publishes a test series manually
   (personal account and Telegram login stay with the owner).
