Project: vezdepost
Document: runbook

# Telegram Stories connector

Publishes a post's photos and videos as a series of personal Telegram Stories
through the Telegram Business Bot API (`postStory`). Design:
`docs/superpowers/specs/2026-09-25-telegram-business-stories-design.md`.

## How it works

- Channel identifier `telegram-stories`; it reuses the Vezdepost bot
  (`TELEGRAM_TOKEN`).
- The user needs Telegram Premium (Telegram Business). They open the bot
  through a personal link (`/start <nonce>`), then add it in
  `Settings → Telegram Business → Chatbots` with "Manage stories" enabled.
- The integration stores the owner's Telegram user ID (`internalId`) and the
  `business_connection_id` (`token`).
- Every attached file becomes one story (1–10 per post). Photos become
  1080×1920 JPEG; videos are transcoded with ffmpeg to 720×1280 H.265, at most
  60 s and 30 MB.
- Post text goes on the first story by default; each story can use the post
  text, no text or its own text. Lifetime: 6/12/24 (default)/48 hours.
- Retries skip stories already published (per-frame progress in Redis,
  30 days). A story whose outcome is unknown after a timeout is not re-sent;
  the post error asks the user to check their stories.
- If the user disables the bot or revokes "Manage stories", the next
  publication marks the channel for reconnection.
- MCP: `integrationSchema` exposes `active_period` and `frames`
  (`{ text: 'post' | 'none' | 'custom', caption }` by media position).

## Telegram updates

All Telegram connection wizards now read bot updates through one Redis-locked
poller (`telegram.updates.hub.ts`) with
`allowed_updates = message, channel_post, business_connection`. The client
offset parameter of `/integrations/telegram/updates` is ignored.

## Rollout

1. Deploy with `TELEGRAM_STORIES_ORG_IDS` empty (connector hidden). Check that
   connecting a Telegram group/channel still works.
2. If production sets `ENABLED_SOCIAL_INTEGRATIONS`, add `telegram-stories`.
3. Owner: enable Business Mode for the bot in BotFather.
4. Set `TELEGRAM_STORIES_ORG_IDS` to our organization ID and restart.
5. Owner acceptance (personal account, manual):
   - connect Telegram Stories from "Add channel";
   - publish one photo and one video; check order, lifetime and texts;
   - set custom text on the second story and "no text" on the first;
   - revoke "Manage stories" and publish again: the channel asks for
     reconnection.

The production image now includes `ffmpeg` (`Dockerfile.dev`).
