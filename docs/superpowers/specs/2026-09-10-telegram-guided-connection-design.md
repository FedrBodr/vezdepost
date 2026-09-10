# Telegram Guided Connection Design

## Status

Approved by the product owner on 2026-09-10.

## Problem

The current Telegram connection modal assumes that a user already knows how
Telegram bots work. It asks the user to add the configured bot to a group or
channel, starts polling only after a generic "Connect Telegram" click, and then
shows a generated `/connect <code>` command.

The flow does not explain:

- the difference between connecting a group and a channel;
- where to add the bot in Telegram;
- that the bot must be an administrator;
- which permissions are required;
- where the command must be sent; or
- what to fix when the bot is present but lacks permissions.

The backend currently returns a chat ID even when its bot permission check
fails. As a result, a Telegram integration can be created although it cannot
publish successfully.

## Goal

Let a person who is comfortable using Telegram groups but unfamiliar with bots
connect a group or channel without having to infer any technical step.

Successful completion means:

1. The user first identifies whether they are connecting a group or a channel.
2. Telegram performs chat selection and suggests the minimum required admin
   permissions through an official bot deep link.
3. A group connection carries its connection nonce automatically and requires
   no manually typed command.
4. A channel connection explains the one manual confirmation command that
   Telegram's channel deep-link format cannot carry.
5. Postiz verifies the bot's actual role and publishing permission before it
   creates the integration.
6. Recoverable failures identify the missing action instead of timing out or
   silently succeeding.

## Non-goals

- Replacing the existing Telegram Bot API transport or polling architecture.
- Changing publishing, comments, media constraints, or existing integration
  records.
- Requesting unrelated Telegram permissions.
- Redesigning OAuth-based social connection flows.
- Localizing new copy beyond Russian and English in this change. Other locales
  use the existing translation fallback behavior until translated.

## Chosen approach

Use a guided modal with separate group and channel branches. Official Telegram
deep links perform chat selection and permission suggestion. The existing
polling endpoint is extended to recognize both the new group start message and
the legacy connect command.

This was chosen over:

- a single long checklist, which exposes too many steps at once; and
- moving the whole setup into a private bot conversation, which adds backend
  state and still cannot configure every permission automatically.

## User experience

### Step 1: Choose a destination type

The modal opens with the question "What do you want to connect?" and two plain
language choices:

- **Group** — a chat where members communicate.
- **Channel** — a publication feed for subscribers.

The modal does not use internal terms such as Web3, nonce, provider, token, or
scope.

### Group branch

1. Postiz shows one primary action: "Open Telegram and choose a group".
2. The action opens a `t.me/<bot>?startgroup=<nonce>&admin=<permissions>` link.
3. Telegram lists only groups the current Telegram user can administer and
   asks them to confirm the suggested bot rights.
4. Telegram sends the start payload in the selected group.
5. Postiz keeps polling, identifies that payload, verifies that the bot is an
   administrator, and completes the existing social integration callback.

No command is copied or manually entered in the primary group flow.

### Channel branch

1. Postiz shows "Open Telegram and choose a channel".
2. The action opens a
   `t.me/<bot>?startchannel&admin=post_messages` link.
3. Telegram lists channels the user can administer and adds the bot with the
   requested right to post messages.
4. Because Telegram channel deep links cannot carry a start payload, Postiz
   displays `/connect <nonce>` with a dedicated copy action and explains that
   it must be published once in the selected channel.
5. Postiz identifies the channel post, verifies that the bot is an
   administrator with `can_post_messages`, and completes the callback.

### Manual fallback

Both branches expose a secondary "Add the bot manually" or "Having trouble?"
action. The fallback gives an explicit numbered checklist and the same
permission requirements. It never replaces the primary automated path.

### Waiting and completion

Polling starts before opening Telegram so that a fast Telegram callback cannot
be missed by the UI. Returning to Postiz shows a visible verification state.
Polling has a finite client-side timeout and then offers "Check again"; it does
not spin forever.

On success, the existing `onComplete(chatId, nonce)` behavior remains the final
handoff so onboarding, refresh, organization state, analytics, and integration
creation keep using the established route.

## Permission rules

The server determines the destination from `getChat(chatId).type`; it does not
trust the branch selected in the browser.

### Groups and supergroups

The bot must have a `creator` or `administrator` membership status. The group
deep link requests `manage_chat`, the smallest group-compatible right that
promotes the bot to administrator without granting content moderation or member
management powers. The server does not require channel-only
`can_post_messages`.

### Channels

The bot must have a `creator` or `administrator` membership status and
`can_post_messages === true`.

### Principle of least privilege

The deep links request only rights necessary for a dependable connection. The
UI describes their purpose in user language. It does not ask for member bans,
admin promotion, invite management, video chat management, stories, or profile
editing.

## Connection token

The existing four-character browser-generated word is replaced by the
backend-generated connection nonce already returned by
`GET /integrations/social/telegram`.

