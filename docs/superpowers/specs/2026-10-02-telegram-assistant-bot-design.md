Project: vezdepost
Document: design-spec

# Telegram Assistant Bot (@vezde_post_bot) — MVP

## Status

Scope approved by the owner on 2026-10-02 for the festival on 2026-10-03:
link from the app, publish now, choose channels, photos and videos up to
20 MB. No scheduling, queue or cancel in the MVP.

## Goal

Any Vezdepost user (including festival guests) publishes from Telegram:
send text, photos or video to `@vezde_post_bot`, pick channels, press
"Publish".

## User flow

1. In the app the user presses **"Постить из Telegram"** (top bar). The app
   calls `POST /integrations/telegram-assistant/link` and opens the returned
   deep link `https://t.me/vezde_post_bot?start=<code>`.
2. In Telegram the user presses Start. The bot links the Telegram user to
   that Vezdepost user and organization and replies "Готово, отправьте пост".
   `/start` without a valid code (or an unlinked user writing) gets
   instructions with the app link.
3. The user sends a message: text, photo(s), video, or an album. Every
   message is added to the user's **draft**. The bot keeps one **draft panel**
   message up to date: text length, file count, and one toggle button per
   channel (✅ when selected), plus "🚀 Опубликовать" and "🗑 Сбросить".
4. "Опубликовать": the bot downloads the files, stores them in the media
   library, validates and creates one "now" post per selected channel
   through the same services as the dashboard, then replies with the result
   per channel ("✅ VK, Telegram · ⚠️ Pinterest: <validation error>").
   The draft is cleared.
5. `/help` explains the flow and the limits.

## Rules

- Channels offered: the organization's integrations that are not disabled,
  not marked refresh-needed and not between steps. Providers needing extra
  settings are not filtered up front; the dashboard validation reports them
  per channel.
- Files: photos (largest size), videos, image/video documents. A file over
  20 MB (Bot API download limit) is refused with a clear message; the rest
  of the draft stays.
- Text: plain text, HTML-escaped, paragraphs from line breaks. Telegram
  formatting entities are ignored in the MVP.
- Draft: per Telegram user in Redis, 1 hour TTL, at most 10 files.
- Links persist in the database (`TelegramAssistantLink`: Telegram user ID
  unique → user ID, organization ID). `prisma db push` on start creates the
  table. Re-linking replaces the previous link.
- Link codes: Redis, one-time, 15 minutes.
- Posts use creation method `API`.

## Architecture

- Backend module `TelegramAssistantModule` (libraries/nestjs-libraries,
  imported by the backend app): on start, if `TELEGRAM_ASSISTANT_TOKEN` is
  set, a long-poll loop (`getUpdates`, timeout 25 s) runs under a Redis lock
  so only one process consumes updates. Separate bot token, so the channel
  connection bot and its update hub are untouched.
- Units: Bot API client (existing `callTelegramApi` + `getFile` download),
  update router, draft store, link service, publisher (media upload via the
  storage + `MediaService.saveFile`; posts via `PostsService.mapTypeToPost`,
  `validatePosts`, `createPost`).
- Controller: `POST /integrations/telegram-assistant/link` (authenticated,
  org from request) → `{ url }`.
- Frontend: "Постить из Telegram" button in the top bar.
- Config: `TELEGRAM_ASSISTANT_TOKEN` (stored by
  `docs/server-scripts/27-configure-telegram-assistant.sh`) and
  `TELEGRAM_ASSISTANT_BOT_NAME: vezde_post_bot`, both passed through
  `docker-compose.override.yaml`.

## Testing

Unit tests: link code create/consume, update routing (start with/without
code, unlinked user, text, photo, album, oversize file, toggles, reset),
draft panel rendering, publisher (media saved, one post per channel,
per-channel validation errors, empty draft refused), text to HTML.
Manual: owner links, posts text + photo + short video to VK and Telegram.

## Implementation tasks

1. Prisma model `TelegramAssistantLink` + repository + link service (codes in
   Redis) with tests.
2. Bot API helpers (`sendMessage`, `editMessageText`, `answerCallbackQuery`,
   `getFile` + download with size limit) with tests.
3. Draft store + panel renderer with tests.
4. Publisher (files → media library, posts per channel, result summary)
   with tests.
5. Update router + long-poll worker under Redis lock with tests; module
   wiring in the backend.
6. Link endpoint + top bar button + translations.
7. Compose variables, docs, full suite, deploy, owner acceptance.
