Project: postiz-app
Document: design-spec

# MAX Messenger Provider — Design Spec

**Date:** 2026-07-04
**Branch:** `feat/max-provider`
**Fork:** github.com/FedrBodr/postiz-app (upstream: gitroomhq/postiz-app)
**Goal:** Add the Russian messenger **MAX** as a Postiz social provider, following the Telegram "bot-admin in channel" model, then open a PR to upstream.

---

## 1. Summary

MAX is a Russian messenger with a Bot API closely analogous to Telegram's: a bot is added as an
**admin** to a channel, and posts are published via the bot. This provider reuses Postiz's existing
"web3" custom-connect flow (the same one Telegram uses — `isWeb3 = true`) rather than OAuth.

The work spans **8 code touchpoints plus one dependency**. The original ТЗ listed only 4 of them;
the other 4 are what make a channel actually connectable and publishable in the UI. All 8 are in
scope for this spec.

---

## 2. Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Scope | **Full Telegram parity** (all 8 touchpoints) | The 4 ТЗ items compile but cannot be connected in the UI; the connect flow needs a controller endpoint + frontend component + web3List + bot-name variable. |
| API client | **Official `@maxhub/max-bot-api` SDK** | Mirrors how `telegram.provider.ts` uses `node-telegram-bot-api`. Insulates us from unsettled details: `platform-api` vs `platform-api2` host, the `Authorization:` header change (query `?access_token=` is deprecated), and exact response field names. |
| Media | **Text + all media** (photos + videos) | Section-6 manual test publishes an image; same effort ceiling covers video and multiple attachments, matching the Telegram provider's capability. |
| Git | Work **in the existing fork checkout**; add `upstream`, branch `feat/max-provider` off `main` | This checkout is already `origin → FedrBodr/postiz-app`. No re-clone. No push / no PR until the user reviews the diff. |

### API facts established (corrections to the ТЗ)
- **Auth:** `Authorization: <token>` header. Query `?access_token=` is deprecated — do **not** use the skeleton's `?access_token=` form. (The SDK handles this.)
- **Base host:** docs show `https://platform-api2.max.ru`; ТЗ said `platform-api.max.ru`. The SDK owns the host, so we don't hard-code it.
- **Receiving updates:** `GET /updates` long-polling exists (dev-only, rate/retention limited) — so the Telegram `/connect <word>` model is viable, with the same caveats as Telegram's `getUpdates`.
- **Send:** `POST /messages` with `chat_id`, `text`, `format`, `attachments`. SDK method: `sendMessageToChat(chatId, text, extra)`.
- **Attachments:** two-step upload → attach. SDK helpers `uploadImage(options)` / `uploadVideo(options)` return typed attachment objects to pass in `SendMessageExtra.attachments`.
- **`POST /subscriptions` is webhook management, NOT channel listing.** The ТЗ's "GET /chats removed → use /subscriptions to list channels" is a misread. Real channel discovery = catching the `/connect` message via `getUpdates`, exactly like Telegram.

### SDK surface (confirmed)
```
new Bot(token)
bot.api.getUpdates(types?, extra?)            → Promise<Update[]>
bot.api.sendMessageToChat(chatId, text, extra?) → Promise<Message>
bot.api.uploadImage(options) / uploadVideo(options) → typed attachments
bot.api.getChat(id)                           → Promise<Chat>
```

---

## 3. Architecture

### 3.1 Connect flow (bot-admin-in-channel, no OAuth)
1. User creates a bot via the system `@MasterBot`, obtains `MAX_TOKEN`, and adds the bot as **admin** to their MAX channel.
2. Postiz "Add channel → MAX" renders the frontend web3 component, which shows:
   *"Add @`MAX_BOT_NAME` to your channel, then type `/connect <word>` in it"*, and polls
   `GET /integrations/max/updates?word=<word>&id=<lastId?>` every 2s.
3. The backend endpoint calls `MaxProvider.getBotId({ word, id })`, which long-polls
   `bot.api.getUpdates(['message_created'], ...)`, finds the update whose text equals `/connect <word>`,
   and extracts the channel's `chat_id`. Returns `{ chatId }` on match, else `{ lastChatId }` to advance the cursor.
4. The frontend receives `chatId` and calls `onComplete(chatId, nonce)`.
5. `authenticate({ code })` treats `code` as the resolved `chat_id`, calls `getChat(chat_id)` for title/avatar,
   and returns the integration record. `accessToken = chat_id`, `expiresIn` = 200 years, `refreshToken = ''`.

### 3.2 Publish flow
- `post(id, accessToken /* = chat_id */, postDetails)`:
  1. For each media item, upload via `uploadImage` / `uploadVideo` (chosen by MIME type) → typed attachment.
  2. Single `sendMessageToChat(chatId, text, { attachments, format: 'html' })`.
  3. Return `{ id, postId, releaseURL, status: 'completed' }`.
- `comment(...)`: same as `post`, sent as a **reply** to the parent message id (`postId` / `lastCommentId`),
  using the SDK's reply field on `SendMessageExtra`.

---

## 4. Touchpoints

### New files (2 code + 1 asset)
- `libraries/nestjs-libraries/src/integrations/social/max.provider.ts` — the provider.
- `apps/frontend/src/components/launches/web3/providers/max.provider.tsx` — connect screen (modeled on `telegram.provider.tsx`).
- `apps/frontend/public/icons/platforms/max.png` — UI icon (asset supplied separately; placeholder acceptable until the real logo is dropped in).

