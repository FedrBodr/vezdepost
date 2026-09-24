Project: vezdepost
Document: implementation-plan

# Telegram Business Stories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `telegram-stories` channel that publishes a post's photos and videos as a series of personal Telegram Stories through the Business Bot API, usable from the editor and MCP.

**Architecture:** A new provider in `libraries/nestjs-libraries/src/integrations/social/` built from small units: a Redis-backed central Telegram update intake (also used by the existing Telegram connector), a Business Bot API client with multipart upload, media preparation (sharp / ffmpeg), and an idempotent per-frame series publisher. Connection goes through a web3-style wizard; a per-organization env flag gates rollout.

**Tech Stack:** NestJS, Temporal activities, ioredis, node `https`, sharp, ffmpeg/ffprobe (Debian package), class-validator + class-validator-jsonschema, React (Vite) + SWR, vitest.

**Spec:** `docs/superpowers/specs/2026-09-25-telegram-business-stories-design.md`

## Global Constraints

- Provider identifier: `telegram-stories`; display name: `Telegram Stories`.
- Reuse the bot token `TELEGRAM_TOKEN`; never store it in integrations.
- Integration `internalId` = Telegram user ID; `token` = `business_connection_id`.
- `allowed_updates` union: `message`, `channel_post`, `business_connection`.
- Update index TTL and verified-connection TTL: 15 minutes.
- Frame progress TTL: 30 days.
- Lifetime values (seconds): `21600`, `43200`, `86400` (default), `172800`.
- 1–10 media per post; photo 1080×1920 JPEG ≤ 10 MB; video 720×1280 H.265 MPEG-4, key frame every second, ≤ 60 s, ≤ 30 MB.
- Caption ≤ 2048 visible characters, Telegram caption dialect, headings degrade to bold.
- Rollout flag: `TELEGRAM_STORIES_ORG_IDS` (comma-separated org IDs); empty = hidden for everyone.
- pnpm only; run tests from the repo root with `pnpm exec vitest run <path>`; lint only from the root.
- Frontend: no new npm UI components; SWR hooks one per hook, no eslint-disable; no `--color-custom*`.
- Existing Telegram group/channel connection must keep working (production has users).

## Review Focus

1. **The user connected the bot before starting the wizard** — no new `business_connection` event; expect a clear hint to toggle "Manage stories", never a false `ready`. (Task 5 `waiting_business` test, Task 11 hint test.)
2. **A `postStory` call times out after Telegram accepted it** — retry must not re-send that frame; expect an error asking to check stories. (Task 7 test.)
3. **Media edited between a failed attempt and the retry** — progress for the old file must not mark the new file as done. (Task 7 test: key includes media path hash.)
4. **Two wizards polling at once (Telegram channel + Stories)** — neither loses the other's update. (Task 2 test.)
5. **An organization outside the flag calls the connect endpoints directly** — expect 403, not a created integration. (Task 10 tests.)

---

## File Structure

Backend (`libraries/nestjs-libraries/src/integrations/social/`):

- `telegram.kv.store.ts` — `KeyValueStore` type, in-memory store, Redis adapter.
- `telegram.updates.hub.ts` — central `getUpdates` intake; `parseTelegramConnectionMessage` moves here.
- `telegram.rich.api.ts` — add `TelegramApiError`, multipart body builder, `callTelegramApiMultipart`.
- `telegram.business.api.ts` — `getBusinessConnection`, `postStory`.
- `telegram.stories.connection.ts` — connection status resolution and verified record.
- `telegram.stories.media.ts` — photo/video preparation, ffprobe, process runner.
- `telegram.stories.publisher.ts` — idempotent series publisher.
- `telegram.stories.provider.ts` — the provider.
- `telegram.provider.ts` — switch `getBotId` to the hub.

Shared helpers (`libraries/helpers/src/utils/`):

- `telegram.stories.constants.ts` — limits, lifetimes, frame types, caption resolution, rollout flag.
- `platform.capability.profiles.ts` — `telegram-stories` profile.

DTO: `libraries/nestjs-libraries/src/dtos/posts/providers-settings/telegram.stories.dto.ts` + registration in `all.providers.settings.ts`.

Backend app: `apps/backend/src/api/routes/integrations.controller.ts`, `apps/backend/src/api/routes/no.auth.integrations.controller.ts`.

Frontend:

- `apps/frontend/src/components/launches/web3/providers/telegram.stories.connection.ts` + `telegram.stories.provider.tsx`, registered in `web3.list.tsx`.
- `apps/frontend/src/components/launches/use.telegram.stories.availability.ts` + filter in `add.provider.component.tsx`.
- `apps/frontend/src/components/new-launch/providers/telegram-stories/telegram.stories.provider.tsx`, registered in `show.all.providers.tsx`.
- Translations: `libraries/react-shared-libraries/src/translation/locales/{en,ru}/translation.json`.

Ops: `Dockerfile.dev` (ffmpeg), `.env.example`.

---

### Task 1: Key-value store and Bot API multipart transport

**Files:**
- Create: `libraries/nestjs-libraries/src/integrations/social/telegram.kv.store.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/telegram.rich.api.ts`
- Create: `libraries/nestjs-libraries/src/integrations/social/telegram.business.api.ts`
- Test: `libraries/nestjs-libraries/src/integrations/social/telegram.business.api.spec.ts`

**Interfaces:**
- Produces:
  - `type KeyValueStore = { get(key: string): Promise<string | null | undefined>; set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>; del(key: string): Promise<unknown> }`
  - `class MemoryKeyValueStore implements KeyValueStore` (honours `NX`)
  - `const redisKeyValueStore: KeyValueStore`
  - `class TelegramApiError extends Error { method: string; errorCode?: number }`
  - `buildTelegramMultipartBody(fields: Record<string, string>, file: TelegramUploadFile, boundary: string): Buffer`
  - `callTelegramApiMultipart<T>(token: string, method: string, fields: Record<string, string>, file: TelegramUploadFile): Promise<T>`
  - `type TelegramUploadFile = { field: string; filename: string; contentType: string; data: Buffer }`
  - `type TelegramBusinessConnection = { id: string; user: { id: number; first_name?: string; last_name?: string; username?: string }; is_enabled: boolean; rights?: { can_manage_stories?: boolean } }`
  - `class TelegramBusinessApi { constructor(token?: string); getBusinessConnection(id: string): Promise<TelegramBusinessConnection>; postStory(params: PostStoryParams): Promise<{ id: number }> }`
  - `type PostStoryParams = { businessConnectionId: string; kind: 'photo' | 'video'; file: Buffer; durationSeconds?: number; activePeriod: number; caption?: string }`

- [ ] **Step 1: Write the failing tests**

```ts
// telegram.business.api.spec.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const callMock = vi.hoisted(() => vi.fn());
const multipartMock = vi.hoisted(() => vi.fn());
vi.mock('./telegram.rich.api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./telegram.rich.api')>()),
  callTelegramApi: callMock,
  callTelegramApiMultipart: multipartMock,
}));

import { buildTelegramMultipartBody } from './telegram.rich.api';
import { TelegramBusinessApi } from './telegram.business.api';
import { MemoryKeyValueStore } from './telegram.kv.store';

describe('buildTelegramMultipartBody', () => {
  it('encodes fields and the file part', () => {
    const body = buildTelegramMultipartBody(
      { business_connection_id: 'bc-1' },
      { field: 'story', filename: 'story.jpg', contentType: 'image/jpeg', data: Buffer.from('JPEG') },
      'BOUNDARY'
    ).toString('utf8');

    expect(body).toContain('--BOUNDARY\r\nContent-Disposition: form-data; name="business_connection_id"\r\n\r\nbc-1\r\n');
    expect(body).toContain('Content-Disposition: form-data; name="story"; filename="story.jpg"\r\nContent-Type: image/jpeg\r\n\r\nJPEG\r\n');
    expect(body.endsWith('--BOUNDARY--\r\n')).toBe(true);
  });
});

describe('TelegramBusinessApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads a business connection', async () => {
    callMock.mockResolvedValue({ id: 'bc-1', is_enabled: true, user: { id: 7 } });
    await expect(new TelegramBusinessApi('T').getBusinessConnection('bc-1')).resolves.toMatchObject({ id: 'bc-1' });
    expect(callMock).toHaveBeenCalledWith('T', 'getBusinessConnection', { business_connection_id: 'bc-1' });
  });

  it('posts a video story with an attached upload', async () => {
    multipartMock.mockResolvedValue({ id: 99, chat: { id: 7 } });
    await new TelegramBusinessApi('T').postStory({
      businessConnectionId: 'bc-1', kind: 'video', file: Buffer.from('MP4'),
      durationSeconds: 12.5, activePeriod: 86400, caption: '<b>Hi</b>',
    });
    const [, method, fields, file] = multipartMock.mock.calls[0];
    expect(method).toBe('postStory');
    expect(JSON.parse(fields.content)).toEqual({ type: 'video', video: 'attach://story', duration: 12.5, is_animation: false });
    expect(fields).toMatchObject({ business_connection_id: 'bc-1', active_period: '86400', caption: '<b>Hi</b>', parse_mode: 'HTML' });
    expect(file).toMatchObject({ field: 'story', filename: 'story.mp4', contentType: 'video/mp4' });
  });

  it('omits empty captions', async () => {
    multipartMock.mockResolvedValue({ id: 1 });
    await new TelegramBusinessApi('T').postStory({ businessConnectionId: 'bc', kind: 'photo', file: Buffer.from('x'), activePeriod: 21600, caption: '' });
    const [, , fields] = multipartMock.mock.calls[0];
    expect(fields.caption).toBeUndefined();
    expect(fields.parse_mode).toBeUndefined();
    expect(JSON.parse(fields.content)).toEqual({ type: 'photo', photo: 'attach://story' });
  });
});

describe('MemoryKeyValueStore', () => {
  it('honours NX', async () => {
    const store = new MemoryKeyValueStore();
    expect(await store.set('k', '1', 'PX', 1000, 'NX')).toBe('OK');
    expect(await store.set('k', '2', 'PX', 1000, 'NX')).toBeNull();
    expect(await store.get('k')).toBe('1');
    await store.del('k');
    expect(await store.get('k')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/telegram.business.api.spec.ts`
Expected: FAIL — modules `./telegram.business.api`, `./telegram.kv.store` not found.

- [ ] **Step 3: Implement**

`telegram.kv.store.ts`:

```ts
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

export type KeyValueStore = {
  get(key: string): Promise<string | null | undefined>;
  set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

/** Test/dev store; honours NX, ignores expiry. */
export class MemoryKeyValueStore implements KeyValueStore {
  private readonly data = new Map<string, string>();

  async get(key: string) {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }

  async set(key: string, value: string, ...args: Array<string | number>) {
    if (args.includes('NX') && this.data.has(key)) {
      return null;
    }
    this.data.set(key, value);
    return 'OK';
  }

  async del(key: string) {
    return this.data.delete(key) ? 1 : 0;
  }
}

export const redisKeyValueStore = ioRedis as unknown as KeyValueStore;
```

In `telegram.rich.api.ts` add (keep `callTelegramApi` as is, but make both reject with `TelegramApiError` for API-level failures — replace the two `new Error(parsed?.description …)` rejections):

```ts
export class TelegramApiError extends Error {
  constructor(
    message: string,
    public readonly method: string,
    public readonly errorCode?: number
  ) {
    super(message);
    this.name = 'TelegramApiError';
  }
}

export type TelegramUploadFile = {
  field: string;
  filename: string;
  contentType: string;
  data: Buffer;
};

export const buildTelegramMultipartBody = (
  fields: Record<string, string>,
  file: TelegramUploadFile,
  boundary: string
): Buffer => {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        'utf8'
      )
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      'utf8'
    ),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  );
  return Buffer.concat(parts);
};
```

