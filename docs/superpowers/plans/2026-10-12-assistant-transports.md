# Assistant transports: Telegram + MAX (mobile stages 4–6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Telegram assistant into a messenger-agnostic assistant with two transports, Telegram (unchanged behaviour) and MAX (new), sharing the draft, panel, link and publish logic; add the `transport` column to links; wire a MAX poller behind `MAX_ASSISTANT_TOKEN`; add «Привязать MAX» buttons.

**Architecture:** A generic `AssistantRouter` in `libraries/nestjs-libraries/src/assistant/` consumes `AssistantEvent`s (message / callback) and talks to an `AssistantTransport` (send, edit, delete, answer, download). The existing `TelegramAssistantRouter` becomes a thin wrapper: it converts Telegram updates into events and adapts the Telegram API object, so `telegram.assistant.router.spec.ts` stays untouched and green. The canonical keyboard format stays Telegram-shaped (`inline_keyboard` / `callback_data`), which the existing draft and router specs assert on; the MAX transport maps it to MAX callback buttons. Links get a `transport` column with a composite unique key; the link service and repository take `transport` as an explicit argument, defaulting to `'telegram'`. The MAX transport is built on the already-installed `@maxhub/max-bot-api` with a separate bot token, because the MAX social provider already consumes `getUpdates` on `MAX_TOKEN` for channel linking and two consumers would steal each other's updates.

**Tech Stack:** NestJS 10, Prisma 6.5 (`db push` at startup), `@maxhub/max-bot-api` 0.2.x, vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-12-mobile-version-design.md`, section 6 (ассистент с двумя транспортами) and stage rows 4, 5, 6 in section 7.

## Global Constraints

- Only pnpm. Tests from the root: `pnpm vitest run <path>`.
- `libraries/nestjs-libraries/src/telegram-assistant/telegram.assistant.router.spec.ts`, `telegram.assistant.draft.spec.ts`, `telegram.assistant.poller.spec.ts` and `telegram.assistant.publisher.spec.ts` must stay green **without edits**. Only `telegram.assistant.link.service.spec.ts` may change (its repository mocks gain a `transport` argument).
- Bot user-facing Russian strings stay byte-identical for Telegram.
- Schema change is additive and applied by the startup `prisma db push`; the owner pre-applies it on a prod copy per `docs/devops` before deploying. Never rename `telegramUserId` (a rename is drop+add under `db push`).
- New env vars `MAX_ASSISTANT_TOKEN` (secret, `.env`) and `MAX_ASSISTANT_BOT_NAME` get a compose line, an `.env.example` line, a configure script and a `deploy/production-config.spec.ts` assertion, like `TELEGRAM_ASSISTANT_*`.
- MAX first cut handles text and images. Videos from MAX are refused with a clear message until the video download URL is verified on the live bot (stage 5 spike item). Record this in the ledger.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **A Telegram user's existing link must keep working after the migration**: rows get `transport = 'telegram'` by default and `findLink('telegram', id)` finds them (Task 2 test "finds a legacy link by transport telegram").
2. **A MAX user and a Telegram user with the same numeric id must not collide** (Task 2 test "keeps links apart per transport").
3. **A MAX video must not be silently dropped**: the user gets the «пока только фото» message and the draft is unchanged (Task 3 test "refuses a video attachment with a clear message").
4. **The MAX poller must not consume the social provider's updates**: it uses its own token and lock key (Task 4: constructed from `MAX_ASSISTANT_TOKEN`, lock `max-assistant:poller`; test "uses its own lock key").
5. **An expired link code in MAX must produce the same guidance as in Telegram** (Task 3 test "tells the user to get a new link when the code is stale").

---

### Task 1: Generic assistant core; Telegram router becomes a wrapper

**Files:**
- Create: `libraries/nestjs-libraries/src/assistant/assistant.types.ts`
- Create: `libraries/nestjs-libraries/src/assistant/assistant.router.ts`
- Create: `libraries/nestjs-libraries/src/assistant/assistant.router.spec.ts`
- Create: `libraries/nestjs-libraries/src/assistant/telegram.events.ts`
- Create: `libraries/nestjs-libraries/src/assistant/telegram.events.spec.ts`
- Modify: `libraries/nestjs-libraries/src/telegram-assistant/telegram.assistant.router.ts` (whole file → wrapper)
- Modify: `libraries/nestjs-libraries/src/telegram-assistant/telegram.assistant.draft.ts` (export `addToDraft` and `DraftInput`; `addMessageToDraft` delegates; `DraftStore` accepts `number | string` keys)

**Interfaces:**

```ts
// assistant.types.ts
export type AssistantTransportName = 'telegram' | 'max';
export type AssistantKeyboard = InlineKeyboard;            // re-export from telegram.assistant.api (canonical shape)
export type AssistantFile = { fileId: string; kind: 'image' | 'video'; size?: number };
export type AssistantEvent =
  | { kind: 'message'; chatId: string; userId: string; text: string; file?: AssistantFile; unsupported?: boolean }
  | { kind: 'callback'; chatId: string; userId: string; messageId: string | undefined; callbackId: string; data: string };
export type AssistantTransport = {
  name: AssistantTransportName;
  maxFileBytes: number;
  sendMessage(chatId: string, text: string, keyboard?: AssistantKeyboard): Promise<string>;   // message id
  editMessage(chatId: string, messageId: string, text: string, keyboard?: AssistantKeyboard): Promise<void>;
  deleteMessage(chatId: string, messageId: string): Promise<void>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
  downloadFile(fileId: string): Promise<Buffer>;
};

// draft.ts additions
export type DraftInput = { text: string; file?: AssistantFile; unsupported?: boolean };
export const addToDraft: (draft: Draft, input: DraftInput, maxFileBytes: number) => { draft: Draft; error?: 'unsupported' | 'too_large' | 'too_many' };
// DraftStore.get/save/clear accept `number | string` (key `tg-assistant:draft:<id>` unchanged for Telegram numbers; strings are used as given, e.g. 'max:123')