### Edited files (6)
- `libraries/nestjs-libraries/src/integrations/integration.manager.ts` — `import { MaxProvider }` + `new MaxProvider()` in `socialIntegrationList` next to `new TelegramProvider()` / `new VkProvider()`.
- `apps/backend/src/api/routes/integrations.controller.ts` — add `@Get('/max/updates')` → `new MaxProvider().getBotId(query)` (mirrors the existing `/telegram/updates` handler).
- `apps/frontend/src/components/launches/web3/web3.list.tsx` — register `{ identifier: 'max', component: MaxProvider }`.
- `libraries/react-shared-libraries/src/helpers/variable.context.tsx` — add `maxBotName: string` to the interface and `maxBotName: ''` to the default value.
- `apps/frontend/src/app/(app)/layout.tsx`, `(provider)/layout.tsx`, `(extension)/layout.tsx` — pass `maxBotName={process.env.MAX_BOT_NAME!}` alongside the existing `telegramBotName={...}`.
- `.env.example` and `docker-compose.yaml` — add `MAX_TOKEN` and `MAX_BOT_NAME` (empty defaults).

### Dependency
- `pnpm add @maxhub/max-bot-api` at the repo root (parallels `node-telegram-bot-api`).

---

## 5. Provider internals

```
class MaxProvider extends SocialAbstract implements SocialProvider
  identifier   = 'max'
  name         = 'MAX'
  isWeb3       = true                 // routes UI to the web3 custom-connect component
  isBetweenSteps = false
  scopes       = [] as string[]       // bot token; no OAuth scopes
  editor       = 'html' as const
  maxConcurrentJob = 3                // ~30 rps API limit; keep moderate
  maxLength()  = 4000                 // confirm against MAX docs

  refreshToken()    → empty AuthTokenDetails (token is permanent)
  generateAuthUrl() → { url: state, codeVerifier, state } via makeId (same as Telegram)
  getBotId(query)   → getUpdates(['message_created']) → match "/connect <word>" → { chatId } | { lastChatId } | {}
  authenticate()    → getChat(code) → { id, name, accessToken: chat_id, refreshToken:'', expiresIn: 200y, picture, username }
  post()            → upload media → sendMessageToChat → [{ id, postId, releaseURL, status }]
  comment()         → sendMessageToChat as reply to parent id → [{ ... }]
```

Module-level `const bot = new Bot(process.env.MAX_TOKEN!)` parallels `const telegramBot = new TelegramBot(...)`.
HTML message text is normalized the same way Telegram does (`striptags` + tag mapping) if MAX's `format: 'html'`
supports a narrower tag set than the editor emits.

---

## 6. Known uncertainties (verify at implementation; all localized to `max.provider.ts`)

1. **Update object field names** — MAX's `Update` shape differs from Telegram's. Determine the exact path to the
   channel id and message text (e.g. `update.message.recipient.chat_id`, `update.message.body.text`) from the SDK types.
2. **Reply field** for `comment()` — the exact `SendMessageExtra` field to reply to a message id.
3. **`releaseURL` format** — MAX's public message-link shape. If none is documented, fall back to a channel URL
   (or omit a deep link) rather than emitting a broken URL.
4. **`maxLength`** — confirm the character limit; default 4000 until confirmed.

None of these block the design or the other 7 touchpoints; each is a small, contained lookup in the SDK types/docs.

---

## 7. Error handling & edge cases

- **Bot not admin / no matching update:** `getBotId` returns `{ lastChatId }` to advance the cursor; the frontend keeps polling. No crash on an empty poll (guard on missing `chat_id`, like Telegram's undefined-guard).
- **Missing `MAX_TOKEN`:** the module constructs `new Bot(process.env.MAX_TOKEN!)`; behavior with an unset token mirrors Telegram (provider only usable when configured). Registration in `socialIntegrationList` must not throw at import time.
- **Media upload failure:** surface the error through the normal provider error path (`SocialAbstract`), consistent with other providers.
- **Rate limits (~30 rps):** `maxConcurrentJob = 3` keeps concurrency moderate.

---

## 8. Verification

- `pnpm install` (adds `@maxhub/max-bot-api`).
- Build backend + frontend; lint from repo root (lint only runs from root per project rules).
- **Runtime/manual test (user-performed — cannot create a MAX bot from here):**
  1. Create a bot via `@MasterBot`, get `MAX_TOKEN`.
  2. Add the bot as **admin** to a test MAX channel.
  3. Set `MAX_TOKEN` (+ `MAX_BOT_NAME`) in env; restart Postiz.
  4. UI "Add channel → MAX" → connect via `/connect <word>`.
  5. Create a post with an image → verify it publishes to the channel.

---

## 9. Out of scope

- **VK:** already implemented and registered; VK is config-only (`VK_ID` env + redirect URI). No code changes.
- **Webhook-based updates** for MAX (production `POST /subscriptions` callback model) — v1 uses long-poll `getUpdates` for the connect step only, matching Telegram.
- **Pushing the branch / opening the PR** — done by the user after reviewing the diff.

---

## 10. Git flow

```bash
# in the existing fork checkout
git remote add upstream https://github.com/gitroomhq/postiz-app
git checkout -b feat/max-provider
# implement...
git add -A
git commit -m "feat: add MAX messenger provider"   # English commits
# STOP — show diff to user. No push, no PR yet.
```