Refactor the response handling of `callTelegramApi` into a shared `sendTelegramRequest<T>(token, method, body: Buffer, contentType: string, timeoutMs: number)` and implement:

```ts
export const callTelegramApi = <T = unknown>(
  token: string,
  method: string,
  payload: unknown
): Promise<T> =>
  sendTelegramRequest<T>(
    token,
    method,
    Buffer.from(JSON.stringify(payload), 'utf8'),
    'application/json',
    60_000
  );

export const callTelegramApiMultipart = <T = unknown>(
  token: string,
  method: string,
  fields: Record<string, string>,
  file: TelegramUploadFile
): Promise<T> => {
  const boundary = `----vezdepost${randomBytes(12).toString('hex')}`;
  return sendTelegramRequest<T>(
    token,
    method,
    buildTelegramMultipartBody(fields, file, boundary),
    `multipart/form-data; boundary=${boundary}`,
    300_000
  );
};
```

`sendTelegramRequest` is the existing promise body with `body` as a Buffer (`Content-Length: body.length`) and API failures rejected as `new TelegramApiError(parsed?.description || …, method, parsed?.error_code ?? response.statusCode)`. Import `randomBytes` from `crypto`.

`telegram.business.api.ts`:

```ts
import {
  callTelegramApi,
  callTelegramApiMultipart,
} from '@gitroom/nestjs-libraries/integrations/social/telegram.rich.api';

export type TelegramBusinessConnection = {
  id: string;
  user: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  is_enabled: boolean;
  rights?: { can_manage_stories?: boolean };
};

export type PostStoryParams = {
  businessConnectionId: string;
  kind: 'photo' | 'video';
  file: Buffer;
  durationSeconds?: number;
  activePeriod: number;
  caption?: string;
};

export class TelegramBusinessApi {
  constructor(private readonly token = process.env.TELEGRAM_TOKEN || '') {}

  getBusinessConnection(id: string) {
    return callTelegramApi<TelegramBusinessConnection>(
      this.token,
      'getBusinessConnection',
      { business_connection_id: id }
    );
  }

  postStory(params: PostStoryParams) {
    const content =
      params.kind === 'photo'
        ? { type: 'photo', photo: 'attach://story' }
        : {
            type: 'video',
            video: 'attach://story',
            duration: params.durationSeconds,
            is_animation: false,
          };
    return callTelegramApiMultipart<{ id: number }>(
      this.token,
      'postStory',
      {
        business_connection_id: params.businessConnectionId,
        content: JSON.stringify(content),
        active_period: String(params.activePeriod),
        ...(params.caption
          ? { caption: params.caption, parse_mode: 'HTML' }
          : {}),
      },
      {
        field: 'story',
        filename: params.kind === 'photo' ? 'story.jpg' : 'story.mp4',
        contentType: params.kind === 'photo' ? 'image/jpeg' : 'video/mp4',
        data: params.file,
      }
    );
  }
}
```

- [ ] **Step 4: Run tests — new spec and the existing Telegram provider spec**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/telegram.business.api.spec.ts libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/social/telegram.kv.store.ts libraries/nestjs-libraries/src/integrations/social/telegram.rich.api.ts libraries/nestjs-libraries/src/integrations/social/telegram.business.api.ts libraries/nestjs-libraries/src/integrations/social/telegram.business.api.spec.ts
git commit -m "feat: add Telegram Business Bot API client with multipart upload"
```

---

### Task 2: Central Telegram update intake

**Files:**
- Create: `libraries/nestjs-libraries/src/integrations/social/telegram.updates.hub.ts`
- Test: `libraries/nestjs-libraries/src/integrations/social/telegram.updates.hub.spec.ts`

**Interfaces:**
- Consumes: `KeyValueStore`, `MemoryKeyValueStore`, `TelegramBusinessConnection` (Task 1).
- Produces:
  - `TELEGRAM_ALLOWED_UPDATES = ['message', 'channel_post', 'business_connection']`
  - `parseTelegramConnectionMessage(text?: string): { kind: 'start' | 'connect'; nonce: string } | null` (moved verbatim from `telegram.provider.ts`)
  - `type TelegramConnectionCommand = { chatId: number; chatType?: string; fromId?: number }`
  - `class TelegramUpdatesHub { constructor(bot: Pick<TelegramBot, 'getUpdates'>, store: KeyValueStore); poll(): Promise<void>; findConnectionCommand(nonce: string): Promise<TelegramConnectionCommand | null>; findBusinessConnection(userId: number): Promise<TelegramBusinessConnection | null> }`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { MemoryKeyValueStore } from './telegram.kv.store';
import {
  TELEGRAM_ALLOWED_UPDATES,
  TelegramUpdatesHub,
} from './telegram.updates.hub';

const bot = (batches: any[][]) => {
  const getUpdates = vi.fn();
  batches.forEach((b) => getUpdates.mockResolvedValueOnce(b));
  getUpdates.mockResolvedValue([]);
  return { getUpdates };
};

describe('TelegramUpdatesHub', () => {
  it('requests every update type and stores the next offset', async () => {
    const store = new MemoryKeyValueStore();
    const client = bot([[{ update_id: 10 }, { update_id: 11 }], []]);
    const hub = new TelegramUpdatesHub(client as any, store);

    await hub.poll();
    await hub.poll();

    expect(client.getUpdates.mock.calls[0][0]).toEqual({
      timeout: 0,
      allowed_updates: TELEGRAM_ALLOWED_UPDATES,
    });
    expect(client.getUpdates.mock.calls[1][0]).toMatchObject({ offset: 12 });
  });

  it('indexes connection commands by nonce and business connections by user', async () => {
    const store = new MemoryKeyValueStore();
    const hub = new TelegramUpdatesHub(
      bot([[
        { update_id: 1, message: { text: '/start abc', chat: { id: 7, type: 'private' }, from: { id: 7 } } },
        { update_id: 2, channel_post: { text: '/connect chan', chat: { id: -100, type: 'channel' } } },
        { update_id: 3, business_connection: { id: 'bc-1', user: { id: 7 }, is_enabled: true, rights: { can_manage_stories: true } } },
      ]]) as any,
      store
    );

    await hub.poll();

    await expect(hub.findConnectionCommand('abc')).resolves.toEqual({ chatId: 7, chatType: 'private', fromId: 7 });
    await expect(hub.findConnectionCommand('chan')).resolves.toEqual({ chatId: -100, chatType: 'channel' });
    await expect(hub.findConnectionCommand('ab')).resolves.toBeNull();
    await expect(hub.findBusinessConnection(7)).resolves.toMatchObject({ id: 'bc-1' });
  });

  it('keeps updates for a second reader when two readers poll', async () => {
    const store = new MemoryKeyValueStore();
    const client = bot([[
      { update_id: 1, message: { text: '/start first', chat: { id: 1, type: 'private' }, from: { id: 1 } } },
      { update_id: 2, message: { text: '/start second', chat: { id: 2, type: 'private' }, from: { id: 2 } } },
    ]]);
    const hub = new TelegramUpdatesHub(client as any, store);

    await hub.poll(); // reader A
    await hub.poll(); // reader B, Telegram already confirmed both updates

    await expect(hub.findConnectionCommand('first')).resolves.not.toBeNull();
    await expect(hub.findConnectionCommand('second')).resolves.not.toBeNull();
  });

  it('skips polling while another reader holds the lock', async () => {
    const store = new MemoryKeyValueStore();
    await store.set('telegram:updates:lock', 'other', 'PX', 10_000, 'NX');
    const client = bot([]);
    await new TelegramUpdatesHub(client as any, store).poll();
    expect(client.getUpdates).not.toHaveBeenCalled();
  });

  it('releases the lock when Telegram fails', async () => {
    const store = new MemoryKeyValueStore();
    const client = { getUpdates: vi.fn().mockRejectedValue(new Error('down')) };
    const hub = new TelegramUpdatesHub(client as any, store);
    await expect(hub.poll()).rejects.toThrow('down');
    await expect(store.get('telegram:updates:lock')).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/telegram.updates.hub.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `telegram.updates.hub.ts`**

```ts
import type TelegramBot from 'node-telegram-bot-api';
import type { KeyValueStore } from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import type { TelegramBusinessConnection } from '@gitroom/nestjs-libraries/integrations/social/telegram.business.api';

export const TELEGRAM_ALLOWED_UPDATES = [
  'message',
  'channel_post',
  'business_connection',
];

const LOCK_KEY = 'telegram:updates:lock';
const OFFSET_KEY = 'telegram:updates:offset';
const LOCK_TTL_MS = 10_000;
const INDEX_TTL_MS = 15 * 60 * 1_000;

export type TelegramConnectionCommand = {
  chatId: number;
  chatType?: string;
  fromId?: number;
};

export const parseTelegramConnectionMessage = (text?: string) => {
  // moved verbatim from telegram.provider.ts
};

export class TelegramUpdatesHub {
  constructor(
    private readonly bot: Pick<TelegramBot, 'getUpdates'>,
    private readonly store: KeyValueStore
  ) {}

  async poll(): Promise<void> {
    const locked = await this.store.set(LOCK_KEY, '1', 'PX', LOCK_TTL_MS, 'NX');
    if (locked !== 'OK') {
      return;
    }
    try {
      const offset = await this.store.get(OFFSET_KEY);
      const updates = await this.bot.getUpdates({
        ...(offset ? { offset: Number(offset) } : {}),
        timeout: 0,
        allowed_updates: TELEGRAM_ALLOWED_UPDATES as any,
      });
      for (const update of updates) {
        await this.index(update as any);
      }
      if (updates.length) {
        await this.store.set(
          OFFSET_KEY,
          String(updates[updates.length - 1].update_id + 1)
        );
      }
    } finally {
      await this.store.del(LOCK_KEY);
    }
  }

  async findConnectionCommand(
    nonce: string
  ): Promise<TelegramConnectionCommand | null> {
    const raw = await this.store.get(`telegram:updates:nonce:${nonce}`);
    return raw ? JSON.parse(raw) : null;
  }

  async findBusinessConnection(
    userId: number
  ): Promise<TelegramBusinessConnection | null> {
    const raw = await this.store.get(`telegram:updates:business:${userId}`);
    return raw ? JSON.parse(raw) : null;
  }

