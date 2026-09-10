# Telegram Guided Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ambiguous Telegram bot setup modal with separate guided group and channel flows that automate chat selection and refuse to create integrations until bot permissions are verified.

**Architecture:** Keep the existing social integration callback and polling route, but give the Telegram provider a typed discovery/permission result and candidate-chat retry. Put browser-only link/command construction in a pure frontend helper, then make the existing Telegram Web3 provider a small state machine over that helper and the typed polling result.

**Tech Stack:** React, TypeScript, Tailwind CSS 3, NestJS, `node-telegram-bot-api`, Vitest, Testing Library, existing `useFetch`, translation, modal, button, input, and toaster utilities.

## Global Constraints

- Use PNPM only; install no new dependency or frontend component package.
- Reuse existing project colors and UI primitives; do not use deprecated `--color-custom*` values.
- Keep the established `onComplete(chatId, nonce)` callback and social integration persistence path.
- Keep legacy `/connect <nonce>` discovery as the manual fallback.
- Request `manage_chat` for groups and `post_messages` for channels; request no unrelated Telegram rights.
- Verify groups by administrator/creator status and channels by administrator/creator status plus `can_post_messages` for administrators.
- Do not add a database migration.
- Add Russian and English copy; allow existing fallback behavior for other locales.
- Run lint only from the repository root.
- Leave authenticated Telegram acceptance to the owner; run automated and unauthenticated checks locally.

---

## File map

- Create `apps/frontend/src/components/launches/web3/providers/telegram.connection.ts`: pure frontend contract, deep-link builder, command builder, and copy/status types.
- Create `apps/frontend/src/components/launches/web3/providers/telegram.connection.spec.ts`: unit tests for exact deep links and commands.
- Create `apps/frontend/src/components/launches/web3/providers/telegram.provider.spec.tsx`: component behavior tests for group, channel, retry, timeout, and completion.
- Modify `apps/frontend/src/components/launches/web3/providers/telegram.provider.tsx`: guided state machine and accessible UI.
- Modify `apps/backend/src/api/routes/integrations.controller.ts`: type the optional candidate chat query and pass it to the provider.
- Modify `libraries/nestjs-libraries/src/integrations/social/telegram.provider.ts`: parse discovery messages, validate destination-specific permissions, and return typed results.
- Modify `libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts`: unit coverage for discovery and permissions.
- Modify `libraries/react-shared-libraries/src/translation/locales/en/translation.json`: English guided-flow copy.
- Modify `libraries/react-shared-libraries/src/translation/locales/ru/translation.json`: Russian guided-flow copy.

---