// assistant.router.ts
export type AssistantRouterDeps = {
  transport: AssistantTransport;
  linkService: { consumeLinkCode(code: string, transport: AssistantTransportName, messengerUserId: string): Promise<{ organizationId: string } | null>;
                 findLink(transport: AssistantTransportName, messengerUserId: string): Promise<{ organizationId: string } | null> };
  publisher: { listChannels(orgId: string): Promise<DraftChannel[]>; publish(orgId: string, draft: Draft, download: (fileId: string) => Promise<Buffer>): Promise<PublishResult> };
  drafts: DraftStore;
  draftKeyOf: (userId: string) => number | string;       // Telegram: Number(userId); MAX: `max:${userId}`
  appUrl: string;
  linkButtonLabel: string;                               // «Постить из Telegram» / «Постить из MAX»
  panelDelayMs?: number;
};
export class AssistantRouter { constructor(deps); handle(event: AssistantEvent): Promise<void>; idle(): Promise<void>; }

// telegram.events.ts
export const telegramUpdateToEvent: (update: TelegramAssistantUpdate) => AssistantEvent | null;   // private chats only
```

The publisher's `publish` gains a third argument `download` so the same `TelegramAssistantPublisher` serves both transports: it already has `api.downloadFile` in deps; the new argument, when given, is used instead. The existing publisher spec passes no third argument and keeps working.

- [ ] **Step 1: Write the failing tests for the Telegram event mapper**

Create `libraries/nestjs-libraries/src/assistant/telegram.events.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { telegramUpdateToEvent } from './telegram.events';

const base = { update_id: 1 };

describe('telegramUpdateToEvent', () => {
  it('maps a private text message', () => {
    expect(
      telegramUpdateToEvent({
        ...base,
        message: { message_id: 10, chat: { id: 7, type: 'private' }, from: { id: 7 }, text: ' hi ' },
      })
    ).toEqual({ kind: 'message', chatId: '7', userId: '7', text: 'hi' });
  });

  it('maps the largest photo and a caption', () => {
    expect(
      telegramUpdateToEvent({
        ...base,
        message: {
          message_id: 10,
          chat: { id: 7, type: 'private' },
          from: { id: 7 },
          caption: 'c',
          photo: [{ file_id: 's', file_size: 1 }, { file_id: 'l', file_size: 9 }],
        },
      })
    ).toEqual({ kind: 'message', chatId: '7', userId: '7', text: 'c', file: { fileId: 'l', kind: 'image', size: 9 } });
  });

  it('flags unsupported documents', () => {
    const event = telegramUpdateToEvent({
      ...base,
      message: { message_id: 10, chat: { id: 7, type: 'private' }, from: { id: 7 }, document: { file_id: 'd', mime_type: 'application/pdf' } },
    });
    expect(event).toMatchObject({ kind: 'message', unsupported: true });
  });

  it('maps a button press', () => {
    expect(
      telegramUpdateToEvent({
        ...base,
        callback_query: { id: 'cb', from: { id: 7 }, data: 't:vk', message: { message_id: 99, chat: { id: 7 } } },
      })
    ).toEqual({ kind: 'callback', chatId: '7', userId: '7', messageId: '99', callbackId: 'cb', data: 't:vk' });
  });

  it('ignores group chats and empty updates', () => {
    expect(telegramUpdateToEvent({ ...base, message: { message_id: 1, chat: { id: 1, type: 'group' }, from: { id: 1 }, text: 'x' } })).toBeNull();
    expect(telegramUpdateToEvent({ ...base })).toBeNull();
  });
});
```

Run: `pnpm vitest run libraries/nestjs-libraries/src/assistant/telegram.events.spec.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 2: Implement types, draft generalisation and the event mapper**

Create `libraries/nestjs-libraries/src/assistant/assistant.types.ts`:

```ts
import type { InlineKeyboard } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.api';

export type AssistantTransportName = 'telegram' | 'max';
/** Canonical keyboard shape (Telegram's); other transports map it. */
export type AssistantKeyboard = InlineKeyboard;
export type AssistantFile = { fileId: string; kind: 'image' | 'video'; size?: number };

export type AssistantEvent =
  | {
      kind: 'message';
      chatId: string;
      userId: string;
      text: string;
      file?: AssistantFile;
      unsupported?: boolean;
    }
  | {
      kind: 'callback';
      chatId: string;
      userId: string;
      messageId: string | undefined;
      callbackId: string;
      data: string;
    };

export type AssistantTransport = {
  name: AssistantTransportName;
  maxFileBytes: number;
  sendMessage(chatId: string, text: string, keyboard?: AssistantKeyboard): Promise<string>;
  editMessage(chatId: string, messageId: string, text: string, keyboard?: AssistantKeyboard): Promise<void>;
  deleteMessage(chatId: string, messageId: string): Promise<void>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
  downloadFile(fileId: string): Promise<Buffer>;
};
```

In `telegram.assistant.draft.ts`:
- Add `export type DraftInput = { text: string; file?: DraftFile & { size?: number }; unsupported?: boolean };`
- Add `addToDraft(draft, input, maxFileBytes)` with the body of today's `addMessageToDraft` after `fileOf` (unsupported → error, size > maxFileBytes → too_large, length ≥ MAX_FILES → too_many, else merge text/file).
- Rewrite `addMessageToDraft(draft, message)` as: `const { file, size, unsupported } = fileOf(message); return addToDraft(draft, { text: (message.text ?? message.caption ?? '').trim(), file: file ? { ...file, size } : undefined, unsupported }, TELEGRAM_DOWNLOAD_MAX_BYTES);` (identical results, so the draft spec stays green).
- Change `DraftStore` methods to take `key: number | string` and `draftKey = (key: number | string) => typeof key === 'number' ? \`tg-assistant:draft:${key}\` : \`assistant:draft:${key}\``.

Create `libraries/nestjs-libraries/src/assistant/telegram.events.ts`:

```ts
import {
  PUBLISHABLE_MIME,
} from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.draft';
import type { TelegramAssistantUpdate } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.api';
import type { AssistantEvent, AssistantFile } from '@gitroom/nestjs-libraries/assistant/assistant.types';

type Message = NonNullable<TelegramAssistantUpdate['message']>;

const fileOf = (message: Message): { file?: AssistantFile; unsupported?: boolean } => {
  if (message.photo?.length) {
    const largest = message.photo[message.photo.length - 1];
    return { file: { fileId: largest.file_id, kind: 'image', size: largest.file_size } };
  }
  if (message.video) {
    if (message.video.mime_type && !PUBLISHABLE_MIME.has(message.video.mime_type)) {
      return { unsupported: true };
    }
    return { file: { fileId: message.video.file_id, kind: 'video', size: message.video.file_size } };
  }
  if (message.document) {
    const mime = message.document.mime_type || '';
    if (!PUBLISHABLE_MIME.has(mime)) {
      return { unsupported: true };
    }
    return {
      file: { fileId: message.document.file_id, kind: mime.startsWith('image/') ? 'image' : 'video', size: message.document.file_size },
    };
  }
  return {};
};

/** Private-chat messages and button presses become assistant events. */
export const telegramUpdateToEvent = (update: TelegramAssistantUpdate): AssistantEvent | null => {
  if (update.callback_query) {
    const q = update.callback_query;
    return {
      kind: 'callback',
      chatId: String(q.message?.chat.id ?? q.from.id),
      userId: String(q.from.id),
      messageId: q.message ? String(q.message.message_id) : undefined,
      callbackId: q.id,
      data: q.data ?? '',
    };
  }
  const message = update.message;
  if (!message || message.chat.type !== 'private' || !message.from) {
    return null;
  }
  const { file, unsupported } = fileOf(message);
  return {
    kind: 'message',
    chatId: String(message.chat.id),
    userId: String(message.from.id),
    text: (message.text ?? message.caption ?? '').trim(),
    ...(file ? { file } : {}),
    ...(unsupported ? { unsupported: true } : {}),
  };
};
```

Run the mapper spec: PASS, 5 tests. Run the draft spec: `pnpm vitest run libraries/nestjs-libraries/src/telegram-assistant/telegram.assistant.draft.spec.ts` — PASS unchanged.

- [ ] **Step 3: Write the failing generic router tests**

Create `libraries/nestjs-libraries/src/assistant/assistant.router.spec.ts` as a copy of the structure of `telegram.assistant.router.spec.ts` but feeding events. Minimum cases (each mirrors an existing Telegram case so behaviour parity is pinned):

```ts
import { describe, expect, it, vi } from 'vitest';
import { MemoryKeyValueStore } from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import { DraftStore } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.draft';
import { AssistantRouter } from './assistant.router';

const msg = (text: string, extra: any = {}) => ({ kind: 'message', chatId: '7', userId: '7', text, ...extra });
const press = (data: string) => ({ kind: 'callback', chatId: '7', userId: '7', messageId: '99', callbackId: 'cb', data });

const make = (linked = true) => {
  let next = 100;
  const transport = {
    name: 'max' as const,
    maxFileBytes: 1000,
    sendMessage: vi.fn(async () => String(next++)),
    editMessage: vi.fn(async () => undefined),
    deleteMessage: vi.fn(async () => undefined),
    answerCallback: vi.fn(async () => undefined),
    downloadFile: vi.fn(async () => Buffer.from('x')),
  };
  const linkService = {
    consumeLinkCode: vi.fn(async (code: string) => (code === 'good' ? { organizationId: 'org-1' } : null)),
    findLink: vi.fn(async () => (linked ? { organizationId: 'org-1' } : null)),
  };
  const publisher = {
    listChannels: vi.fn(async () => [{ id: 'vk-1', name: 'My VK', providerIdentifier: 'vk' }]),
    publish: vi.fn(async () => ({ published: ['My VK'], failed: [] })),
  };
  const drafts = new DraftStore(new MemoryKeyValueStore());
  const router = new AssistantRouter({
    transport, linkService: linkService as any, publisher: publisher as any, drafts,
    draftKeyOf: (id) => `max:${id}`, appUrl: 'https://app.vezdepost.ru', linkButtonLabel: 'Постить из MAX', panelDelayMs: 0,
  });
  const handle = async (e: any) => { await router.handle(e); await router.idle(); };
  return { handle, transport, linkService, publisher, drafts };
};
const lastText = (t: any) => t.sendMessage.mock.calls.at(-1)[1] as string;

describe('AssistantRouter', () => {
  it('links the account with /start <code> and uses the transport name', async () => {
    const { handle, linkService, transport } = make(false);
    await handle(msg('/start good'));
    expect(linkService.consumeLinkCode).toHaveBeenCalledWith('good', 'max', '7');
    expect(lastText(transport)).toContain('привязан');
  });

  it('tells the user to get a new link when the code is stale', async () => {
    const { handle, transport } = make(false);
    await handle(msg('/start stale'));
    expect(lastText(transport)).toContain('Постить из MAX');
  });

  it('builds a draft and renders the panel', async () => {
    const { handle, transport } = make();
    await handle(msg('Hello', { file: { fileId: 'f', kind: 'image', size: 10 } }));
    const [, text, keyboard] = transport.sendMessage.mock.calls.at(-1);
    expect(text).toContain('Файлы: 1');
    expect(keyboard.inline_keyboard[0][0].callback_data).toBe('t:vk-1');
  });

  it('refuses a file above the transport limit', async () => {
    const { handle, transport } = make();
    await handle(msg('', { file: { fileId: 'f', kind: 'image', size: 5000 } }));
    expect(transport.sendMessage.mock.calls[0][1]).toContain('больше');
  });

  it('publishes with the transport downloader', async () => {
    const { handle, transport, publisher } = make();
    await handle(msg('Hello'));
    await handle(press('t:vk-1'));
    await handle(press('p'));
    expect(publisher.publish).toHaveBeenCalledWith('org-1', expect.objectContaining({ selected: ['vk-1'] }), transport.downloadFile);
    expect(lastText(transport)).toContain('✅');
  });
});
```

Run: FAIL, cannot find module `./assistant.router`.

- [ ] **Step 4: Implement the generic router and the Telegram wrapper**