  private async index(update: {
    message?: TelegramBot.Message;
    channel_post?: TelegramBot.Message;
    business_connection?: TelegramBusinessConnection;
  }) {
    const message = update.message || update.channel_post;
    const command = parseTelegramConnectionMessage(message?.text);
    if (command && message?.chat?.id !== undefined) {
      const value: TelegramConnectionCommand = {
        chatId: message.chat.id,
        chatType: message.chat.type,
        ...(message.from?.id !== undefined ? { fromId: message.from.id } : {}),
      };
      await this.store.set(
        `telegram:updates:nonce:${command.nonce}`,
        JSON.stringify(value),
        'PX',
        INDEX_TTL_MS
      );
    }
    if (update.business_connection?.user?.id !== undefined) {
      await this.store.set(
        `telegram:updates:business:${update.business_connection.user.id}`,
        JSON.stringify(update.business_connection),
        'PX',
        INDEX_TTL_MS
      );
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/telegram.updates.hub.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/social/telegram.updates.hub.ts libraries/nestjs-libraries/src/integrations/social/telegram.updates.hub.spec.ts
git commit -m "feat: centralize Telegram update intake in Redis"
```

---

### Task 3: Existing Telegram connector reads through the hub

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social/telegram.provider.ts:57-73,91-94,171-206`
- Modify: `libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts:496-686`

**Interfaces:**
- Consumes: `TelegramUpdatesHub`, `parseTelegramConnectionMessage` (Task 2), `MemoryKeyValueStore`, `redisKeyValueStore` (Task 1).
- Produces: `new TelegramProvider(botClient?, updatesHub?)`; `getBotId` no longer returns `lastChatId`; `parseTelegramConnectionMessage` stays importable from `telegram.provider` (re-export).

- [ ] **Step 1: Update tests first** — in the `Telegram connection discovery` block:
  - Add at the top of the block:

```ts
import { MemoryKeyValueStore } from './telegram.kv.store';
import { TelegramUpdatesHub } from './telegram.updates.hub';

const providerFor = (bot: any) =>
  new TelegramProvider(bot, new TelegramUpdatesHub(bot, new MemoryKeyValueStore()));
```

  - Replace every `new TelegramProvider(bot as any)` in this block with `providerFor(bot)`.
  - Update the message fixtures to include `type`: `chat: { id: -1001, type: 'supergroup' }` (channel test: `type: 'channel'`).
  - Replace test `returns the next update offset while waiting` with:

```ts
it('waits without leaking update offsets to the client', async () => {
  const bot = makeConnectionBot({ updates: [{ update_id: 77 }] });
  await expect(providerFor(bot).getBotId({ word: 'nonce_123' })).resolves.toEqual({ status: 'waiting' });
  expect(bot.getUpdates).toHaveBeenCalledWith({
    timeout: 0,
    allowed_updates: ['message', 'channel_post', 'business_connection'],
  });
});
```

  - In `does not accept a near nonce match`, expect `{ status: 'waiting' }`.
  - Add:

```ts
it('ignores a client offset and still finds the command', async () => {
  const bot = makeConnectionBot({
    updates: [{ update_id: 77, message: { text: '/connect nonce_123', chat: { id: -1001, type: 'supergroup' } } }],
  });
  await expect(providerFor(bot).getBotId({ word: 'nonce_123', id: 5000 })).resolves.toEqual({ status: 'ready', chatId: -1001 });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts`
Expected: FAIL — `lastChatId` still returned, `allowed_updates` differs.

- [ ] **Step 3: Implement**

In `telegram.provider.ts`:
- Delete the local `parseTelegramConnectionMessage` and add
  `export { parseTelegramConnectionMessage } from '@gitroom/nestjs-libraries/integrations/social/telegram.updates.hub';`
- Import `TelegramUpdatesHub` and `redisKeyValueStore`.
- Constructor:

```ts
constructor(
  private readonly botClient: TelegramBotClient = telegramBot,
  private readonly updatesHub = new TelegramUpdatesHub(
    botClient,
    redisKeyValueStore
  )
) {
  super();
}
```

- `getBotId` body inside `try`:

```ts
if (query.chatId !== undefined) {
  return await this.verifyConnection(query.chatId);
}
await this.updatesHub.poll();
const command = await this.updatesHub.findConnectionCommand(query.word);
if (command) {
  return await this.verifyConnection(command.chatId);
}
return { status: 'waiting' };
```

Keep the `query.id` field in the signature (the controller and frontend still send it) and document it as ignored.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts apps/frontend/src/components/launches/web3/providers/telegram.provider.spec.tsx`
Expected: PASS (the frontend wizard only stores `lastChatId` when present).

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/social/telegram.provider.ts libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts
git commit -m "fix: read Telegram connection commands through the update hub"
```

---

### Task 4: Shared stories constants, frame captions and rollout flag

**Files:**
- Create: `libraries/helpers/src/utils/telegram.stories.constants.ts`
- Test: `libraries/helpers/src/utils/telegram.stories.constants.spec.ts`

**Interfaces:**
- Produces:
  - `TELEGRAM_STORIES_IDENTIFIER = 'telegram-stories'`
  - `TELEGRAM_STORY_ACTIVE_PERIODS = ['21600', '43200', '86400', '172800'] as const`, `TELEGRAM_STORY_DEFAULT_ACTIVE_PERIOD = '86400'`
  - `TELEGRAM_STORY_MAX_FRAMES = 10`, `TELEGRAM_STORY_CAPTION_MAX = 2048`, `TELEGRAM_STORY_VIDEO_MAX_SECONDS = 60`
  - `type TelegramStoryFrameText = 'post' | 'none' | 'custom'`
  - `type TelegramStoryFrameSetting = { mediaId?: string; text: TelegramStoryFrameText; caption?: string }`
  - `resolveStoryFrameCaptions(postText: string, media: Array<{ id?: string }>, frames?: TelegramStoryFrameSetting[]): string[]`
  - `isTelegramStoriesEnabledForOrg(rawValue: string | undefined, orgId: string): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  isTelegramStoriesEnabledForOrg,
  resolveStoryFrameCaptions,
} from './telegram.stories.constants';

const media = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('resolveStoryFrameCaptions', () => {
  it('puts the post text on the first frame by default', () => {
    expect(resolveStoryFrameCaptions('Hi', media)).toEqual(['Hi', '', '']);
  });

  it('matches frames by media id regardless of order', () => {
    expect(
      resolveStoryFrameCaptions('Hi', media, [
        { mediaId: 'c', text: 'custom', caption: 'Third' },
        { mediaId: 'a', text: 'none' },
      ])
    ).toEqual(['', '', 'Third']);
  });

  it('matches id-less frames by position (MCP form)', () => {
    expect(
      resolveStoryFrameCaptions('Hi', media, [
        { text: 'none' },
        { text: 'post' },
        { text: 'custom', caption: 'Last' },
      ])
    ).toEqual(['', 'Hi', 'Last']);
  });

  it('does not apply a frame bound to another media by position', () => {
    expect(
      resolveStoryFrameCaptions('Hi', [{ id: 'x' }], [{ mediaId: 'gone', text: 'none' }])
    ).toEqual(['Hi']);
  });
});

describe('isTelegramStoriesEnabledForOrg', () => {
  it.each([
    [undefined, 'org-1', false],
    ['  ', 'org-1', false],
    ['org-1, org-2', 'org-2', true],
    ['org-1', 'org-3', false],
  ])('%s / %s -> %s', (raw, org, expected) => {
    expect(isTelegramStoriesEnabledForOrg(raw as any, org)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run libraries/helpers/src/utils/telegram.stories.constants.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export const TELEGRAM_STORIES_IDENTIFIER = 'telegram-stories';
export const TELEGRAM_STORY_ACTIVE_PERIODS = [
  '21600',
  '43200',
  '86400',
  '172800',
] as const;
export const TELEGRAM_STORY_DEFAULT_ACTIVE_PERIOD = '86400';
export const TELEGRAM_STORY_MAX_FRAMES = 10;
export const TELEGRAM_STORY_CAPTION_MAX = 2048;
export const TELEGRAM_STORY_VIDEO_MAX_SECONDS = 60;

export type TelegramStoryFrameText = 'post' | 'none' | 'custom';
export type TelegramStoryFrameSetting = {
  mediaId?: string;
  text: TelegramStoryFrameText;
  caption?: string;
};

export const resolveStoryFrameCaptions = (
  postText: string,
  media: Array<{ id?: string }>,
  frames: TelegramStoryFrameSetting[] = []
): string[] =>
  media.map((item, index) => {
    const byId = item.id
      ? frames.find((frame) => frame.mediaId === item.id)
      : undefined;
    const positional = frames[index];
    const frame =
      byId ?? (positional && !positional.mediaId ? positional : undefined);
    const text = frame?.text ?? (index === 0 ? 'post' : 'none');
    if (text === 'post') {
      return postText;
    }
    return text === 'custom' ? frame?.caption ?? '' : '';
  });

export const isTelegramStoriesEnabledForOrg = (
  rawValue: string | undefined,
  orgId: string
) =>
  (rawValue || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(orgId);
```

- [ ] **Step 4: Run tests** — same command, expected PASS.

- [ ] **Step 5: Commit**

```bash
git add libraries/helpers/src/utils/telegram.stories.constants.ts libraries/helpers/src/utils/telegram.stories.constants.spec.ts
git commit -m "feat: add Telegram stories frame captions and rollout flag"
```

---

### Task 5: Stories connection resolution

**Files:**
- Create: `libraries/nestjs-libraries/src/integrations/social/telegram.stories.connection.ts`
- Test: `libraries/nestjs-libraries/src/integrations/social/telegram.stories.connection.spec.ts`

**Interfaces:**
- Consumes: `TelegramUpdatesHub` (Task 2), `KeyValueStore`, `MemoryKeyValueStore` (Task 1), `TelegramBusinessConnection` (Task 1).
- Produces:
  - `type TelegramStoriesConnectionStatus = 'waiting_start' | 'waiting_business' | 'missing_stories_right' | 'connection_disabled' | 'ready' | 'telegram_error'`
  - `evaluateBusinessConnection(connection: TelegramBusinessConnection): Exclude<TelegramStoriesConnectionStatus, 'waiting_start' | 'waiting_business' | 'telegram_error'>`
  - `type VerifiedStoriesConnection = { telegramUserId: number; businessConnectionId: string }`
  - `resolveStoriesConnection(hub: Pick<TelegramUpdatesHub, 'poll' | 'findConnectionCommand' | 'findBusinessConnection'>, store: KeyValueStore, nonce: string): Promise<{ status: TelegramStoriesConnectionStatus }>`
  - `takeVerifiedStoriesConnection(store: KeyValueStore, nonce: string): Promise<VerifiedStoriesConnection | null>` (reads and deletes)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { MemoryKeyValueStore } from './telegram.kv.store';
import {
  resolveStoriesConnection,
  takeVerifiedStoriesConnection,
} from './telegram.stories.connection';

const hubWith = (command: any, connection: any) => ({
  poll: vi.fn().mockResolvedValue(undefined),
  findConnectionCommand: vi.fn().mockResolvedValue(command),
  findBusinessConnection: vi.fn().mockResolvedValue(connection),
});
const privateStart = { chatId: 7, chatType: 'private', fromId: 7 };
const connection = (patch: any = {}) => ({
  id: 'bc-1', user: { id: 7 }, is_enabled: true, rights: { can_manage_stories: true }, ...patch,
});

describe('resolveStoriesConnection', () => {
  it('waits for /start', async () => {
    await expect(resolveStoriesConnection(hubWith(null, null), new MemoryKeyValueStore(), 'n')).resolves.toEqual({ status: 'waiting_start' });
  });

  it('ignores /start sent from a group', async () => {
    const hub = hubWith({ chatId: -5, chatType: 'supergroup', fromId: 7 }, connection());
    await expect(resolveStoriesConnection(hub, new MemoryKeyValueStore(), 'n')).resolves.toEqual({ status: 'waiting_start' });
  });

  it('waits for the business connection of the same user', async () => {
    const hub = hubWith(privateStart, null);
    await expect(resolveStoriesConnection(hub, new MemoryKeyValueStore(), 'n')).resolves.toEqual({ status: 'waiting_business' });
    expect(hub.findBusinessConnection).toHaveBeenCalledWith(7);
  });

  it.each([
    [{ is_enabled: false }, 'connection_disabled'],
    [{ rights: { can_manage_stories: false } }, 'missing_stories_right'],
    [{ rights: undefined }, 'missing_stories_right'],
  ])('reports %j as %s', async (patch, status) => {
    await expect(resolveStoriesConnection(hubWith(privateStart, connection(patch)), new MemoryKeyValueStore(), 'n')).resolves.toEqual({ status });
  });

  it('stores a verified record once ready and hands it out once', async () => {
    const store = new MemoryKeyValueStore();
    await expect(resolveStoriesConnection(hubWith(privateStart, connection()), store, 'n')).resolves.toEqual({ status: 'ready' });
    await expect(takeVerifiedStoriesConnection(store, 'n')).resolves.toEqual({ telegramUserId: 7, businessConnectionId: 'bc-1' });
    await expect(takeVerifiedStoriesConnection(store, 'n')).resolves.toBeNull();
  });

  it('reports telegram_error when polling fails', async () => {
    const hub = hubWith(null, null);
    hub.poll.mockRejectedValue(new Error('down'));
    await expect(resolveStoriesConnection(hub, new MemoryKeyValueStore(), 'n')).resolves.toEqual({ status: 'telegram_error' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/telegram.stories.connection.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { KeyValueStore } from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import type { TelegramBusinessConnection } from '@gitroom/nestjs-libraries/integrations/social/telegram.business.api';
import type { TelegramUpdatesHub } from '@gitroom/nestjs-libraries/integrations/social/telegram.updates.hub';

export type TelegramStoriesConnectionStatus =
  | 'waiting_start'
  | 'waiting_business'
  | 'missing_stories_right'
  | 'connection_disabled'
  | 'ready'
  | 'telegram_error';

export type VerifiedStoriesConnection = {
  telegramUserId: number;
  businessConnectionId: string;
};

const VERIFIED_TTL_MS = 15 * 60 * 1_000;
const verifiedKey = (nonce: string) => `telegram-stories:verified:${nonce}`;

export const evaluateBusinessConnection = (
  connection: TelegramBusinessConnection
): 'missing_stories_right' | 'connection_disabled' | 'ready' => {
  if (!connection.is_enabled) {
    return 'connection_disabled';
  }
  return connection.rights?.can_manage_stories === true
    ? 'ready'
    : 'missing_stories_right';
};

export const resolveStoriesConnection = async (
  hub: Pick<
    TelegramUpdatesHub,
    'poll' | 'findConnectionCommand' | 'findBusinessConnection'
  >,
  store: KeyValueStore,
  nonce: string
): Promise<{ status: TelegramStoriesConnectionStatus }> => {
  try {
    await hub.poll();
    const command = await hub.findConnectionCommand(nonce);
    if (!command || command.chatType !== 'private' || command.fromId === undefined) {
      return { status: 'waiting_start' };
    }
    const connection = await hub.findBusinessConnection(command.fromId);
    if (!connection) {
      return { status: 'waiting_business' };
    }
    const status = evaluateBusinessConnection(connection);
    if (status === 'ready') {
      const record: VerifiedStoriesConnection = {
        telegramUserId: command.fromId,
        businessConnectionId: connection.id,
      };
      await store.set(verifiedKey(nonce), JSON.stringify(record), 'PX', VERIFIED_TTL_MS);
    }
    return { status };
  } catch (error) {
    console.error('Failed to verify Telegram Stories connection:', error);
    return { status: 'telegram_error' };
  }
};

export const takeVerifiedStoriesConnection = async (
  store: KeyValueStore,
  nonce: string
): Promise<VerifiedStoriesConnection | null> => {
  const raw = await store.get(verifiedKey(nonce));
  if (!raw) {
    return null;
  }
  await store.del(verifiedKey(nonce));
  return JSON.parse(raw);
};
```

- [ ] **Step 4: Run tests** — same command, expected PASS.

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/social/telegram.stories.connection.ts libraries/nestjs-libraries/src/integrations/social/telegram.stories.connection.spec.ts
git commit -m "feat: resolve Telegram Business stories connection status"
```

---

### Task 6: Media preparation (sharp, ffmpeg) and production image

**Files:**
- Create: `libraries/nestjs-libraries/src/integrations/social/telegram.stories.media.ts`
- Test: `libraries/nestjs-libraries/src/integrations/social/telegram.stories.media.spec.ts`
- Modify: `Dockerfile.dev:6-12`

**Interfaces:**
- Produces:
  - `prepareStoryPhoto(input: Buffer): Promise<Buffer>` — 1080×1920 JPEG ≤ 10 MB, throws otherwise
  - `buildStoryVideoArgs(input: string, output: string): string[]`
  - `buildProbeArgs(input: string): string[]`
  - `runProcess(command: string, args: string[], timeoutMs?: number): Promise<string>` (stdout; rejects with stderr tail)
  - `probeVideoDuration(path: string): Promise<number>`
  - `prepareStoryVideo(input: Buffer): Promise<{ file: Buffer; durationSeconds: number }>` — throws when > 60 s or output > 30 MB
  - `withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T>`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import sharp from 'sharp';
import {
  buildProbeArgs,
  buildStoryVideoArgs,
  prepareStoryPhoto,
  prepareStoryVideo,
} from './telegram.stories.media';

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('prepareStoryPhoto', () => {
  it('converts a landscape image to a 1080x1920 JPEG', async () => {
    const input = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#3366ff' } }).png().toBuffer();
    const output = await prepareStoryPhoto(input);
    const meta = await sharp(output).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1080, 1920, 'jpeg']);
    expect(output.length).toBeLessThanOrEqual(10 * 1024 * 1024);
  });
});

describe('ffmpeg arguments', () => {
  it('builds an H.265 720x1280 story with one key frame per second', () => {
    const args = buildStoryVideoArgs('/in.mov', '/out.mp4');
    expect(args).toEqual(expect.arrayContaining(['-i', '/in.mov', '-c:v', 'libx265', '-tag:v', 'hvc1', '-movflags', '+faststart']));
    expect(args.join(' ')).toContain('scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280');
    expect(args.join(' ')).toContain('keyint=30:min-keyint=30');
    expect(args.at(-1)).toBe('/out.mp4');
  });

  it('probes the container duration', () => {
    expect(buildProbeArgs('/in.mp4')).toEqual(['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', '/in.mp4']);
  });
});

describe.skipIf(!hasFfmpeg)('prepareStoryVideo (real ffmpeg)', () => {
  const makeVideo = (seconds: number) =>
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=1280x720:rate=30:duration=${seconds}`, '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });

  it('transcodes a short clip', async () => {
    const { file, durationSeconds } = await prepareStoryVideo(makeVideo(2));
    expect(durationSeconds).toBeGreaterThan(1.5);
    expect(file.length).toBeGreaterThan(0);
  }, 120_000);

  it('rejects clips longer than 60 seconds', async () => {
    await expect(prepareStoryVideo(makeVideo(61))).rejects.toThrow('60');
  }, 120_000);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/telegram.stories.media.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `telegram.stories.media.ts`**

```ts
import sharp from 'sharp';
import { spawn } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { TELEGRAM_STORY_VIDEO_MAX_SECONDS } from '@gitroom/helpers/utils/telegram.stories.constants';

const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_BYTES = 30 * 1024 * 1024;

export const prepareStoryPhoto = async (input: Buffer): Promise<Buffer> => {
  const background = await sharp(input)
    .rotate()
    .resize(1080, 1920, { fit: 'cover' })
    .blur(40)
    .toBuffer();
  const foreground = await sharp(input)
    .rotate()
    .resize(1080, 1920, { fit: 'inside' })
    .toBuffer();
  const output = await sharp(background)
    .composite([{ input: foreground, gravity: 'center' }])
    .jpeg({ quality: 88 })
    .toBuffer();
  if (output.length > PHOTO_MAX_BYTES) {
    throw new Error('Story photo exceeds 10 MB after conversion');
  }
  return output;
};

export const buildStoryVideoArgs = (input: string, output: string) => [
  '-y', '-i', input,
  '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=black,fps=30',
  '-c:v', 'libx265', '-tag:v', 'hvc1', '-preset', 'fast',
  '-b:v', '3000k', '-maxrate', '3500k', '-bufsize', '7000k',
  '-x265-params', 'keyint=30:min-keyint=30:scenecut=0',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
  '-movflags', '+faststart',
  output,
];

export const buildProbeArgs = (input: string) => [
  '-v', 'error', '-show_entries', 'format=duration',
  '-of', 'default=noprint_wrappers=1:nokey=1', input,
];

export const runProcess = (
  command: string,
  args: string[],
  timeoutMs = 5 * 60 * 1_000
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-2_000)));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(stdout)
        : reject(new Error(`${command} exited with ${code}: ${stderr}`));
    });
  });

export const withTempDir = async <T>(fn: (dir: string) => Promise<T>) => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-story-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

export const probeVideoDuration = async (path: string) => {
  const duration = Number((await runProcess('ffprobe', buildProbeArgs(path))).trim());
  if (!Number.isFinite(duration)) {
    throw new Error('Could not read the video duration');
  }
  return duration;
};

export const prepareStoryVideo = (input: Buffer) =>
  withTempDir(async (dir) => {
    const source = join(dir, 'source');
    const output = join(dir, 'story.mp4');
    await writeFile(source, input);
    if ((await probeVideoDuration(source)) > TELEGRAM_STORY_VIDEO_MAX_SECONDS) {
      throw new Error('Story video must be at most 60 seconds long');
    }
    await runProcess('ffmpeg', buildStoryVideoArgs(source, output));
    const file = await readFile(output);
    if (file.length > VIDEO_MAX_BYTES) {
      throw new Error('Story video exceeds 30 MB after conversion');
    }
    return { file, durationSeconds: await probeVideoDuration(output) };
  });
```

In `Dockerfile.dev`, add `ffmpeg \` to the `apt-get install` list (after `nginx \`).

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/telegram.stories.media.spec.ts`
Expected: PASS (real-ffmpeg block runs if `ffmpeg` is installed locally; otherwise it is reported as skipped — say so in the task report).

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/social/telegram.stories.media.ts libraries/nestjs-libraries/src/integrations/social/telegram.stories.media.spec.ts Dockerfile.dev
git commit -m "feat: prepare story photos and videos for Telegram"
```

---

### Task 7: Idempotent series publisher

**Files:**
- Create: `libraries/nestjs-libraries/src/integrations/social/telegram.stories.publisher.ts`
- Test: `libraries/nestjs-libraries/src/integrations/social/telegram.stories.publisher.spec.ts`

**Interfaces:**
- Consumes: `KeyValueStore`, `MemoryKeyValueStore` (Task 1), `TelegramApiError` (Task 1).
- Produces:
  - `type StoryFrame = { index: number; path: string }`
  - `type FrameResult = { index: number; state: 'published' | 'skipped' | 'failed' | 'unknown'; storyId?: number; error?: string }`
  - `publishStorySeries(input: { postId: string; frames: StoryFrame[]; store: KeyValueStore; send: (frame: StoryFrame) => Promise<number> }): Promise<{ storyIds: number[]; results: FrameResult[] }>` — throws `StorySeriesError` when any frame is not published
  - `class StorySeriesError extends Error { results: FrameResult[] }`
  - `formatStorySeriesError(results: FrameResult[]): string`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { MemoryKeyValueStore } from './telegram.kv.store';
import { TelegramApiError } from './telegram.rich.api';
import { publishStorySeries, StorySeriesError } from './telegram.stories.publisher';

const frames = [
  { index: 0, path: 'https://cdn/a.jpg' },
  { index: 1, path: 'https://cdn/b.jpg' },
  { index: 2, path: 'https://cdn/c.jpg' },
];

describe('publishStorySeries', () => {
  it('publishes frames in order', async () => {
    const send = vi.fn(async (frame) => 100 + frame.index);
    const result = await publishStorySeries({ postId: 'p', frames, store: new MemoryKeyValueStore(), send });
    expect(send.mock.calls.map(([f]) => f.index)).toEqual([0, 1, 2]);
    expect(result.storyIds).toEqual([100, 101, 102]);
  });

  it('reports a partial failure and retries only the missing frames', async () => {
    const store = new MemoryKeyValueStore();
    const failing = vi.fn(async (frame) => {
      if (frame.index === 1) throw new TelegramApiError('Bad Request: wrong file', 'postStory', 400);
      return 100 + frame.index;
    });
    const error = await publishStorySeries({ postId: 'p', frames, store, send: failing }).catch((e) => e);
    expect(error).toBeInstanceOf(StorySeriesError);
    expect(error.message).toContain('2/3');
    expect(error.results.map((r: any) => r.state)).toEqual(['published', 'failed', 'published']);

    const retry = vi.fn(async (frame) => 200 + frame.index);
    const result = await publishStorySeries({ postId: 'p', frames, store, send: retry });
    expect(retry.mock.calls.map(([f]) => f.index)).toEqual([1]);
    expect(result.storyIds).toEqual([100, 201, 102]);
  });

  it('never re-sends a frame whose outcome is unknown', async () => {
    const store = new MemoryKeyValueStore();
    const timeout = vi.fn(async (frame) => {
      if (frame.index === 0) throw new Error('Telegram postStory timed out');
      return 1;
    });
    await expect(publishStorySeries({ postId: 'p', frames: frames.slice(0, 1), store, send: timeout })).rejects.toThrow(StorySeriesError);

    const retry = vi.fn(async () => 5);
    const error = await publishStorySeries({ postId: 'p', frames: frames.slice(0, 1), store, send: retry }).catch((e) => e);
    expect(retry).not.toHaveBeenCalled();
    expect(error.results[0].state).toBe('unknown');
  });

  it('does not treat a replaced file as already published', async () => {
    const store = new MemoryKeyValueStore();
    await publishStorySeries({ postId: 'p', frames: frames.slice(0, 1), store, send: async () => 1 });
    const send = vi.fn(async () => 2);
    await publishStorySeries({ postId: 'p', frames: [{ index: 0, path: 'https://cdn/new.jpg' }], store, send });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/telegram.stories.publisher.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { createHash } from 'crypto';
import type { KeyValueStore } from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import { TelegramApiError } from '@gitroom/nestjs-libraries/integrations/social/telegram.rich.api';

const PROGRESS_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export type StoryFrame = { index: number; path: string };
export type FrameResult = {
  index: number;
  state: 'published' | 'skipped' | 'failed' | 'unknown';
  storyId?: number;
  error?: string;
};

type Progress = { state: 'in_flight' } | { state: 'done'; storyId: number };

export const formatStorySeriesError = (results: FrameResult[]) => {
  const done = results.filter((r) => r.state === 'published' || r.state === 'skipped');
  const lines = results
    .filter((r) => r.state === 'failed' || r.state === 'unknown')
    .map((r) =>
      r.state === 'unknown'
        ? `Story ${r.index + 1}: result unknown, check your Telegram stories before retrying`
        : `Story ${r.index + 1}: ${r.error}`
    );
  return [`Published ${done.length}/${results.length} stories.`, ...lines].join('\n');
};

export class StorySeriesError extends Error {
  constructor(public readonly results: FrameResult[]) {
    super(formatStorySeriesError(results));
    this.name = 'StorySeriesError';
  }
}

const progressKey = (postId: string, frame: StoryFrame) =>
  `telegram-stories:progress:${postId}:${frame.index}:${createHash('sha1')
    .update(frame.path)
    .digest('hex')}`;

export const publishStorySeries = async ({
  postId,
  frames,
  store,
  send,
}: {
  postId: string;
  frames: StoryFrame[];
  store: KeyValueStore;
  send: (frame: StoryFrame) => Promise<number>;
}) => {
  const results: FrameResult[] = [];
  for (const frame of frames) {
    const key = progressKey(postId, frame);
    const raw = await store.get(key);
    const progress: Progress | null = raw ? JSON.parse(raw) : null;
    if (progress?.state === 'done') {
      results.push({ index: frame.index, state: 'skipped', storyId: progress.storyId });
      continue;
    }
    if (progress?.state === 'in_flight') {
      results.push({ index: frame.index, state: 'unknown' });
      continue;
    }
    await store.set(key, JSON.stringify({ state: 'in_flight' }), 'PX', PROGRESS_TTL_MS);
    try {
      const storyId = await send(frame);
      await store.set(key, JSON.stringify({ state: 'done', storyId }), 'PX', PROGRESS_TTL_MS);
      results.push({ index: frame.index, state: 'published', storyId });
    } catch (error) {
      if (error instanceof TelegramApiError || !(error instanceof Error && /timed out|ECONNRESET|socket hang up/i.test(error.message))) {
        // Definitive rejection or failure before the upload: safe to retry.
        await store.del(key);
        results.push({ index: frame.index, state: 'failed', error: error instanceof Error ? error.message : String(error) });
      } else {
        results.push({ index: frame.index, state: 'unknown' });
      }
    }
  }
  if (results.some((r) => r.state === 'failed' || r.state === 'unknown')) {
    throw new StorySeriesError(results);
  }
  return { storyIds: results.map((r) => r.storyId as number), results };
};
```

- [ ] **Step 4: Run tests** — same command, expected PASS.

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/social/telegram.stories.publisher.ts libraries/nestjs-libraries/src/integrations/social/telegram.stories.publisher.spec.ts
git commit -m "feat: publish story series without duplicating frames"
```

---

### Task 8: Settings DTO, MCP schema and capability profile

**Files:**
- Create: `libraries/nestjs-libraries/src/dtos/posts/providers-settings/telegram.stories.dto.ts`
- Modify: `libraries/nestjs-libraries/src/dtos/posts/providers-settings/all.providers.settings.ts` (union type ~line 58, `allProviders` list ~line 97)
- Modify: `libraries/helpers/src/utils/platform.capability.profiles.ts` (`profiles` ~line 380, `PROFILE_IDENTIFIERS` ~line 1121)
- Test: `libraries/nestjs-libraries/src/dtos/posts/providers-settings/telegram.stories.dto.spec.ts`

**Interfaces:**
- Consumes: constants from Task 4.
- Produces: `class TelegramStoriesDto { active_period?: string; frames?: TelegramStoryFrameDto[] }`, `class TelegramStoryFrameDto`; capability profile key `telegram-stories` with variant `story`.

- [ ] **Step 1: Write the failing tests**

```ts
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { TelegramStoriesDto } from './telegram.stories.dto';
import { getValidationSchemas } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';
import { allProviders } from './all.providers.settings';
import { PLATFORM_CAPABILITY_PROFILES } from '@gitroom/helpers/utils/platform.capability.profiles';

const errors = (value: unknown) => validateSync(plainToInstance(TelegramStoriesDto, value));

describe('TelegramStoriesDto', () => {
  it('accepts lifetime and positional frames', () => {
    expect(errors({ active_period: '43200', frames: [{ text: 'none' }, { text: 'custom', caption: 'Hi' }] })).toHaveLength(0);
  });

  it.each([{ active_period: '3600' }, { frames: [{ text: 'all' }] }])('rejects %j', (value) => {
    expect(errors(value).length).toBeGreaterThan(0);
  });

  it('is registered for the editor and MCP', () => {
    expect(allProviders().find((p) => p.name === 'telegram-stories')?.value).toBe(TelegramStoriesDto);
    const schema = getValidationSchemas()['TelegramStoriesDto'] as any;
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['active_period', 'frames']));
  });

  it('has a capability profile requiring media', () => {
    const profile = (PLATFORM_CAPABILITY_PROFILES as any)['telegram-stories'];
    expect(profile.variants.story.media.type).toBe('required');
    expect(profile.variants.story.fields[0].limit.max).toBe(2048);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/dtos/posts/providers-settings/telegram.stories.dto.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`telegram.stories.dto.ts`:

```ts
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  TELEGRAM_STORY_ACTIVE_PERIODS,
  TELEGRAM_STORY_MAX_FRAMES,
} from '@gitroom/helpers/utils/telegram.stories.constants';

export class TelegramStoryFrameDto {
  @IsOptional()
  @IsString()
  mediaId?: string;

  @IsIn(['post', 'none', 'custom'])
  text: 'post' | 'none' | 'custom';

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  caption?: string;
}

export class TelegramStoriesDto {
  @IsOptional()
  @IsIn([...TELEGRAM_STORY_ACTIVE_PERIODS])
  active_period?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TELEGRAM_STORY_MAX_FRAMES)
  @ValidateNested({ each: true })
  @Type(() => TelegramStoryFrameDto)
  frames?: TelegramStoryFrameDto[];
}
```

`all.providers.settings.ts`: import the DTO, add `| ProviderExtension<'telegram-stories', TelegramStoriesDto>` to the union and `{ value: TelegramStoriesDto, name: 'telegram-stories' },` after the `telegram` entry of `allProviders`.

`platform.capability.profiles.ts`: add after the `max` profile

```ts
  'telegram-stories': {
    identifier: 'telegram-stories',
    displayName: 'Telegram Stories',
    verification: 'verified',
    evidenceDate,
    defaultVariant: 'story',
    variants: {
      story: simpleVariant('story', 2_048, 'html', telegramCaptionFormatting, {
        type: 'required',
        images: { min: 1, max: 10 },
        videos: { min: 1, max: 10 },
        mixed: true,
        maxTotal: 10,
      }),
    },
  },
```

and add `'telegram-stories',` after `'max',` in `PROFILE_IDENTIFIERS`.

- [ ] **Step 4: Run the new spec and the capability suites; review and update snapshots only if the diff is the new profile**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/dtos/posts/providers-settings/telegram.stories.dto.spec.ts libraries/helpers/src/utils/`
Expected: new spec PASS. If `platform.formatting.matrix.spec.ts` fails only because of an added `telegram-stories` row, re-run that file with `-u` and inspect `git diff` of the snapshot to confirm only the new row was added.

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/dtos/posts/providers-settings/ libraries/helpers/src/utils/platform.capability.profiles.ts libraries/helpers/src/utils/__snapshots__
git commit -m "feat: expose Telegram stories settings to the editor and MCP"
```

---

### Task 9: The provider

**Files:**
- Create: `libraries/nestjs-libraries/src/integrations/social/telegram.stories.provider.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/integration.manager.ts` (import + `new TelegramStoriesProvider(),` after `new TelegramProvider(),` in `socialIntegrationList`)
- Test: `libraries/nestjs-libraries/src/integrations/social/telegram.stories.provider.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–8.
- Produces: `class TelegramStoriesProvider` with `identifier = 'telegram-stories'`, `isWeb3 = true`, `dto = TelegramStoriesDto`, `getConnectionStatus(nonce: string)`, `authenticate`, `refreshToken`, `checkValidity`, `post`. Constructor: `(deps?: Partial<TelegramStoriesDeps>)` where

```ts
type TelegramStoriesDeps = {
  api: Pick<TelegramBusinessApi, 'getBusinessConnection' | 'postStory'>;
  hub: Pick<TelegramUpdatesHub, 'poll' | 'findConnectionCommand' | 'findBusinessConnection'>;
  store: KeyValueStore;
  readMedia: (path: string) => Promise<Buffer>;
  preparePhoto: (input: Buffer) => Promise<Buffer>;
  prepareVideo: (input: Buffer) => Promise<{ file: Buffer; durationSeconds: number }>;
  probeDuration: (input: Buffer) => Promise<number>;
};
```

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node-telegram-bot-api', () => ({ default: vi.fn(() => ({})) }));
vi.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  SocialAbstract: class {},
  RefreshToken: class RefreshToken extends Error {
    constructor(_id: string, _json: string, _body: unknown, message = '') {
      super(message);
      this.name = 'RefreshToken';
    }
  },
}));
vi.mock('@gitroom/nestjs-libraries/services/make.is', () => ({ makeId: vi.fn(() => 'nonce') }));

import { TelegramStoriesProvider } from './telegram.stories.provider';
import { MemoryKeyValueStore } from './telegram.kv.store';

const connection = (patch: any = {}) => ({
  id: 'bc-1', user: { id: 7, first_name: 'Dmitry', username: 'fedr' }, is_enabled: true, rights: { can_manage_stories: true }, ...patch,
});

const make = (patch: any = {}) => {
  const store = new MemoryKeyValueStore();
  let nextId = 500;
  const deps = {
    store,
    api: {
      getBusinessConnection: vi.fn().mockResolvedValue(connection()),
      postStory: vi.fn(async () => ({ id: nextId++ })),
    },
    hub: { poll: vi.fn(), findConnectionCommand: vi.fn(), findBusinessConnection: vi.fn() },
    readMedia: vi.fn(async (path: string) => Buffer.from(path)),
    preparePhoto: vi.fn(async () => Buffer.from('jpeg')),
    prepareVideo: vi.fn(async () => ({ file: Buffer.from('mp4'), durationSeconds: 9 })),
    probeDuration: vi.fn(async () => 10),
    ...patch,
  };
  return { provider: new TelegramStoriesProvider(deps), deps, store };
};

const post = (settings: any = {}, media = [{ id: 'a', type: 'image', path: 'https://cdn/a.jpg' }, { id: 'b', type: 'video', path: 'https://cdn/b.mp4' }]) =>
  [{ id: 'post-1', message: '<p><strong>Hello</strong> <a href="https://x.test">link</a></p><h2>Title</h2>', settings, media }] as any;

describe('TelegramStoriesProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('authenticates only from a server-verified record', async () => {
    const { provider, store } = make();
    await expect(provider.authenticate({ code: 'nonce', codeVerifier: '' })).resolves.toBe('Telegram Stories connection expired. Start again.');
    await store.set('telegram-stories:verified:nonce', JSON.stringify({ telegramUserId: 7, businessConnectionId: 'bc-1' }));
    await expect(provider.authenticate({ code: 'nonce', codeVerifier: '' })).resolves.toMatchObject({
      id: '7', accessToken: 'bc-1', name: 'Dmitry', username: 'fedr',
    });
  });

  it('refuses a verified record whose connection lost the right', async () => {
    const { provider, store, deps } = make();
    deps.api.getBusinessConnection.mockResolvedValue(connection({ rights: {} }));
    await store.set('telegram-stories:verified:nonce', JSON.stringify({ telegramUserId: 7, businessConnectionId: 'bc-1' }));
    await expect(provider.authenticate({ code: 'nonce', codeVerifier: '' })).resolves.toBe('Enable "Manage stories" for the bot in Telegram Business.');
  });

  it('publishes each media as a story with default captions and lifetime', async () => {
    const { provider, deps } = make();
    const [result] = await provider.post('7', 'bc-1', post(), { profile: 'fedr' } as any);
    const calls = deps.api.postStory.mock.calls.map(([p]: any) => p);
    expect(calls.map((c: any) => [c.kind, c.activePeriod, c.caption])).toEqual([
      ['photo', 86400, '<b>Hello</b> <a href="https://x.test">link</a>\n\n<b>Title</b>'],
      ['video', 86400, undefined],
    ]);
    expect(calls[1]).toMatchObject({ durationSeconds: 9, businessConnectionId: 'bc-1' });
    expect(result).toEqual({ id: 'post-1', postId: '500,501', releaseURL: 'https://t.me/fedr/s/500', status: 'completed' });
  });

  it('applies per-frame text and lifetime settings', async () => {
    const { provider, deps } = make();
    await provider.post('7', 'bc-1', post({ active_period: '172800', frames: [{ mediaId: 'b', text: 'custom', caption: 'Second' }, { mediaId: 'a', text: 'none' }] }), {} as any);
    const calls = deps.api.postStory.mock.calls.map(([p]: any) => [p.activePeriod, p.caption]);
    expect(calls).toEqual([[172800, undefined], [172800, 'Second']]);
  });

  it('asks for reconnection when the stories right was revoked', async () => {
    const { provider, deps } = make();
    deps.api.getBusinessConnection.mockResolvedValue(connection({ is_enabled: false }));
    await expect(provider.post('7', 'bc-1', post(), {} as any)).rejects.toMatchObject({ name: 'RefreshToken' });
    expect(deps.api.postStory).not.toHaveBeenCalled();
  });

  it('validates media before scheduling', async () => {
    const { provider, deps } = make();
    await expect(provider.checkValidity([[]], {}, [])).resolves.toBe('Telegram Stories needs at least one photo or video.');
    await expect(provider.checkValidity([Array.from({ length: 11 }, (_, i) => ({ path: `${i}.jpg`, type: 'image' }))], {}, [])).resolves.toBe('Telegram Stories supports at most 10 files per post.');
    deps.probeDuration.mockResolvedValue(61);
    await expect(provider.checkValidity([[{ path: 'v.mp4', type: 'video' }]], {}, [])).resolves.toBe('Story videos must be at most 60 seconds long.');
    deps.probeDuration.mockResolvedValue(30);
    await expect(provider.checkValidity([[{ path: 'v.mp4', type: 'video' }, { path: 'p.jpg', type: 'image' }]], {}, [])).resolves.toBe(true);
  });

  it('rejects captions longer than 2048 visible characters', async () => {
    const { provider, deps } = make();
    await expect(provider.post('7', 'bc-1', post({}, [{ id: 'a', type: 'image', path: 'x.jpg' }]).map((p: any) => ({ ...p, message: 'a'.repeat(2049) })), {} as any)).rejects.toThrow('2048');
    expect(deps.api.postStory).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/telegram.stories.provider.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `telegram.stories.provider.ts`**

```ts
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import TelegramBot from 'node-telegram-bot-api';
import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  RefreshToken,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';
import { readOrFetch } from '@gitroom/helpers/utils/read.or.fetch';
import { normalizeVerifiedHtml } from '@gitroom/helpers/utils/verified.html.normalization';
import {
  resolveStoryFrameCaptions,
  TELEGRAM_STORY_CAPTION_MAX,
  TELEGRAM_STORY_DEFAULT_ACTIVE_PERIOD,
  TELEGRAM_STORY_MAX_FRAMES,
  TELEGRAM_STORY_VIDEO_MAX_SECONDS,
} from '@gitroom/helpers/utils/telegram.stories.constants';
import { TelegramStoriesDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/telegram.stories.dto';
import { TelegramBusinessApi } from '@gitroom/nestjs-libraries/integrations/social/telegram.business.api';
import { TelegramUpdatesHub } from '@gitroom/nestjs-libraries/integrations/social/telegram.updates.hub';
import { KeyValueStore, redisKeyValueStore } from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import {
  evaluateBusinessConnection,
  resolveStoriesConnection,
  takeVerifiedStoriesConnection,
} from '@gitroom/nestjs-libraries/integrations/social/telegram.stories.connection';
import {
  prepareStoryPhoto,
  prepareStoryVideo,
  probeVideoDuration,
  withTempDir,
} from '@gitroom/nestjs-libraries/integrations/social/telegram.stories.media';
import { publishStorySeries } from '@gitroom/nestjs-libraries/integrations/social/telegram.stories.publisher';
import { writeFile } from 'fs/promises';
import { join } from 'path';

type TelegramStoriesDeps = {
  api: Pick<TelegramBusinessApi, 'getBusinessConnection' | 'postStory'>;
  hub: Pick<TelegramUpdatesHub, 'poll' | 'findConnectionCommand' | 'findBusinessConnection'>;
  store: KeyValueStore;
  readMedia: (path: string) => Promise<Buffer>;
  preparePhoto: (input: Buffer) => Promise<Buffer>;
  prepareVideo: (input: Buffer) => Promise<{ file: Buffer; durationSeconds: number }>;
  probeDuration: (input: Buffer) => Promise<number>;
};

const resolveMediaUrl = (path: string) =>
  path.indexOf('http') === -1 ? `${process.env.FRONTEND_URL}/${path}` : path;

const defaultDeps = (): TelegramStoriesDeps => ({
  api: new TelegramBusinessApi(),
  hub: new TelegramUpdatesHub(
    new TelegramBot(process.env.TELEGRAM_TOKEN || 'missing'),
    redisKeyValueStore
  ),
  store: redisKeyValueStore,
  readMedia: (path) => readOrFetch(resolveMediaUrl(path)),
  preparePhoto: prepareStoryPhoto,
  prepareVideo: prepareStoryVideo,
  probeDuration: (input) =>
    withTempDir(async (dir) => {
      const file = join(dir, 'probe');
      await writeFile(file, input);
      return probeVideoDuration(file);
    }),
});

@Rules(
  'Telegram Stories needs 1 to 10 photos or videos; every file becomes a separate story. Videos must be at most 60 seconds. By default the post text is the caption of the first story; use settings.frames (by position, {text: "post" | "none" | "custom", caption}) to change it. settings.active_period is 21600, 43200, 86400 (default) or 172800 seconds.'
)
export class TelegramStoriesProvider extends SocialAbstract implements SocialProvider {
  private readonly deps: TelegramStoriesDeps;

  constructor(deps: Partial<TelegramStoriesDeps> = {}) {
    super();
    this.deps = { ...defaultDeps(), ...deps };
  }

  override maxConcurrentJob = 1;
  identifier = 'telegram-stories';
  name = 'Telegram Stories';
  isBetweenSteps = false;
  isWeb3 = true;
  scopes = [] as string[];
  editor = 'html' as const;
  dto = TelegramStoriesDto;
  toolTip = 'Personal stories through Telegram Business (requires Telegram Premium)';

  maxLength() {
    return TELEGRAM_STORY_CAPTION_MAX;
  }

  async refreshToken(): Promise<AuthTokenDetails> {
    return { refreshToken: '', expiresIn: 0, accessToken: '', id: '', name: '', picture: '', username: '' };
  }

  async generateAuthUrl() {
    const state = makeId(17);
    return { url: state, codeVerifier: makeId(10), state };
  }

  getConnectionStatus(nonce: string) {
    return resolveStoriesConnection(this.deps.hub, this.deps.store, nonce);
  }

  async authenticate(params: { code: string; codeVerifier: string; refresh?: string }) {
    const verified = await takeVerifiedStoriesConnection(this.deps.store, params.code);
    if (!verified) {
      return 'Telegram Stories connection expired. Start again.';
    }
    const connection = await this.deps.api.getBusinessConnection(verified.businessConnectionId);
    if (
      connection.user.id !== verified.telegramUserId ||
      evaluateBusinessConnection(connection) !== 'ready'
    ) {
      return 'Enable "Manage stories" for the bot in Telegram Business.';
    }
    const { user } = connection;
    return {
      id: String(user.id),
      name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || String(user.id),
      accessToken: connection.id,
      refreshToken: '',
      expiresIn: dayjs().add(200, 'year').unix() - dayjs().unix(),
      picture: '',
      username: user.username || '',
    };
  }

  override async checkValidity(posts: Array<ValidityMedia[]>): Promise<string | true> {
    const media = posts[0] || [];
    if (!media.length) {
      return 'Telegram Stories needs at least one photo or video.';
    }
    if (media.length > TELEGRAM_STORY_MAX_FRAMES) {
      return 'Telegram Stories supports at most 10 files per post.';
    }
    for (const item of media) {
      if (item.type !== 'video') {
        continue;
      }
      const duration = await this.deps.probeDuration(await this.deps.readMedia(item.path));
      if (duration > TELEGRAM_STORY_VIDEO_MAX_SECONDS) {
        return 'Story videos must be at most 60 seconds long.';
      }
    }
    return true;
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<TelegramStoriesDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const connection = await this.deps.api.getBusinessConnection(accessToken);
    if (evaluateBusinessConnection(connection) !== 'ready') {
      throw new RefreshToken(
        this.identifier,
        JSON.stringify({ is_enabled: connection.is_enabled, rights: connection.rights }),
        '',
        'Telegram Stories access was revoked. Reconnect the channel.'
      );
    }

    const media = firstPost.media || [];
    const captions = resolveStoryFrameCaptions(
      firstPost.message || '',
      media as Array<{ id?: string }>,
      firstPost.settings?.frames
    ).map((caption) => normalizeVerifiedHtml(caption, 'telegram', undefined, true));
    const tooLong = captions.findIndex((c) => [...c.visibleText].length > TELEGRAM_STORY_CAPTION_MAX);
    if (tooLong !== -1) {
      throw new Error(`Story ${tooLong + 1} caption exceeds 2048 characters.`);
    }
    const activePeriod = Number(firstPost.settings?.active_period || TELEGRAM_STORY_DEFAULT_ACTIVE_PERIOD);

    const { storyIds } = await publishStorySeries({
      postId: firstPost.id,
      frames: media.map((item, index) => ({ index, path: item.path })),
      store: this.deps.store,
      send: async (frame) => {
        const item = media[frame.index];
        const source = await this.deps.readMedia(item.path);
        const caption = captions[frame.index].normalized || undefined;
        const common = { businessConnectionId: accessToken, activePeriod, caption };
        if (item.type === 'video') {
          const { file, durationSeconds } = await this.deps.prepareVideo(source);
          return (await this.deps.api.postStory({ ...common, kind: 'video', file, durationSeconds })).id;
        }
        const file = await this.deps.preparePhoto(source);
        return (await this.deps.api.postStory({ ...common, kind: 'photo', file })).id;
      },
    });

    const username = integration?.profile;
    return [
      {
        id: firstPost.id,
        postId: storyIds.join(','),
        releaseURL: username ? `https://t.me/${username}/s/${storyIds[0]}` : '',
        status: 'completed',
      },
    ];
  }
}
```

Before writing, confirm `normalizeVerifiedHtml` exports `visibleText` (it does: see `telegram.constraints.ts:27-31`) and that `ValidityMedia` is exported from `social.abstract.ts:12`. If `visibleText` is measured in UTF-16 elsewhere (`measureContent`), use `measureContent(visibleText, …)` from the same module instead of spreading — match `getTelegramVisibleTextLength`.

Register in `integration.manager.ts`.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/`
Expected: PASS (including `integration.manager.spec.ts`; if it asserts the exact provider list, add `telegram-stories` there).

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/
git commit -m "feat: add Telegram Business stories provider"
```

---

### Task 10: Backend endpoints and rollout gate

**Files:**
- Modify: `apps/backend/src/api/routes/integrations.controller.ts` (new routes next to `/telegram/updates` ~line 472; gate in `getIntegrationUrl` ~line 224)
- Modify: `apps/backend/src/api/routes/no.auth.integrations.controller.ts` (`connectSocialMedia` after the organization is read, ~line 74)
- Modify: `.env.example` (add `TELEGRAM_STORIES_ORG_IDS=""` with a comment)
- Test: `apps/backend/src/api/routes/telegram.stories.routes.spec.ts`

**Interfaces:**
- Consumes: `TelegramStoriesProvider.getConnectionStatus` (Task 9), `isTelegramStoriesEnabledForOrg`, `TELEGRAM_STORIES_IDENTIFIER` (Task 4).
- Produces: `GET /integrations/telegram-stories/availability` → `{ available: boolean }`; `GET /integrations/telegram-stories/updates?word=` → `{ status }` or 403.

- [ ] **Step 1: Write the failing tests** — follow the construction style of `apps/backend/src/api/routes/integration.connection.availability.spec.ts` (read it first; it instantiates the controller with stubbed services). Tests:

```ts
it('reports availability per organization', async () => {
  vi.stubEnv('TELEGRAM_STORIES_ORG_IDS', 'org-1');
  expect(controller.getTelegramStoriesAvailability({ id: 'org-1' } as any)).toEqual({ available: true });
  expect(controller.getTelegramStoriesAvailability({ id: 'org-2' } as any)).toEqual({ available: false });
});

it('refuses stories connection status for a disabled organization', async () => {
  vi.stubEnv('TELEGRAM_STORIES_ORG_IDS', '');
  await expect(controller.getTelegramStoriesUpdates('nonce', { id: 'org-1' } as any)).rejects.toThrow('Integration not available');
});

it('refuses to start a stories connection for a disabled organization', async () => {
  vi.stubEnv('TELEGRAM_STORIES_ORG_IDS', 'org-1');
  await expect(controller.getIntegrationUrl('telegram-stories', '', '', '', '', { id: 'org-2' } as any)).rejects.toThrow('Integration not available');
});
```

And in the no-auth controller spec (`no.auth.integrations.controller.spec.ts`, extend its existing setup): with `ioRedis` stubbed so `organization:<state>` returns `org-2` and `TELEGRAM_STORIES_ORG_IDS=org-1`, `connectSocialMedia('telegram-stories', { code: 'n', state: 's' })` rejects with `Integration not available` and `authenticate` is not called.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run apps/backend/src/api/routes/`
Expected: FAIL — methods missing / no gate.

- [ ] **Step 3: Implement**

In `integrations.controller.ts`:

```ts
@Get('/telegram-stories/availability')
getTelegramStoriesAvailability(@GetOrgFromRequest() org: Organization) {
  return {
    available: isTelegramStoriesEnabledForOrg(process.env.TELEGRAM_STORIES_ORG_IDS, org.id),
  };
}

@Get('/telegram-stories/updates')
async getTelegramStoriesUpdates(
  @Query('word') word: string,
  @GetOrgFromRequest() org: Organization
) {
  if (!isTelegramStoriesEnabledForOrg(process.env.TELEGRAM_STORIES_ORG_IDS, org.id)) {
    throw new ForbiddenException('Integration not available');
  }
  return new TelegramStoriesProvider().getConnectionStatus(word);
}
```

In `getIntegrationUrl`, right after the allowlist check:

```ts
if (
  integration === TELEGRAM_STORIES_IDENTIFIER &&
  !isTelegramStoriesEnabledForOrg(process.env.TELEGRAM_STORIES_ORG_IDS, org.id)
) {
  throw new ForbiddenException('Integration not available');
}
```

In `connectSocialMedia`, right after `const organization = await ioRedis.get(...)` and its null check:

```ts
if (
  integration === TELEGRAM_STORIES_IDENTIFIER &&
  !isTelegramStoriesEnabledForOrg(process.env.TELEGRAM_STORIES_ORG_IDS, organization)
) {
  throw new ForbiddenException('Integration not available');
}
```

`.env.example`:

```
# Comma-separated organization IDs allowed to connect Telegram Stories (empty = hidden)
TELEGRAM_STORIES_ORG_IDS=""
```

- [ ] **Step 4: Run tests** — same command, expected PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/api/routes/ .env.example
git commit -m "feat: gate Telegram stories connection per organization"
```

---

### Task 11: Connection wizard

**Files:**
- Create: `apps/frontend/src/components/launches/web3/providers/telegram.stories.connection.ts`
- Create: `apps/frontend/src/components/launches/web3/providers/telegram.stories.provider.tsx`
- Modify: `apps/frontend/src/components/launches/web3/web3.list.tsx`
- Create: `apps/frontend/src/components/launches/use.telegram.stories.availability.ts`
- Modify: `apps/frontend/src/components/launches/add.provider.component.tsx:950-952` (picker filter)
- Modify: `libraries/react-shared-libraries/src/translation/locales/en/translation.json`, `.../ru/translation.json`
- Test: `apps/frontend/src/components/launches/web3/providers/telegram.stories.provider.spec.tsx`

**Interfaces:**
- Consumes: `GET /integrations/telegram-stories/updates` and `/availability` (Task 10).
- Produces: `buildTelegramStoriesStartLink(botName: string, nonce: string): string`; `type TelegramStoriesConnectionResponse = { status: 'waiting_start' | 'waiting_business' | 'missing_stories_right' | 'connection_disabled' | 'ready' | 'telegram_error' }`; `TelegramStoriesProvider: FC<Web3ProviderInterface>`; `useTelegramStoriesAvailability()`.

- [ ] **Step 1: Write the failing tests** — mirror the setup of `max.provider.spec.tsx` (read it first: it mocks `useFetch`, `useVariables`, `useT`, `timer`). Tests:

```tsx
it('builds a private start link', () => {
  expect(buildTelegramStoriesStartLink('@vezdepost_bot', 'abc')).toBe('https://t.me/vezdepost_bot?start=abc');
});

it('completes with the nonce when the connection is ready', async () => {
  fetchMock.mockResolvedValueOnce(json({ status: 'waiting_business' })).mockResolvedValueOnce(json({ status: 'ready' }));
  render(<TelegramStoriesProvider nonce="abc" onComplete={onComplete} />);
  fireEvent.click(screen.getByText('Open the bot in Telegram'));
  await waitFor(() => expect(onComplete).toHaveBeenCalledWith('abc', 'abc'));
  expect(fetchMock).toHaveBeenCalledWith('/integrations/telegram-stories/updates?word=abc');
});

it('stops and explains a missing stories right', async () => {
  fetchMock.mockResolvedValue(json({ status: 'missing_stories_right' }));
  render(<TelegramStoriesProvider nonce="abc" onComplete={onComplete} />);
  fireEvent.click(screen.getByText('Open the bot in Telegram'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Manage stories');
  expect(onComplete).not.toHaveBeenCalled();
});

it('explains how to resend the connection when waiting for Telegram Business', async () => {
  fetchMock.mockResolvedValue(json({ status: 'waiting_business' }));
  render(<TelegramStoriesProvider nonce="abc" onComplete={onComplete} />);
  fireEvent.click(screen.getByText('Open the bot in Telegram'));
  expect(await screen.findByText(/switch "Manage stories" off and on/)).toBeInTheDocument();
});
```

Plus a picker test next to existing `isProviderVisibleInPicker` tests: `telegram-stories` is hidden when `useTelegramStoriesAvailability` returns `{ available: false }` and shown when `true`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run apps/frontend/src/components/launches/`
Expected: FAIL.

- [ ] **Step 3: Implement**

`telegram.stories.connection.ts`:

```ts
export type TelegramStoriesConnectionResponse = {
  status:
    | 'waiting_start'
    | 'waiting_business'
    | 'missing_stories_right'
    | 'connection_disabled'
    | 'ready'
    | 'telegram_error';
};

export const buildTelegramStoriesStartLink = (botName: string, nonce: string) =>
  `https://t.me/${botName.replace(/^@/, '')}?start=${encodeURIComponent(nonce)}`;
```

`telegram.stories.provider.tsx` — same polling skeleton as `telegram.provider.tsx:55-117` (2 s interval, 90 s timeout, attempt ref), calling `/integrations/telegram-stories/updates?word=${nonce}`:
- `ready` → `onComplete(nonce, nonce)`;
- `missing_stories_right` / `connection_disabled` / `telegram_error` → stop, show `role="alert"` text, show "Check again";
- `waiting_start` / `waiting_business` → keep polling; show the step hint.

Layout (tailwind classes as in the Telegram wizard): title "Telegram Stories"; note "Requires Telegram Premium with Telegram Business."; ordered steps:
1. Button-link `Open the bot in Telegram` → `buildTelegramStoriesStartLink(telegramBotName, nonce)`, `onClick={() => void verify()}`; hint "Press Start in the chat with the bot."
2. "In Telegram open Settings → Telegram Business → Chatbots, add @<bot> and enable Manage stories."
3. While `waiting_business`: "If the bot was already added, switch \"Manage stories\" off and on so Telegram resends the connection."

Translation keys (prefix `telegram_stories_connection_`): `title`, `premium_required`, `open_bot`, `press_start`, `business_steps`, `resend_hint`, `waiting`, `missing_right`, `disabled`, `telegram_error`, `timed_out`, `check_again`. Add English defaults to `en/translation.json` and Russian to `ru/translation.json`:

| key | ru |
|---|---|
| title | Telegram Stories |
| premium_required | Нужен Telegram Premium с Telegram Business. |
| open_bot | Открыть бота в Telegram |
| press_start | Нажмите «Старт» в чате с ботом. |
| business_steps | В Telegram откройте Настройки → Telegram Business → Чат-боты, добавьте @{{bot}} и включите «Управление историями». |
| resend_hint | Если бот уже был добавлен, выключите и снова включите «Управление историями» — Telegram повторно пришлёт подключение. |
| waiting | Ждём Telegram… |
| missing_right | Бот подключён, но «Управление историями» выключено. Включите его и нажмите «Проверить снова». |
| disabled | Бот отключён в Telegram Business. Подключите его снова. |
| telegram_error | Telegram не ответил. Попробуйте ещё раз. |
| timed_out | Подтверждение пока не пришло. |
| check_again | Проверить снова |

Register in `web3.list.tsx`: `{ identifier: 'telegram-stories', component: TelegramStoriesProvider }` (import aliased, e.g. `TelegramStoriesWeb3Provider`).

`use.telegram.stories.availability.ts`:

```ts
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export const useTelegramStoriesAvailability = () => {
  const fetch = useFetch();
  return useSWR<{ available: boolean }>('telegram-stories-availability', async () =>
    (await fetch('/integrations/telegram-stories/availability')).json()
  );
};
```

In `AddProviderComponent` call the hook at the top of the component and extend the filter:

```tsx
.filter(
  (item) =>
    isProviderVisibleInPicker(item, props.invite) &&
    (item.identifier !== 'telegram-stories' || !!storiesAvailability?.available)
)
```

Then `grep -rn "fetch('/integrations')" apps/frontend/src` and apply the same filter where a list of connectable channels is rendered (`onboarding.modal.tsx`, `mobile.integration.tsx`) — if one renders connect cards, filter it the same way; note in the task report which ones needed it.

- [ ] **Step 4: Run tests** — same command, expected PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/launches/ libraries/react-shared-libraries/src/translation/locales/en/translation.json libraries/react-shared-libraries/src/translation/locales/ru/translation.json
git commit -m "feat: guide Telegram Stories connection through Telegram Business"
```

---

### Task 12: Editor settings (lifetime and per-frame text)

**Files:**
- Create: `apps/frontend/src/components/new-launch/providers/telegram-stories/telegram.stories.provider.tsx`
- Modify: `apps/frontend/src/components/new-launch/providers/show.all.providers.tsx` (import + entry after `telegram`)
- Modify: translations en/ru
- Test: `apps/frontend/src/components/new-launch/providers/telegram-stories/telegram.stories.provider.spec.tsx`

**Interfaces:**
- Consumes: `TelegramStoriesDto` (Task 8), constants and `TelegramStoryFrameSetting` (Task 4).
- Produces: default export `withProvider({... dto: TelegramStoriesDto, SettingsComponent: TelegramStoriesSettings ...})`, named `TelegramStoriesSettings`, pure helper `setFrameSetting(frames: TelegramStoryFrameSetting[], media: Array<{ id: string }>, mediaId: string, patch: Partial<TelegramStoryFrameSetting>): TelegramStoryFrameSetting[]`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { setFrameSetting } from './telegram.stories.provider';

const media = [{ id: 'a' }, { id: 'b' }];

describe('setFrameSetting', () => {
  it('writes a frame keyed by media id with defaults for the others', () => {
    expect(setFrameSetting([], media, 'b', { text: 'custom', caption: 'Hi' })).toEqual([
      { mediaId: 'a', text: 'post' },
      { mediaId: 'b', text: 'custom', caption: 'Hi' },
    ]);
  });

  it('drops frames of removed media and keeps edited ones', () => {
    const frames = [{ mediaId: 'gone', text: 'none' as const }, { mediaId: 'a', text: 'none' as const }];
    expect(setFrameSetting(frames, media, 'b', { text: 'none' })).toEqual([
      { mediaId: 'a', text: 'none' },
      { mediaId: 'b', text: 'none' },
    ]);
  });
});
```

Also a render test (follow `high.order.provider.settings.spec.tsx` for the provider-context setup): with two media attached, the settings show a lifetime select defaulting to `86400` and two frame rows ("Story 1", "Story 2"); choosing "Custom text" on row 2 shows a textarea.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run apps/frontend/src/components/new-launch/providers/telegram-stories/`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { TelegramStoriesDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/telegram.stories.dto';
import { Select } from '@gitroom/react/form/select';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  TELEGRAM_STORY_ACTIVE_PERIODS,
  TELEGRAM_STORY_DEFAULT_ACTIVE_PERIOD,
  TELEGRAM_STORY_CAPTION_MAX,
  TelegramStoryFrameSetting,
} from '@gitroom/helpers/utils/telegram.stories.constants';

export const setFrameSetting = (
  frames: TelegramStoryFrameSetting[],
  media: Array<{ id: string }>,
  mediaId: string,
  patch: Partial<TelegramStoryFrameSetting>
): TelegramStoryFrameSetting[] =>
  media.map((item, index) => {
    const current =
      frames.find((frame) => frame.mediaId === item.id) ??
      ({ mediaId: item.id, text: index === 0 ? 'post' : 'none' } as TelegramStoryFrameSetting);
    return item.id === mediaId ? { ...current, ...patch, mediaId: item.id } : current;
  });

const periodLabels: Record<string, string> = {
  '21600': '6',
  '43200': '12',
  '86400': '24',
  '172800': '48',
};

export const TelegramStoriesSettings: FC = () => {
  const t = useT();
  const { register, watch, setValue } = useSettings();
  const { value } = useIntegration();
  const media: Array<{ id: string; path: string }> = value?.[0]?.image || [];
  const frames: TelegramStoryFrameSetting[] = watch('frames') || [];

  const update = (mediaId: string, patch: Partial<TelegramStoryFrameSetting>) =>
    setValue('frames', setFrameSetting(frames, media, mediaId, patch));

  return (
    <div className="flex flex-col gap-[16px] pt-[20px]">
      <Select
        label={t('telegram_stories_lifetime', 'Story lifetime')}
        {...register('active_period', { value: TELEGRAM_STORY_DEFAULT_ACTIVE_PERIOD })}
      >
        {TELEGRAM_STORY_ACTIVE_PERIODS.map((period) => (
          <option key={period} value={period}>
            {t('telegram_stories_hours', '{{hours}} hours', { hours: periodLabels[period] })}
          </option>
        ))}
      </Select>
      {media.map((item, index) => {
        const frame =
          frames.find((f) => f.mediaId === item.id) ??
          { text: index === 0 ? 'post' : 'none' };
        return (
          <div key={item.id} className="flex flex-col gap-[8px] rounded-[8px] border border-newTableBorder p-[12px]">
            <div className="text-[14px] font-[500]">
              {t('telegram_stories_frame', 'Story {{number}}', { number: index + 1 })}
            </div>
            <select
              className="h-[40px] rounded-[6px] border border-newTableBorder bg-newBgColorInner px-[10px] text-[14px]"
              value={frame.text}
              onChange={(e) => update(item.id, { text: e.target.value as TelegramStoryFrameSetting['text'] })}
            >
              <option value="post">{t('telegram_stories_text_post', 'Post text')}</option>
              <option value="none">{t('telegram_stories_text_none', 'No text')}</option>
              <option value="custom">{t('telegram_stories_text_custom', 'Custom text')}</option>
            </select>
            {frame.text === 'custom' && (
              <textarea
                className="min-h-[80px] rounded-[6px] border border-newTableBorder bg-newBgColorInner p-[10px] text-[14px]"
                maxLength={TELEGRAM_STORY_CAPTION_MAX}
                value={frame.caption || ''}
                onChange={(e) => update(item.id, { caption: e.target.value })}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default withProvider({
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: TelegramStoriesSettings,
  CustomPreviewComponent: undefined,
  dto: TelegramStoriesDto,
  maximumCharacters: TELEGRAM_STORY_CAPTION_MAX,
});
```

Check `useT`'s interpolation signature in `get.transation.service.client` and the existing `Select` usage (see `facebook.provider.tsx:55-60`) before finalizing; if `PostComment.POST` does not exist, use the value that disables comments for providers without comments (check `post-comment.enum.ts`). Add translation keys `telegram_stories_lifetime`, `telegram_stories_hours`, `telegram_stories_frame`, `telegram_stories_text_post|none|custom` (ru: «Срок жизни сторис», «{{hours}} ч», «Сторис {{number}}», «Текст поста», «Без текста», «Свой текст»).

Register in `show.all.providers.tsx`:

```tsx
import TelegramStoriesProvider from '@gitroom/frontend/components/new-launch/providers/telegram-stories/telegram.stories.provider';
// …
  {
    identifier: 'telegram-stories',
    component: TelegramStoriesProvider,
  },
```

- [ ] **Step 4: Run tests** — same command plus `apps/frontend/src/components/new-launch/providers/show.all.providers.spec.tsx`; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/new-launch/providers/ libraries/react-shared-libraries/src/translation/locales/en/translation.json libraries/react-shared-libraries/src/translation/locales/ru/translation.json
git commit -m "feat: edit Telegram story lifetime and per-frame text"
```

---

### Task 13: Full verification and documentation

**Files:**
- Modify: `docs/PROJECT.md` (channels section: Telegram Stories, flag, BotFather prerequisite, ffmpeg in image)

- [ ] **Step 1: Full test suite**

Run: `pnpm exec vitest run`
Expected: all tests pass (baseline was 1321 passed, 0 failed).

- [ ] **Step 2: Lint and typecheck from the root**

Run: `pnpm run lint` and the project typecheck script (`grep -n '"typecheck\|"lint' package.json` to find names).
Expected: no new errors.

- [ ] **Step 3: Build the production image locally**

Run: `docker build -f Dockerfile.dev -t vezdepost-stories-check .`
Then: `docker run --rm --entrypoint ffmpeg vezdepost-stories-check -hide_banner -encoders | grep libx265`
Expected: build succeeds; `libx265` encoder listed.

- [ ] **Step 4: Document** — in `docs/PROJECT.md` add: connector purpose; `TELEGRAM_STORIES_ORG_IDS`; add `telegram-stories` to `ENABLED_SOCIAL_INTEGRATIONS` if prod sets it; BotFather → Business Mode prerequisite; ffmpeg in image; manual acceptance checklist (connect personal account, publish 1 photo + 1 video, check lifetime and per-frame text, revoke the right and see reconnection).

- [ ] **Step 5: Commit**

```bash
git add docs/PROJECT.md
git commit -m "docs: describe Telegram Stories rollout"
```
