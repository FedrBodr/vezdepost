Project: vezdepost (Postiz fork)
Document: feature-spec

# Telegram Rich Messages (sendRichMessage) — design

Date: 2026-08-24
Linear: FED-386
Status: approved in chat (user, 2026-08-24)

## Goal

Post to Telegram channels as rich messages: native headings h1-h6, real lists,
native italic and strikethrough, 32,768-character limit, embedded images by
public URL. Automatic fallback to the legacy sendMessage/sendPhoto path so a
post is never lost.

## Evidence (Bot API 10.1–10.3, core.telegram.org/bots/api, 2026-08-24)

- `sendRichMessage(chat_id, rich_message: InputRichMessage, ...)`.
- `InputRichMessage.html` accepts rich HTML: `h1-h6, p, ul/ol/li, b/strong,
  i/em, u/ins, s/strike/del, a, blockquote, hr, figure/img/figcaption, table,
  details, pre/code` and more.
- Images: `<img src="https://..."/>` as separate blocks; media blocks support
  only HTTP/HTTPS URLs. The `media` field is only needed for `tg://photo?id=`
  reuse — not used here.
- Limits: 32,768 chars, 500 blocks, 16 nesting levels, 50 media.
- Rendering: document-like with "Show more" after ~8,000 chars.

## Public media URLs — no infra needed

The app's nginx (postiz:5000) already serves the uploads volume publicly:
`https://app.vezdepost.ru/uploads/YYYY/MM/DD/<file>` returns the image with
`image/jpeg`. Local storage URLs are `FRONTEND_URL + /uploads/...`
(local.storage.ts). Verified live on prod (200, image/jpeg).

## Design

### Contract (platform.capability.profiles.ts)

Telegram profile switches to the new dialect `telegram-rich-html`:

- formatting: bold/underline native, links native, lists native,
  **headings native** (was `plain`), limit 32,768 utf16 code units, source
  platform (was 4,096 text / 1,024 caption).
- Variant selection unchanged (pure function of settings/media).
- Editor effect: heading button enabled for telegram (semantic policy reads
  `headings === 'native'`).

### Normalizer (new dialect case)

`telegram-rich-html` renders canonical HTML as rich HTML:

- `h1-h6` kept as tags (no degradation to `<b>`);
- `p` blocks separated by a blank line (`\n\n`);
- `ul/ol/li` emitted as real tags;
- `b/strong → <b>`, `u → <u>`, `i/em → <i>`, `s/del → <s>`, `a → <a href>`,
  `blockquote`, `hr`;
- media appended as `<img src="PUBLIC_URL"/>` blocks (local paths mapped to
  `FRONTEND_URL/uploads/...`; http(s) URLs pass through);
- unsupported inline markup stripped;
- measurement = visible text (tags excluded).

### Provider (telegram.provider.ts)

For the main channel post:

1. Build the rich payload and call `sendRichMessage` (direct HTTPS call to
   api.telegram.org — the bot client library predates 10.1).
2. On any API error → log + legacy path: legacy HTML derived from the rich
   html via `normalizeVerifiedHtml(...).normalized` (strips h1-h6/ul to text,
   keeps b/u/a) plus `<img>` removal; existing split/comment logic untouched.
3. Comments, service messages and videos keep the legacy path (videos may
   migrate to `<video src>` later).

### Monitoring (server-side, out of app code)

Cron script on the VPS every 15 min: uploads-volume disk usage, daily media
traffic from Caddy logs, rich-send errors in app logs, container health.
Threshold breach → Telegram message via bot to the owner chat. Defaults:
disk 80%, traffic 10 GB/day; adjustable in the script header.

## Out of scope

- Italic/strikethrough editor buttons (FED-382 tracks the contract key).
- Public media domain (not needed — app domain already serves uploads).
- Rich tables/details authoring in the editor.
- Video blocks in rich messages.

## Verification

- Unit: dialect rendering (headings kept, lists tagged, img blocks, i/s),
  fallback conversion, provider payload building (mocked HTTP).
- Gate: full suite, build:backend, prettier.
- Prod: control post with headings + image to the channel; LinkedIn unchanged.
