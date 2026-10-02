Project: vezdepost
Document: roadmap

# Roadmap: posting from the phone (October 2026)

Status: draft for discussion, 2026-10-02.

## Goal

Publish quickly from the phone now, and let festival attendees use
Vezdepost the same way.

## Stages

### 1. Upstream sync (gitroomhq/postiz-app)

- Last sync 2026-07-09 (merge-base 2026-07-05). Upstream since then:
  497 commits (131 feat, 167 fix), ~300 files.
- Valuable: post workflow v1.1.x (heartbeat retries), media uploader fixes,
  per-channel fixes (TikTok, Facebook, Pinterest, Reddit, WordPress,
  Farcaster), preview comments, MCP/ChatGPT app, YouTube clipping.
- Conflict areas: editor, platform capabilities, post workflows, Telegram,
  MCP — all heavily changed in our fork (~3000 commits since).
- Estimate: 1–2 sessions, timeboxed. Merge in a worktree, full test suite,
  staged deploy.

### 2. Telegram bot as the mobile client

- Link: a Vezdepost user links their Telegram once (deep link with a one-time
  code from settings).
- Post: send text, photos, video to the bot → choose channels (buttons) →
  now / next free slot / exact time → the bot confirms with a link.
- Manage: `/queue` lists upcoming posts, a button cancels one.
- Albums: several photos/videos in one message become one post.
- Video limits: Bot API downloads files up to 20 MB. Larger videos need a
  self-hosted Telegram Bot API server (up to 2 GB) — optional follow-up.
- Updates: continuous background processing on top of the existing
  Redis-locked update hub (no webhook switch, channel wizards keep working).
- Estimate: 3–4 sessions.

### 3. Mobile app (later)

- Responsive key screens (post list, editor, add channel): 4–6 sessions.
- Then PWA (~0.5 session), Android wrapper for Google Play / RuStore
  (1–2 sessions), iOS optional (App Store review risk).

## Open questions

- Festival date — it decides whether the sync goes before the bot.
- Festival users: register on app.vezdepost.ru first, or onboard from the bot?
- Bot identity: keep `@fedrbodr_postiz_bot` or a branded bot for users.