### Task 1: Typed Telegram discovery and permission verification

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social/telegram.provider.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts`
- Modify: `apps/backend/src/api/routes/integrations.controller.ts`

**Interfaces:**
- Consumes: Telegram `getUpdates`, `getMe`, `getChat`, and `getChatMember` responses.
- Produces: `TelegramConnectionResult`, `TelegramConnectionStatus`, `parseTelegramConnectionMessage(text)`, and `getBotId({ word, id?, chatId? })`.

- [ ] **Step 1: Add failing parser and permission tests**

Append focused tests that import the named helpers and assert exact behavior:

```ts
describe('Telegram connection discovery', () => {
  it.each([
    ['/start nonce_123', { kind: 'start', nonce: 'nonce_123' }],
    ['/start@vezdepost_bot nonce-123', { kind: 'start', nonce: 'nonce-123' }],
    ['/connect nonce_123', { kind: 'connect', nonce: 'nonce_123' }],
  ])('parses %s', (text, expected) => {
    expect(parseTelegramConnectionMessage(text)).toEqual(expected);
  });

  it.each(['/start', '/connect', '/connect nonce extra', 'x/connect nonce']) (
    'rejects %s',
    (text) => expect(parseTelegramConnectionMessage(text)).toBeNull()
  );

  it('requires a group administrator role', () => {
    expect(evaluateTelegramPermissions('supergroup', { status: 'member' } as any))
      .toBe('bot_not_admin');
    expect(evaluateTelegramPermissions('group', { status: 'administrator' } as any))
      .toBe('ready');
  });

  it('requires the channel posting permission', () => {
    expect(evaluateTelegramPermissions('channel', {
      status: 'administrator',
      can_post_messages: false,
    } as any)).toBe('missing_post_permission');
    expect(evaluateTelegramPermissions('channel', {
      status: 'administrator',
      can_post_messages: true,
    } as any)).toBe('ready');
  });
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```bash
pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts
```

Expected: FAIL because `parseTelegramConnectionMessage` and `evaluateTelegramPermissions` are not exported.

- [ ] **Step 3: Implement exact message parsing and permission evaluation**

Add these public types and pure helpers near the provider types:

```ts
export type TelegramConnectionStatus =
  | 'waiting'
  | 'ready'
  | 'bot_not_admin'
  | 'missing_post_permission'
  | 'telegram_error';

export type TelegramConnectionResult = {
  status: TelegramConnectionStatus;
  chatId?: number;
  candidateChatId?: number;
  lastChatId?: number;
};

export const parseTelegramConnectionMessage = (text?: string) => {
  if (!text) return null;
  const match = text.match(/^\/(start|connect)(?:@[A-Za-z0-9_]+)? ([A-Za-z0-9_-]{1,64})$/);
  if (!match) return null;
  return {
    kind: match[1] as 'start' | 'connect',
    nonce: match[2],
  };
};

export const evaluateTelegramPermissions = (
  chatType: string,
  member: TelegramBot.ChatMember
): TelegramConnectionStatus => {
  if (member.status === 'creator') return 'ready';
  if (member.status !== 'administrator') return 'bot_not_admin';
  if (chatType === 'channel' && member.can_post_messages !== true) {
    return 'missing_post_permission';
  }
  return 'ready';
};
```

Extend `TelegramBotClient` with `getUpdates`, `getMe`, `getChat`, and
`getChatMember` if the pick does not already contain every method used by the
tests.

- [ ] **Step 4: Add failing provider-result tests**

Create bot doubles for these cases and assert the complete result objects:

```ts
expect(await provider.getBotId({ word: 'nonce_123' })).toEqual({
  status: 'waiting',
  lastChatId: 78,
});

expect(await provider.getBotId({ word: 'nonce_123' })).toEqual({
  status: 'bot_not_admin',
  candidateChatId: -1001,
});

expect(await provider.getBotId({ word: 'nonce_123', chatId: -1001 })).toEqual({
  status: 'ready',
  chatId: -1001,
});
```

Also assert `missing_post_permission`, exact nonce matching, group start
discovery, legacy channel connect discovery, and `{ status: 'telegram_error' }`
for a rejected Telegram request.

- [ ] **Step 5: Run the focused test and verify result-contract failures**

Run the same Vitest command. Expected: parser tests PASS and provider-result
tests FAIL because `getBotId` still returns the legacy shapes.

- [ ] **Step 6: Implement typed discovery and candidate retry**

Change the method signature to:

```ts
async getBotId(query: {
  id?: number;
  word: string;
  chatId?: number;
}): Promise<TelegramConnectionResult>
```

Implement one private verifier:

```ts
private async verifyConnection(chatId: number): Promise<TelegramConnectionResult> {
  const [chat, bot] = await Promise.all([
    this.botClient.getChat(chatId),
    this.botClient.getMe(),
  ]);
  const member = await this.botClient.getChatMember(chatId, bot.id);
  const status = evaluateTelegramPermissions(chat.type, member);
  return status === 'ready'
    ? { status, chatId }
    : { status, candidateChatId: chatId };
}
```

When `query.chatId` is present, call `verifyConnection` immediately. Otherwise,
fetch updates, inspect both `message` and `channel_post`, compare the parsed
nonce exactly to `query.word`, and verify the matching chat. When there is no
match, return `waiting` and the latest offset. Wrap Telegram calls and return
`telegram_error` after logging the server-side exception.

Do not send a misleading success message into the chat. Delete the discovery
message only when the current bot membership data explicitly grants deletion;
otherwise leave it untouched.

- [ ] **Step 7: Type the controller query**

Use a string boundary for HTTP query values and normalize finite numbers:

```ts
async getUpdates(
  @Query() query: { word: string; id?: string; chatId?: string }
) {
  return new TelegramProvider().getBotId({
    word: query.word,
    ...(query.id && Number.isFinite(Number(query.id))
      ? { id: Number(query.id) }
      : {}),
    ...(query.chatId && Number.isFinite(Number(query.chatId))
      ? { chatId: Number(query.chatId) }
      : {}),
  });
}
```

- [ ] **Step 8: Run backend tests and commit**

Run:

```bash
pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts
```

Expected: PASS.

Commit only the three task files:

```bash
git add libraries/nestjs-libraries/src/integrations/social/telegram.provider.ts libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts apps/backend/src/api/routes/integrations.controller.ts
git commit -m "feat: verify Telegram connection permissions"
```

---

### Task 2: Pure Telegram connection helpers

**Files:**
- Create: `apps/frontend/src/components/launches/web3/providers/telegram.connection.ts`
- Create: `apps/frontend/src/components/launches/web3/providers/telegram.connection.spec.ts`

**Interfaces:**
- Consumes: configured bot name, backend nonce, and selected destination.
- Produces: `TelegramDestination`, `TelegramConnectionResponse`, `buildTelegramDeepLink()`, and `buildTelegramConnectCommand()`.

- [ ] **Step 1: Write failing helper tests**

```ts
describe('Telegram connection helpers', () => {
  it('builds a group admin deep link with the nonce', () => {
    expect(buildTelegramDeepLink({
      botName: '@vezdepost_bot',
      nonce: 'nonce_123',
      destination: 'group',
    })).toBe('https://t.me/vezdepost_bot?startgroup=nonce_123&admin=manage_chat');
  });

  it('builds a channel deep link with posting permission', () => {
    expect(buildTelegramDeepLink({
      botName: 'vezdepost_bot',
      nonce: 'ignored',
      destination: 'channel',
    })).toBe('https://t.me/vezdepost_bot?startchannel&admin=post_messages');
  });

  it('builds the channel fallback command', () => {
    expect(buildTelegramConnectCommand('nonce_123')).toBe('/connect nonce_123');
  });
});
```

- [ ] **Step 2: Run the helper test and verify it fails**

```bash
pnpm exec vitest run apps/frontend/src/components/launches/web3/providers/telegram.connection.spec.ts
```

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement the pure helper module**

```ts
export type TelegramDestination = 'group' | 'channel';

export type TelegramConnectionResponse = {
  status:
    | 'waiting'
    | 'ready'
    | 'bot_not_admin'
    | 'missing_post_permission'
    | 'telegram_error';
  chatId?: number;
  candidateChatId?: number;
  lastChatId?: number;
};

export const buildTelegramConnectCommand = (nonce: string) =>
  `/connect ${nonce}`;

export const buildTelegramDeepLink = ({
  botName,
  nonce,
  destination,
}: {
  botName: string;
  nonce: string;
  destination: TelegramDestination;
}) => {
  const username = botName.replace(/^@/, '');
  return destination === 'group'
    ? `https://t.me/${username}?startgroup=${encodeURIComponent(nonce)}&admin=manage_chat`
    : `https://t.me/${username}?startchannel&admin=post_messages`;
};
```

- [ ] **Step 4: Run helper tests and commit**

Run the focused Vitest command. Expected: PASS.

```bash
git add apps/frontend/src/components/launches/web3/providers/telegram.connection.ts apps/frontend/src/components/launches/web3/providers/telegram.connection.spec.ts
git commit -m "feat: add Telegram connection links"
```

---

### Task 3: Guided Telegram modal state machine

**Files:**
- Modify: `apps/frontend/src/components/launches/web3/providers/telegram.provider.tsx`
- Create: `apps/frontend/src/components/launches/web3/providers/telegram.provider.spec.tsx`

**Interfaces:**
- Consumes: Task 2 helpers and `TelegramConnectionResponse` from the authenticated polling route.
- Produces: destination selection, automated group flow, channel confirmation flow, finite polling, retry, manual help, and verified `onComplete` calls.

- [ ] **Step 1: Write failing component tests for the primary paths**

Mock `useFetch`, `useVariables`, `useT`, clipboard, and the toaster. Assert:

```ts
it('starts with group and channel choices', () => {
  render(<TelegramProvider onComplete={vi.fn()} nonce="nonce_123" />);
  expect(screen.getByRole('button', { name: /group/i })).toBeVisible();
  expect(screen.getByRole('button', { name: /channel/i })).toBeVisible();
});

it('opens the group deep link and never shows a command', () => {
  render(<TelegramProvider onComplete={vi.fn()} nonce="nonce_123" />);
  fireEvent.click(screen.getByRole('button', { name: /group/i }));
  expect(screen.getByRole('link', { name: /choose a group/i })).toHaveAttribute(
    'href',
    'https://t.me/vezdepost_bot?startgroup=nonce_123&admin=manage_chat'
  );
  expect(screen.queryByText('/connect nonce_123')).not.toBeInTheDocument();
});

it('shows the exact command after choosing a channel', () => {
  render(<TelegramProvider onComplete={vi.fn()} nonce="nonce_123" />);
  fireEvent.click(screen.getByRole('button', { name: /channel/i }));
  expect(screen.getByText('/connect nonce_123')).toBeVisible();
});
```

- [ ] **Step 2: Run the component test and verify the red state**

```bash
pnpm exec vitest run apps/frontend/src/components/launches/web3/providers/telegram.provider.spec.tsx
```

Expected: FAIL because the current component has no destination choices.

- [ ] **Step 3: Implement destination and instruction states**

Replace the boolean `step` with explicit state:

```ts
type TelegramStage =
  | 'choose'
  | 'group_setup'
  | 'channel_setup'
  | 'verifying'
  | 'permission_error'
  | 'timed_out';

const [stage, setStage] = useState<TelegramStage>('choose');
const [destination, setDestination] = useState<TelegramDestination>();
const [candidateChatId, setCandidateChatId] = useState<number>();
const [lastChatId, setLastChatId] = useState<number>();
const [connectionStatus, setConnectionStatus] =
  useState<TelegramConnectionResponse['status']>('waiting');
```

Render native buttons for group/channel selection, an external anchor generated
by `buildTelegramDeepLink`, channel-only command/copy UI, and a collapsed manual
fallback. Reuse project Tailwind colors and Button/Input components. Do not use
clickable wrapper divs as controls.

- [ ] **Step 4: Write failing polling and recovery tests**

Use fake timers and sequential fetch results to prove:

```ts
it('completes only a verified ready response', async () => {
  fetcher.mockResolvedValueOnce(response({ status: 'waiting', lastChatId: 9 }));
  fetcher.mockResolvedValueOnce(response({ status: 'ready', chatId: -1001 }));
  // select group, click the Telegram link, advance the two-second timer
  expect(onComplete).toHaveBeenCalledOnce();
  expect(onComplete).toHaveBeenCalledWith(-1001, 'nonce_123');
});

it('rechecks a candidate chat without another command', async () => {
  fetcher.mockResolvedValueOnce(response({
    status: 'bot_not_admin',
    candidateChatId: -1001,
  }));
  // click "Check again"
  expect(fetcher).toHaveBeenLastCalledWith(
    expect.stringContaining('chatId=-1001')
  );
});
```

Also assert missing-post copy, Telegram error copy, timeout, copy confirmation,
and cancellation on unmount.

- [ ] **Step 5: Implement finite polling and candidate retry**

Use a 90-second deadline and the existing two-second timer. Build the endpoint
with `URLSearchParams` so the nonce and numeric values are encoded. Update
`lastChatId` from waiting responses. Store `candidateChatId` on permission
errors, stop the loop, and make "Check again" call the endpoint with that chat
ID. Call `onComplete` only when `status === 'ready'` and `chatId` exists.

Use an incrementing attempt ref or abort flag so stale loops cannot update state
after retry, success, or unmount. The Telegram anchor's click handler starts
polling synchronously before navigation. A timeout switches to `timed_out` and
preserves the nonce for retry.

- [ ] **Step 6: Run component and helper tests and commit**

```bash
pnpm exec vitest run apps/frontend/src/components/launches/web3/providers/telegram.connection.spec.ts apps/frontend/src/components/launches/web3/providers/telegram.provider.spec.tsx
```

Expected: PASS.

```bash
git add apps/frontend/src/components/launches/web3/providers/telegram.provider.tsx apps/frontend/src/components/launches/web3/providers/telegram.provider.spec.tsx
git commit -m "feat: guide Telegram channel connection"
```

---

### Task 4: Localized copy and regression verification

**Files:**
- Modify: `libraries/react-shared-libraries/src/translation/locales/en/translation.json`
- Modify: `libraries/react-shared-libraries/src/translation/locales/ru/translation.json`

**Interfaces:**
- Consumes: every translation key referenced by the guided component.
- Produces: complete English and Russian guided-flow copy and a verified workspace.

- [ ] **Step 1: Add every referenced English and Russian key**

Use a consistent `telegram_connection_*` prefix. The complete semantic set is:

```json
{
  "telegram_connection_choose_type": "What do you want to connect?",
  "telegram_connection_group": "Group",
  "telegram_connection_group_hint": "A chat where members communicate",
  "telegram_connection_channel": "Channel",
  "telegram_connection_channel_hint": "A publication feed for subscribers",
  "telegram_connection_choose_group": "Open Telegram and choose a group",
  "telegram_connection_choose_channel": "Open Telegram and choose a channel",
  "telegram_connection_group_permission": "Keep the suggested administrator permission enabled so Postiz can publish.",
  "telegram_connection_channel_permission": "Allow the bot to publish messages in the channel.",
  "telegram_connection_confirm_channel": "Copy this command and publish it once in the selected channel.",
  "telegram_connection_waiting": "Waiting for Telegram…",
  "telegram_connection_check_again": "Check again",
  "telegram_connection_bot_not_admin": "The bot was added but is not an administrator.",
  "telegram_connection_missing_post_permission": "The bot cannot publish. Enable its permission to post messages.",
  "telegram_connection_telegram_error": "Telegram did not respond. Try checking again.",
  "telegram_connection_timed_out": "We have not received confirmation yet.",
  "telegram_connection_manual_help": "Add the bot manually",
  "telegram_connection_copy_command": "Copy command",
  "telegram_connection_copied": "Command copied"
}
```

Add natural Russian equivalents that use «ВездеПост», «группа», «канал», and
«бот» consistently. Keep commands and usernames unchanged.

- [ ] **Step 2: Verify translation JSON and run all focused tests**

```bash
node -e "JSON.parse(require('fs').readFileSync('libraries/react-shared-libraries/src/translation/locales/en/translation.json')); JSON.parse(require('fs').readFileSync('libraries/react-shared-libraries/src/translation/locales/ru/translation.json'))"
pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts apps/frontend/src/components/launches/web3/providers/telegram.connection.spec.ts apps/frontend/src/components/launches/web3/providers/telegram.provider.spec.tsx
```

Expected: JSON command exits zero; all focused tests PASS.

- [ ] **Step 3: Run repository verification**

From the repository root:

```bash
pnpm run verify:workspace
pnpm exec eslint apps/frontend/src/components/launches/web3/providers/telegram.connection.ts apps/frontend/src/components/launches/web3/providers/telegram.provider.tsx apps/frontend/src/components/launches/web3/providers/telegram.connection.spec.ts apps/frontend/src/components/launches/web3/providers/telegram.provider.spec.tsx apps/backend/src/api/routes/integrations.controller.ts libraries/nestjs-libraries/src/integrations/social/telegram.provider.ts libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts
pnpm exec tsc --noEmit -p apps/frontend/tsconfig.json
pnpm exec tsc --noEmit -p apps/backend/tsconfig.json
```

Expected: all commands exit zero.

- [ ] **Step 4: Review the final diff against the design**

Confirm:

- group flow has no command in its primary path;
- channel flow requests only `post_messages`;
- group flow requests only `manage_chat`;
- permission failures never return a successful `chatId`;
- candidate retry does not require a new Telegram message;
- old `/connect` discovery still passes its test;
- no database, lockfile, or unrelated file changed; and
- all user-facing strings have English and Russian keys.

- [ ] **Step 5: Commit localization and final corrections**

```bash
git add libraries/react-shared-libraries/src/translation/locales/en/translation.json libraries/react-shared-libraries/src/translation/locales/ru/translation.json
git commit -m "feat: localize Telegram connection guide"
```

Record the final commit list, automated verification, and this manual owner
checklist in the handoff:

1. Connect one Telegram group through the automatic group picker.
2. Confirm no `/connect` command has to be copied.
3. Connect one Telegram channel and publish the displayed command once.
4. Temporarily remove the channel posting permission and confirm the specific
   recovery message appears.
5. Restore the permission, click "Check again", and confirm the channel connects
   without republishing the command.