Benefits:

- it binds discovery to the same one-hour integration state stored in Redis;
- it is substantially harder to collide with another concurrent attempt;
- it removes a second independent token from the flow; and
- it remains within Telegram's 64-character start parameter limit.

The nonce is treated as an opaque value. Links and commands encode it rather
than interpolating unchecked text.

## Server contract

`GET /integrations/telegram/updates` keeps accepting the nonce and optional
Telegram update offset. It also accepts an optional candidate chat ID after a
matching update has been found. When that ID is present, the provider skips
update discovery and rechecks the candidate chat's permissions directly. Its
result becomes a discriminated status suitable for the guided UI while
retaining `chatId` on success for backward compatibility.

Expected outcomes:

- `waiting`: no matching Telegram update has arrived;
- `ready`: a matching chat was found and required permissions were verified;
- `bot_not_admin`: the matching chat contains the bot without an admin role;
- `missing_post_permission`: a channel admin cannot publish;
- `telegram_error`: Telegram could not be queried safely.

Waiting responses include the next update offset when Telegram returned any
updates. Permission failures include `candidateChatId` so "Check again" can
verify newly granted rights without asking the user to resend a command.
Responses must not return access
tokens, bot tokens, raw Telegram errors, or unrelated update content.

The provider recognizes:

- group start messages in the form `/start@<configured_bot> <nonce>` and
  compatible `/start <nonce>` variants; and
- legacy `/connect <nonce>` messages or channel posts.

Matches are exact after parsing. Partial or substring matches are rejected.

## Error handling

The UI maps server outcomes to concrete recovery actions:

| Status | User-facing result | Recovery |
| --- | --- | --- |
| `waiting` | "Waiting for Telegram" | Return from Telegram or check again |
| `bot_not_admin` | "The bot was added but is not an administrator" | Reopen the relevant Telegram setup instructions |
| `missing_post_permission` | "Allow the bot to publish messages" | Open channel administrators and enable posting |
| `telegram_error` | "Telegram did not respond" | Retry without losing the attempt |

Network failures do not complete the integration. The copy action confirms
success with translated copy, and all primary actions remain keyboard
accessible buttons or links.

## Frontend structure

The existing Telegram Web3 provider remains the integration entry point but is
split into small, testable responsibilities:

- destination selection;
- Telegram deep-link construction;
- polling lifecycle;
- permission/error status presentation; and
- manual fallback instructions.

No new UI package is installed. Components reuse the project's current form,
button, modal, color, and Tailwind conventions. The flow works in the existing
desktop modal and mobile full-screen modal.

## Backend structure

Telegram update parsing and permission evaluation live in the Telegram
provider library, keeping provider-specific rules out of the controller. The
controller validates and forwards typed query values and returns the provider
result. No database migration is required.

The existing `authenticate()` method remains responsible for reading chat
metadata after a verified chat ID is handed to the social-connect flow.

## Compatibility and rollout

- Existing Telegram integrations are unchanged.
- The legacy `/connect` path remains accepted as the manual fallback.
- The callback URL and social integration state mechanism remain unchanged.
- No feature flag or database migration is required.
- Analytics continue recording the existing connection start and terminal
  result. Additional step-level analytics are outside this change.

## Testing

### Provider unit tests

- recognizes group `/start@bot <nonce>` payloads;
- recognizes compatible `/start <nonce>` payloads;
- recognizes legacy group and channel `/connect <nonce>` updates;
- rejects near matches and unrelated messages;
- verifies group administrator status;
- verifies channel administrator and posting rights;
- returns each recoverable status without returning `chatId` prematurely;
- returns the next Telegram update offset while waiting; and
- handles Telegram API failures without leaking raw errors.

### Frontend tests

- renders the destination selector first;
- creates correctly encoded group and channel deep links;
- starts verification before navigating to Telegram;
- group flow does not ask the user to copy a command;
- channel flow displays and copies the nonce command;
- renders permission-specific guidance;
- stops polling on success, unmount, and timeout;
- retries without generating or losing the current nonce; and
- calls `onComplete` only for a verified successful result.

### Verification

- run the focused Telegram provider and component tests;
- run workspace bootstrap verification, lint, and type checking from the
  repository root as supported by the project scripts;
- run unauthenticated/server-side smoke checks available locally; and
- hand the owner a short authenticated Telegram acceptance checklist for one
  group and one channel instead of signing into the owner's Telegram account.

## Follow-up: instruction-based connection audit

After this Telegram change is complete and verified, audit the other currently
enabled connection providers. Classify them into:

1. standard OAuth with no user instructions;
2. custom credentials or extension setup;
3. bot/chat setup; and
4. manual multi-step authorization.

Only categories 2–4 need instructional UX work. Each provider must keep its own
permission and validation rules; the Telegram copy and assumptions must not be
copied mechanically. Small related providers may share one follow-up design,
while materially different authorization systems receive separate designs and
implementation plans.