Create `libraries/nestjs-libraries/src/assistant/assistant.router.ts` by moving the body of today's `TelegramAssistantRouter` and making these substitutions:
- `deps.api.*` → `deps.transport.*`; ids are strings; `userId` for drafts goes through `deps.draftKeyOf(userId)`.
- `handle(event: AssistantEvent)`: `callback` → `handleCallback`, `message` → `handleMessage`.
- `handleMessage` parses `/start`, `/help` from `event.text` exactly as today; `linkService.consumeLinkCode(code, deps.transport.name, userId)` and `findLink(deps.transport.name, userId)`.
- Draft merge: `addToDraft(current, { text: event.text, file: event.file, unsupported: event.unsupported }, deps.transport.maxFileBytes)`.
- `DRAFT_ERRORS.too_large` text is built from the limit: `` `Файл больше ${Math.round(maxFileBytes / 1024 / 1024)} МБ — ${name === 'telegram' ? 'Telegram не даёт боту скачать такой' : 'бот не может скачать такой'}. Сожмите видео или опубликуйте через сайт.` `` so Telegram's string stays byte-identical («Файл больше 20 МБ — Telegram не даёт боту скачать такой. Сожмите видео или опубликуйте через сайт.»).
- `linkInstructions` line 2 uses `deps.linkButtonLabel`: `` `2. Нажмите там «${linkButtonLabel}» — я привяжусь к аккаунту.` `` and the stale-code message `` `Ссылка устарела. Откройте ${appUrl} и нажмите «${linkButtonLabel}» ещё раз.` ``; `linkButtonLabel` is `'Постить из Telegram'` for Telegram so its strings are unchanged.
- The successful link message says `` `✅ Готово, ${name === 'telegram' ? 'Telegram' : 'MAX'} привязан к Вездепосту. …` ``.
- `publishDraft` calls `deps.publisher.publish(organizationId, draft, deps.transport.downloadFile)`.

Replace `telegram.assistant.router.ts` with the wrapper:

```ts
import type { TelegramAssistantLinkService } from '@gitroom/nestjs-libraries/database/prisma/telegram-assistant/telegram.assistant.link.service';
import type { TelegramAssistantApi, TelegramAssistantUpdate } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.api';
import { TELEGRAM_DOWNLOAD_MAX_BYTES } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.api';
import type { DraftStore } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.draft';
import type { TelegramAssistantPublisher } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.publisher';
import { AssistantRouter } from '@gitroom/nestjs-libraries/assistant/assistant.router';
import { telegramUpdateToEvent } from '@gitroom/nestjs-libraries/assistant/telegram.events';
import type { AssistantTransport } from '@gitroom/nestjs-libraries/assistant/assistant.types';

export type TelegramAssistantRouterDeps = {
  api: Pick<TelegramAssistantApi, 'sendMessage' | 'editMessage' | 'deleteMessage' | 'answerCallback'> & Partial<Pick<TelegramAssistantApi, 'downloadFile'>>;
  linkService: Pick<TelegramAssistantLinkService, 'consumeLinkCode' | 'findLink'>;
  publisher: Pick<TelegramAssistantPublisher, 'listChannels' | 'publish'>;
  drafts: DraftStore;
  appUrl: string;
  panelDelayMs?: number;
};

/** Telegram adapter over the generic assistant router (ids stay numeric for the API). */
export class TelegramAssistantRouter {
  private readonly inner: AssistantRouter;

  constructor(deps: TelegramAssistantRouterDeps) {
    const transport: AssistantTransport = {
      name: 'telegram',
      maxFileBytes: TELEGRAM_DOWNLOAD_MAX_BYTES,
      sendMessage: async (chatId, text, keyboard) => String(await deps.api.sendMessage(Number(chatId), text, keyboard)),
      editMessage: (chatId, messageId, text, keyboard) => deps.api.editMessage(Number(chatId), Number(messageId), text, keyboard),
      deleteMessage: (chatId, messageId) => deps.api.deleteMessage(Number(chatId), Number(messageId)),
      answerCallback: (callbackId, text) => deps.api.answerCallback(callbackId, text),
      downloadFile: (fileId) => deps.api.downloadFile ? deps.api.downloadFile(fileId) : Promise.reject(new Error('downloadFile not available')),
    };
    this.inner = new AssistantRouter({
      transport,
      linkService: {
        consumeLinkCode: (code, _transport, userId) => deps.linkService.consumeLinkCode(code, userId),
        findLink: (_transport, userId) => deps.linkService.findLink(userId),
      },
      publisher: {
        listChannels: (orgId) => deps.publisher.listChannels(orgId),
        publish: (orgId, draft) => deps.publisher.publish(orgId, draft),   // Telegram publisher downloads via its own api
      },
      drafts: deps.drafts,
      draftKeyOf: (userId) => Number(userId),
      appUrl: deps.appUrl,
      linkButtonLabel: 'Постить из Telegram',
      panelDelayMs: deps.panelDelayMs,
    });
  }

  idle() { return this.inner.idle(); }

  async handle(update: TelegramAssistantUpdate) {
    const event = telegramUpdateToEvent(update);
    if (event) {
      await this.inner.handle(event);
    }
  }
}
```

Note the Telegram wrapper keeps calling `deps.linkService.consumeLinkCode(code, userId)` with the **current** two-argument signature; Task 2 changes that service and updates this wrapper in the same commit.

In `telegram.assistant.publisher.ts`, add the optional third parameter: `publish(organizationId, draft, download: (fileId: string) => Promise<Buffer> = (id) => this.deps.api.downloadFile(id))` and use `download(file.fileId)` in the loop.

- [ ] **Step 5: Run every assistant suite**

Run: `pnpm vitest run libraries/nestjs-libraries/src/assistant libraries/nestjs-libraries/src/telegram-assistant libraries/nestjs-libraries/src/quick-post`
Expected: PASS; the four Telegram specs unchanged.

- [ ] **Step 6: Build and commit**

Run: `pnpm run build:backend` → exit 0.

