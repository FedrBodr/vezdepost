# Interactive social connection guides

## Context

MAX, Moltbook, and Farcaster use custom React connection components instead
of the shared credential form. Their current screens expose the mechanics but
do not consistently explain prerequisites, permissions, ownership checks, or
recovery. This is the same class of onboarding failure that prompted the
Telegram redesign, applied to three different state machines.

## Shared interaction rules

- Show one primary action for the current step.
- Explain the prerequisite before starting network polling.
- Keep commands, links, and copy controls visible while verification runs.
- Stop polling on success, timeout, retry, or unmount.
- Translate every user-facing string into English and Russian.
- Never request a main password, recovery phrase, API key, or other secret in
  an instruction when the provider flow does not require it.
- Return recoverable status codes to the UI instead of raw upstream errors.

## MAX

### User flow

1. Choose whether to connect a group or channel.
2. Open the configured Vezdepost bot in MAX.
3. Add it to the selected destination and make it an administrator.
4. Enable permission to read all messages and write messages.
5. Publish `/connect <nonce>` in that group or channel.
6. Vezdepost polls automatically and completes only after server-side
   permission verification.

The command and copy button are visible before polling begins. A manual
checklist remains visible during waiting and error states. If the server has
already discovered the destination, “Check again” verifies that destination
directly without requiring the command again.

### Server contract

`MaxProvider.getBotId()` returns one of:

- `waiting`, optionally with `lastChatId`;
- `ready` with `chatId`;
- `bot_not_admin` with `candidateChatId`;
- `missing_permissions` with `candidateChatId`;
- `max_error`.

Discovery accepts only an exact `/connect <nonce>` command. Permission checks
use the bot membership returned by MAX and require administrator status plus
`read_all_messages` and `write`. Candidate retries skip update discovery and
recheck membership directly. The controller converts query-string IDs to
finite numbers before calling the provider.

## Moltbook

### User flow

1. Explain that Vezdepost is creating a Moltbook agent that the human owner
   must claim.
2. Ask for an agent name and optional description.
3. Register once, then show a prominent “Open claim page” action.
4. Explain that the owner follows the instructions on Moltbook; the exact
   ownership method may change, so Vezdepost does not hard-code an X-only
   promise.
5. Poll for up to two minutes, then show “Check again” without losing the API
   key or claim URL.

Only HTTPS claim URLs on `www.moltbook.com` with a `/claim/` path may be
opened. Invalid responses produce a safe local error. The API key remains in
component memory and is never rendered, copied, logged, or placed in a URL.
Claim-status checks change from a GET query parameter to a POST request body.

## Farcaster

The existing Neynar sign-in button remains authoritative. The wrapper shows:

1. select the Farcaster button;
2. approve the signer in the Farcaster client or QR flow.

It explicitly says that Vezdepost will not ask for a password or recovery
phrase. After Neynar returns a code, the current loading state and completion
callback remain unchanged. Unused wrapper imports and the grammatically broken
placeholder sentence are removed.

## Error handling

- MAX distinguishes missing administrator status from missing permissions.
- MAX and Moltbook show a retry action without discarding discovered state.
- Poll timeouts are ordinary recoverable states, not generic errors.
- Fetch or JSON failures render safe translated copy.
- Stale async loops cannot complete a newer attempt or an unmounted component.

## Testing

- Pure MAX helpers: exact command parsing and permission evaluation.
- MAX provider: waiting cursor, success, both permission failures, candidate
  retry, and upstream error.
- MAX component: destination choice, command copy, success, permission error,
  retry, timeout, and unmount cancellation.
- Moltbook helpers/component: claim URL allowlist, registration error, success,
  timeout/retry, and unmount cancellation.
- Farcaster component: explanatory copy and completion callback.
- Locale contract: all new strings exist in English and Russian.

## Sources checked

- MAX sending messages: https://dev.max.ru/docs-api/methods/POST/messages
- MAX channel administrators: https://dev.max.ru/help/channels
- MAX channel comment permissions: https://dev.max.ru/docs-api/methods/POST/messages/-messageId-/comments
- Moltbook official agent instructions: https://github.com/Moltbook-Official/moltbook/blob/main/skill.md