```bash
git add libraries/nestjs-libraries/src/assistant libraries/nestjs-libraries/src/telegram-assistant
git commit -m "refactor(assistant): transport-agnostic router; Telegram becomes an adapter

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Links per transport (schema, repository, service, controller)

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/schema.prisma` (model `TelegramAssistantLink`)
- Modify: `libraries/nestjs-libraries/src/database/prisma/telegram-assistant/telegram.assistant.link.repository.ts`
- Modify: `libraries/nestjs-libraries/src/database/prisma/telegram-assistant/telegram.assistant.link.service.ts`
- Modify: `libraries/nestjs-libraries/src/database/prisma/telegram-assistant/telegram.assistant.link.service.spec.ts`
- Modify: `libraries/nestjs-libraries/src/telegram-assistant/telegram.assistant.router.ts` (wrapper passes `'telegram'`)
- Create: `apps/backend/src/api/routes/assistant.link.controller.ts`
- Create: `apps/backend/src/api/routes/assistant.link.controller.spec.ts`
- Modify: `apps/backend/src/api/api.module.ts` (register the controller)
- Create: `docs/server-scripts/36-preapply-assistant-transport.sql` (the exact DDL the startup push will run, for the owner's pre-apply on a prod copy)

**Interfaces:**

```prisma
model TelegramAssistantLink {
  id             String   @id @default(uuid())
  transport      String   @default("telegram")
  telegramUserId String                     // messenger user id (name kept: rename = drop+add under db push)
  userId         String
  organizationId String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([transport, telegramUserId])
  @@index([organizationId])
}
```

```ts
// repository
upsertLink(transport: AssistantTransportName, messengerUserId: string, userId: string, organizationId: string)
findByMessengerUserId(transport, messengerUserId)
deleteByMessengerUserId(transport, messengerUserId)
isActiveMember(userId, organizationId)                 // unchanged

// service (class name kept: TelegramAssistantLinkService)
createLinkUrl(userId, organizationId, transport: AssistantTransportName = 'telegram'): Promise<string>
   // telegram → https://t.me/<TELEGRAM_ASSISTANT_BOT_NAME>?start=<code>
   // max      → https://max.ru/<MAX_ASSISTANT_BOT_NAME>?start=<code>
consumeLinkCode(code, messengerUserId, transport = 'telegram')
findLink(messengerUserId, transport = 'telegram')

// HTTP
POST /assistant/link/:transport   (transport ∈ telegram|max) → { url }
POST /telegram-assistant/link     (unchanged, still works)
```

- [ ] **Step 1: Update the link service spec first (RED)**

In `telegram.assistant.link.service.spec.ts`: change the repository mock to the new signatures (`upsertLink(transport, id, userId, org)`, `findByMessengerUserId(transport, id)`, `deleteByMessengerUserId(transport, id)`), keyed by `` `${transport}:${id}` ``. Update the existing expectations (`toHaveBeenCalledWith('telegram', '777')`). Add:

```ts
  it('finds a legacy link by transport telegram', async () => {
    const { service, repository } = make();
    repository.links.set('telegram:5', { transport: 'telegram', telegramUserId: '5', userId: 'u', organizationId: 'o' });
    await expect(service.findLink(5)).resolves.toMatchObject({ organizationId: 'o' });
    expect(repository.findByMessengerUserId).toHaveBeenCalledWith('telegram', '5');
  });

  it('keeps links apart per transport', async () => {
    const { service, repository, store } = make();
    await store.set('tg-assistant:link:c1', JSON.stringify({ userId: 'u1', organizationId: 'o1' }));
    await store.set('tg-assistant:link:c2', JSON.stringify({ userId: 'u2', organizationId: 'o2' }));
    await service.consumeLinkCode('c1', 5, 'telegram');
    await service.consumeLinkCode('c2', 5, 'max');
    expect((await service.findLink(5, 'telegram'))?.organizationId).toBe('o1');
    expect((await service.findLink(5, 'max'))?.organizationId).toBe('o2');
  });

  it('builds a MAX deep link', async () => {
    const { service } = make();
    const url = await service.createLinkUrl('u', 'o', 'max');
    expect(url).toMatch(/^https:\/\/max\.ru\/vezdepost_assistant_bot\?start=[A-Za-z0-9_-]+$/);
  });
```

(`make()` passes bot names through the constructor's optional injections: add a fourth optional `@Inject(MAX_ASSISTANT_BOT_NAME)` parameter and pass `'vezdepost_assistant_bot'` in the spec.) Adjust `make()` to also return `store`.

Run: `pnpm vitest run libraries/nestjs-libraries/src/database/prisma/telegram-assistant` → FAIL on the new/changed cases.

- [ ] **Step 2: Schema, repository, service, wrapper, controller**

Apply the schema change above. Run `pnpm run prisma-generate` so the client knows `transport`.

Repository:

```ts
upsertLink(transport: AssistantTransportName, telegramUserId: string, userId: string, organizationId: string) {
  return this._link.model.telegramAssistantLink.upsert({
    where: { transport_telegramUserId: { transport, telegramUserId } },
    create: { transport, telegramUserId, userId, organizationId },
    update: { userId, organizationId },
  });
}
findByMessengerUserId(transport, telegramUserId) { return this._link.model.telegramAssistantLink.findUnique({ where: { transport_telegramUserId: { transport, telegramUserId } } }); }
deleteByMessengerUserId(transport, telegramUserId) { return this._link.model.telegramAssistantLink.deleteMany({ where: { transport, telegramUserId } }); }
```

Service: add `MAX_ASSISTANT_BOT_NAME` token (`process.env.MAX_ASSISTANT_BOT_NAME ?? 'vezdepost_assistant_bot'`), the `transport` parameters with `'telegram'` defaults, and `createLinkUrl` choosing the base URL by transport. `findLink` deletes by `(transport, id)` when membership is gone.

Telegram wrapper (`telegram.assistant.router.ts`): `consumeLinkCode(code, userId, 'telegram')`, `findLink(userId, 'telegram')`.

Controller `apps/backend/src/api/routes/assistant.link.controller.ts`:

```ts
import { BadRequestException, Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { TelegramAssistantLinkService } from '@gitroom/nestjs-libraries/database/prisma/telegram-assistant/telegram.assistant.link.service';

const TRANSPORTS = new Set(['telegram', 'max']);

@ApiTags('Assistant')
@Controller('/assistant')
export class AssistantLinkController {
  constructor(private _linkService: TelegramAssistantLinkService) {}

  /** One-time deep link that binds a messenger account to this user and organization. */
  @Post('/link/:transport')
  async createLink(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization,
    @Param('transport') transport: string
  ) {
    if (!TRANSPORTS.has(transport)) {
      throw new BadRequestException('Unknown transport');
    }
    return { url: await this._linkService.createLinkUrl(user.id, org.id, transport as 'telegram' | 'max') };
  }
}
```

Spec `assistant.link.controller.spec.ts`: two cases, `max` returns the service URL and passes `'max'`; `'signal'` throws `BadRequestException`. Register in `api.module.ts` after `TelegramAssistantController`.

`docs/server-scripts/36-preapply-assistant-transport.sql`:

```sql
-- Pre-apply on a prod copy before deploying the assistant transports build.
-- Mirrors what `prisma db push` will do at startup; additive, no data loss.
ALTER TABLE "TelegramAssistantLink" ADD COLUMN IF NOT EXISTS "transport" TEXT NOT NULL DEFAULT 'telegram';
DROP INDEX IF EXISTS "TelegramAssistantLink_telegramUserId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "TelegramAssistantLink_transport_telegramUserId_key"
  ON "TelegramAssistantLink" ("transport", "telegramUserId");
```

- [ ] **Step 3: Run suites, build, commit**

Run: `pnpm vitest run libraries/nestjs-libraries/src/database/prisma/telegram-assistant libraries/nestjs-libraries/src/assistant libraries/nestjs-libraries/src/telegram-assistant apps/backend/src/api/routes/assistant.link.controller.spec.ts apps/backend/src/api/routes/telegram.assistant.controller.spec.ts` → PASS.
Run: `pnpm run build:backend` → exit 0.

```bash
git add libraries/nestjs-libraries/src/database/prisma/schema.prisma libraries/nestjs-libraries/src/database/prisma/telegram-assistant libraries/nestjs-libraries/src/telegram-assistant/telegram.assistant.router.ts apps/backend/src/api/routes/assistant.link.controller.ts apps/backend/src/api/routes/assistant.link.controller.spec.ts apps/backend/src/api/api.module.ts docs/server-scripts/36-preapply-assistant-transport.sql
git commit -m "feat(assistant): per-transport links and POST /assistant/link/:transport

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: MAX transport, event mapper and poller

**Files:**
- Create: `libraries/nestjs-libraries/src/assistant/max.events.ts`
- Create: `libraries/nestjs-libraries/src/assistant/max.events.spec.ts`
- Create: `libraries/nestjs-libraries/src/assistant/max.assistant.transport.ts`
- Create: `libraries/nestjs-libraries/src/assistant/max.assistant.transport.spec.ts`
- Create: `libraries/nestjs-libraries/src/assistant/max.assistant.poller.ts`
- Create: `libraries/nestjs-libraries/src/assistant/max.assistant.poller.spec.ts`

**Interfaces:**

```ts
// max.events.ts — pure
export const maxUpdateToEvent: (update: MaxUpdate) => AssistantEvent | null;
//   message_created (dialog, sender present): text = body.text; first image attachment → file {fileId: payload.url, kind:'image'};
//   any video/file/audio attachment → unsupported: true  (first cut)
//   message_callback → callback {chatId: message.recipient.chat_id, userId: callback.user.user_id, messageId: message.body.mid, callbackId: callback.callback_id, data: callback.payload}
//   bot_started → message { text: payload ? `/start ${payload}` : '/start' }
//   everything else → null

// max.assistant.transport.ts
export class MaxAssistantTransport implements AssistantTransport {
  constructor(api: Pick<Bot['api'], 'sendMessageToChat' | 'editMessage' | 'deleteMessage' | 'answerOnCallback'>, download: (url: string, maxBytes: number) => Promise<Buffer>);
  name = 'max'; maxFileBytes = 20 * 1024 * 1024;
  // sendMessage: api.sendMessageToChat(Number(chatId), text, { attachments: keyboard ? [toMaxKeyboard(keyboard)] : [] }) → message.body.mid
  // editMessage: api.editMessage(messageId, { text, attachments: keyboard ? [toMaxKeyboard(keyboard)] : [] })
  // deleteMessage: api.deleteMessage(messageId) (errors swallowed)
  // answerCallback: api.answerOnCallback(callbackId, text ? { notification: text } : {}) (errors swallowed)
  // downloadFile: download(fileId /* url */, maxFileBytes)
  getUpdates(marker: number | undefined, timeout: number): Promise<{ updates: MaxUpdate[]; marker?: number }>;   // api.getUpdates(['message_created','message_callback','bot_started'], { marker, timeout })
}
export const toMaxKeyboard: (keyboard: AssistantKeyboard) => { type: 'inline_keyboard'; payload: { buttons: Array<Array<{ type: 'callback'; text: string; payload: string }>> } };

// max.assistant.poller.ts — same shape as TelegramAssistantPoller with LOCK_KEY 'max-assistant:poller' and marker instead of offset
export class MaxAssistantPoller { constructor(transport: Pick<MaxAssistantTransport,'getUpdates'>, router: Pick<AssistantRouter,'handle'>, store: KeyValueStore, instanceId: string); runOnce(); start(); stop(); }
```

- [ ] **Step 1: Failing tests**

`max.events.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { maxUpdateToEvent } from './max.events';

const user = { user_id: 42, name: 'U', username: null };
const created = (body: any) => ({ update_type: 'message_created', timestamp: 1, message: { sender: user, recipient: { chat_id: 500, chat_type: 'dialog' }, timestamp: 1, body: { mid: 'm1', seq: 1, text: null, attachments: null, ...body } } });

describe('maxUpdateToEvent', () => {
  it('maps a text message in a dialog', () => {
    expect(maxUpdateToEvent(created({ text: ' hi ' }) as any)).toEqual({ kind: 'message', chatId: '500', userId: '42', text: 'hi' });
  });
  it('maps an image attachment to a file keyed by its url', () => {
    expect(maxUpdateToEvent(created({ attachments: [{ type: 'image', payload: { url: 'https://cdn/x.jpg', token: 't', photo_id: 1 } }] }) as any))
      .toEqual({ kind: 'message', chatId: '500', userId: '42', text: '', file: { fileId: 'https://cdn/x.jpg', kind: 'image' } });
  });
  it('refuses a video attachment with a clear message', () => {
    expect(maxUpdateToEvent(created({ attachments: [{ type: 'video', payload: { url: 'https://cdn/v', token: 't' } }] }) as any)).toMatchObject({ kind: 'message', unsupported: true });
  });
  it('maps a button press', () => {
    expect(maxUpdateToEvent({ update_type: 'message_callback', timestamp: 1, callback: { timestamp: 1, callback_id: 'cb', payload: 't:vk', user }, message: { sender: user, recipient: { chat_id: 500, chat_type: 'dialog' }, timestamp: 1, body: { mid: 'm9', seq: 2, text: '', attachments: null } } } as any))
      .toEqual({ kind: 'callback', chatId: '500', userId: '42', messageId: 'm9', callbackId: 'cb', data: 't:vk' });
  });
  it('turns bot_started with a payload into /start <code>', () => {
    expect(maxUpdateToEvent({ update_type: 'bot_started', timestamp: 1, chat_id: 500, user, payload: 'abc' } as any)).toEqual({ kind: 'message', chatId: '500', userId: '42', text: '/start abc' });
  });
  it('ignores other updates and non-dialog chats', () => {
    expect(maxUpdateToEvent({ update_type: 'message_removed', timestamp: 1, message_id: 'x', chat_id: 1, user_id: 1 } as any)).toBeNull();
    expect(maxUpdateToEvent({ ...created({ text: 'x' }), message: { ...created({ text: 'x' }).message, recipient: { chat_id: 1, chat_type: 'chat' } } } as any)).toBeNull();
  });
});
```

`max.assistant.transport.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { MaxAssistantTransport, toMaxKeyboard } from './max.assistant.transport';

const keyboard = { inline_keyboard: [[{ text: 'A', callback_data: 't:1' }], [{ text: '🚀', callback_data: 'p' }]] };

describe('MaxAssistantTransport', () => {
  it('maps the canonical keyboard to MAX callback buttons', () => {
    expect(toMaxKeyboard(keyboard)).toEqual({ type: 'inline_keyboard', payload: { buttons: [[{ type: 'callback', text: 'A', payload: 't:1' }], [{ type: 'callback', text: '🚀', payload: 'p' }]] } });
  });

  it('sends, edits, deletes and answers through the MAX API', async () => {
    const api = {
      sendMessageToChat: vi.fn(async () => ({ body: { mid: 'm1' } })),
      editMessage: vi.fn(async () => ({ success: true })),
      deleteMessage: vi.fn(async () => { throw new Error('gone'); }),
      answerOnCallback: vi.fn(async () => ({ success: true })),
    };
    const transport = new MaxAssistantTransport(api as any, vi.fn());
    await expect(transport.sendMessage('500', 'hi', keyboard)).resolves.toBe('m1');
    expect(api.sendMessageToChat).toHaveBeenCalledWith(500, 'hi', { attachments: [toMaxKeyboard(keyboard)] });
    await transport.editMessage('500', 'm1', 'edited');
    expect(api.editMessage).toHaveBeenCalledWith('m1', { text: 'edited', attachments: [] });
    await expect(transport.deleteMessage('500', 'm1')).resolves.toBeUndefined();
    await transport.answerCallback('cb', 'ok');
    expect(api.answerOnCallback).toHaveBeenCalledWith('cb', { notification: 'ok' });
  });

  it('downloads a file by url within the limit', async () => {
    const download = vi.fn(async () => Buffer.from('img'));
    const transport = new MaxAssistantTransport({} as any, download);
    await expect(transport.downloadFile('https://cdn/x.jpg')).resolves.toEqual(Buffer.from('img'));
    expect(download).toHaveBeenCalledWith('https://cdn/x.jpg', transport.maxFileBytes);
  });
});
```

`max.assistant.poller.spec.ts` (mirror of the Telegram poller spec; read it first and copy its structure), including:

```ts
  it('uses its own lock key', async () => {
    const store = new MemoryKeyValueStore();
    const poller = new MaxAssistantPoller({ getUpdates: vi.fn(async () => ({ updates: [], marker: 1 })) } as any, { handle: vi.fn() } as any, store, 'i-1');
    await poller.runOnce();
    expect(await store.get('max-assistant:poller')).toBe('i-1');
    expect(await store.get('tg-assistant:poller')).toBeFalsy();
  });
  it('advances the marker and routes events', ...)   // getUpdates returns one message_created update; handle called with the mapped event; next call passes marker
```

Run all three: FAIL, modules missing.

- [ ] **Step 2: Implement**

`max.events.ts`: as in Interfaces; type `MaxUpdate` as a local structural type (`{ update_type: string; [key: string]: any }`) to avoid coupling to the library's deep type paths.

`max.assistant.transport.ts`: as in Interfaces. For `download`, export a `downloadOverHttps` from `telegram.assistant.api.ts` (it is currently module-private; export it unchanged) and reuse it — MAX CDN URLs are plain HTTPS; `NODE_EXTRA_CA_CERTS` is already set in compose for MAX.

`max.assistant.poller.ts`: copy `telegram.assistant.poller.ts`, replace `offset` with `marker`, `LOCK_KEY = 'max-assistant:poller'`, log prefix `[max-assistant]`; `runOnce` maps each update with `maxUpdateToEvent` and calls `router.handle(event)` when non-null; `marker` becomes the response `marker` when present.

- [ ] **Step 3: Run, build, commit**

Run: `pnpm vitest run libraries/nestjs-libraries/src/assistant` → PASS. `pnpm run build:backend` → exit 0.

```bash
git add libraries/nestjs-libraries/src/assistant libraries/nestjs-libraries/src/telegram-assistant/telegram.assistant.api.ts
git commit -m "feat(assistant): MAX transport, event mapper and poller

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Worker wiring, env plumbing, frontend buttons

**Files:**
- Modify: `libraries/nestjs-libraries/src/telegram-assistant/telegram.assistant.module.ts` (start the MAX poller when `MAX_ASSISTANT_TOKEN` is set)
- Modify: `docker-compose.override.yaml`, `.env.example`, `deploy/production-config.spec.ts`
- Create: `docs/server-scripts/37-configure-max-assistant.sh` (copy of `27-configure-telegram-assistant.sh` for `MAX_ASSISTANT_TOKEN`; verification via `GET https://platform-api.max.ru/me` with header `Authorization: <token>`; skip verification when unreachable)
- Create: `apps/frontend/src/components/layout/max.assistant.button.tsx`
- Create: `apps/frontend/src/components/layout/max.assistant.button.spec.tsx`
- Modify: `apps/frontend/src/components/mobile/mobile.channels.screen.tsx` (render `MaxAssistantButton` next to the Telegram one)
- Modify: `apps/frontend/src/components/new-layout/layout.component.tsx` (render `MaxAssistantButton` after `TelegramAssistantButton`)

**Interfaces:**
- `MaxAssistantButton: FC` — same behaviour as `TelegramAssistantButton` but `POST /assistant/link/max`, label «Постить из MAX», MAX brand colour `#1B6CF2`. Renders `null` when `maxAssistantEnabled` from `useVariables()` is false (add `maxAssistantEnabled={!!process.env.MAX_ASSISTANT_TOKEN}` to both `VariableContextComponent` usages in `app/(app)/layout.tsx` and `app/(provider)/layout.tsx`, and the prop to `libraries/react-shared-libraries/src/helpers/variable.context.tsx`).

- [ ] **Step 1: Failing button test**

`max.assistant.button.spec.tsx` (jsdom): mock `useFetch` (resolves `{ ok: true, json: async () => ({ url: 'https://max.ru/b?start=c' }) }`), mock `window.open` to return `{ close: vi.fn(), location: { href: '' } }`, mock `useVariables` → `{ maxAssistantEnabled: true }`. Cases: renders the button and on click posts to `/assistant/link/max` and sets the tab location; renders nothing when `maxAssistantEnabled` is false.

- [ ] **Step 2: Implement**

Module wiring in `telegram.assistant.module.ts` `onApplicationBootstrap` (after the Telegram block, independent of it):

```ts
const maxToken = process.env.MAX_ASSISTANT_TOKEN;
if (maxToken) {
  const maxApi = new Bot(maxToken).api;
  const transport = new MaxAssistantTransport(maxApi, downloadOverHttps);
  const drafts = new DraftStore(redisKeyValueStore);
  const router = new AssistantRouter({
    transport,
    linkService: {
      consumeLinkCode: (code, t, id) => this._linkService.consumeLinkCode(code, id, t),
      findLink: (t, id) => this._linkService.findLink(id, t),
    },
    publisher: new TelegramAssistantPublisher({ api: { downloadFile: transport.downloadFile }, storeFile: (b) => storeTelegramFile(b, storage), mediaService: this._mediaService, quickPost }),
    drafts,
    draftKeyOf: (id) => `max:${id}`,
    appUrl,
    linkButtonLabel: 'Постить из MAX',
  });
  this.maxPoller = new MaxAssistantPoller(transport, router, redisKeyValueStore, randomBytes(8).toString('hex'));
  void this.maxPoller.start();
  console.log('[max-assistant] polling started');
}
```

(`quickPost` and `storage` are hoisted so both blocks share them; `onModuleDestroy` stops both pollers.)

Env: compose lines `MAX_ASSISTANT_TOKEN: '${MAX_ASSISTANT_TOKEN:-}'` and `MAX_ASSISTANT_BOT_NAME: 'vezdepost_assistant_bot'` (placeholder name; the owner sets the real bot username), `.env.example` lines, config spec assertions, configure script.

Frontend: button, variable context prop, two layout usages, channels screen and desktop top bar.

- [ ] **Step 3: Run, build both apps, commit**

Run: `pnpm vitest run apps/frontend/src/components/layout/max.assistant.button.spec.tsx apps/frontend/src/components/mobile deploy/production-config.spec.ts` → PASS.
Run: `pnpm run build:backend && pnpm run build:frontend` → exit 0.

```bash
git add libraries/nestjs-libraries/src/telegram-assistant/telegram.assistant.module.ts docker-compose.override.yaml .env.example deploy/production-config.spec.ts docs/server-scripts/37-configure-max-assistant.sh apps/frontend/src/components/layout/max.assistant.button.tsx apps/frontend/src/components/layout/max.assistant.button.spec.tsx apps/frontend/src/components/mobile/mobile.channels.screen.tsx apps/frontend/src/components/new-layout/layout.component.tsx libraries/react-shared-libraries/src/helpers/variable.context.tsx "apps/frontend/src/app/(app)/layout.tsx" "apps/frontend/src/app/(provider)/layout.tsx"
git commit -m "feat(assistant): run the MAX assistant poller and add link buttons

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Docs, spec rows, full suite

**Files:**
- Modify: `docs/PROJECT.md` (assistant section: two transports, env, pre-apply SQL, what MAX cannot do yet)
- Modify: `docs/superpowers/specs/2026-10-12-mobile-version-design.md` (rows 4, 5, 6)

- [ ] **Step 1: Document**

Append to `docs/PROJECT.md`:

```markdown
### Ассистент в мессенджерах (Telegram + MAX)

Общая логика в `libraries/nestjs-libraries/src/assistant/` (роутер, события,
транспорт); Telegram — адаптер в `telegram-assistant/`, MAX — `assistant/max.*`.
Привязки в таблице `TelegramAssistantLink` с колонкой `transport`
(`telegram` | `max`), уникальность по паре. Перед деплоем сборки с этой
колонкой прогнать `docs/server-scripts/36-preapply-assistant-transport.sql`
на копии прода. MAX-ассистент включается `MAX_ASSISTANT_TOKEN`
(`docs/server-scripts/37-configure-max-assistant.sh`) и именем
`MAX_ASSISTANT_BOT_NAME`; это отдельный бот от `MAX_TOKEN` (провайдер каналов
читает его `getUpdates`). Ссылка привязки: `POST /assistant/link/:transport`.
Ограничение первой версии: из MAX принимаются текст и фото; видео отклоняется
с подсказкой, пока не проверен URL скачивания видео на живом боте.
```

Spec rows: 4 → «Готово (коммит …)», 5 → «Снято статическим анализом типов @maxhub/max-bot-api: callback-кнопки и `bot_started.payload` есть; на живом боте проверить: диплинк `?start=` и URL видео», 6 → «Готово (коммит …), видео отложено».

- [ ] **Step 2: Full suite and commit**

Run: `pnpm vitest run` → exit 0.

```bash
git add docs/PROJECT.md docs/superpowers/specs/2026-10-12-mobile-version-design.md
git commit -m "docs: assistant transports and MAX assistant

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
