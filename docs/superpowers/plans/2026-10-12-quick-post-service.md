# Quick Post Service (mobile stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the "quick post" logic (validate each selected channel, default settings, create one post per channel, report per-channel success/failure) out of the Telegram assistant publisher into a shared `QuickPostService`, expose it as `POST /posts/quick`, and make the Telegram publisher a thin wrapper over it.

**Architecture:** `QuickPostService` lives in `libraries/nestjs-libraries/src/quick-post/` as a plain class with explicit deps (same style as `TelegramAssistantPublisher`), plus a Nest `@Injectable` wrapper registered in `DatabaseModule` so the backend controller can inject it. The Telegram publisher keeps its public interface (`listChannels`, `publish` returning `PublishResult` with names) so the router and its tests do not change; internally it downloads files and delegates to the service. The controller follows Controller → Service → (PostsService → Repository).

**Tech Stack:** NestJS 10, class-validator / class-transformer DTOs, Prisma via existing `PostsService`, vitest (run from the repo root), pnpm only.

**Spec:** `docs/superpowers/specs/2026-10-12-mobile-version-design.md`, section 5 ("Бэкенд: QuickPostService и POST /posts/quick") and row 1 of the stage table in section 7.

## Global Constraints

- Only pnpm; never npm/yarn. Tests run from the root: `pnpm vitest run <path>`.
- Backend layering: Controller >> Service >> Repository, no shortcuts. Controller code in `apps/backend`, logic in `libraries/nestjs-libraries`.
- Production with live users: the Telegram bot's observable behaviour must not change. Existing tests in `libraries/nestjs-libraries/src/telegram-assistant/*.spec.ts` must stay green without edits to `telegram.assistant.router.spec.ts`.
- Weekly upstream sync: new code in new folders; touch shared upstream files (`posts.controller.ts`, `database.module.ts`) only to add imports/registrations.
- No schema changes in this stage.
- User-facing error strings in the Telegram bot stay Russian and byte-identical to today (`'Выберите хотя бы один канал'`, `'Пустой пост'`, `'Выбранные каналы недоступны — подключите их заново'`, validation messages).
- Posts created via the quick endpoint use creation method `'WEB'`; posts created via the bot keep `'API'`.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

Inputs the spec implies but which are easy to get wrong; each has a pinned test in the owning task:

1. **`schedule.type = 'queue'` must pick a slot per channel**, not one shared slot: two channels with different posting-time settings get different dates (Task 1, test "uses a free slot per channel for queue").
2. **`schedule.type = 'date'` in the past** must be refused with a `QuickPostError`, not silently scheduled in the past (Task 1, test "refuses a date in the past").
3. **Duplicate integration ids in `integrationIds`** must create one post, not two (Task 1, test "deduplicates integration ids").
4. **A channel that is selected but belongs to another organization** must not be posted to: `activeIntegrations` is scoped by `organizationId`, so it is simply absent and reported as unavailable (Task 1, test "ignores integrations outside the organization" uses the mocked list, which already scopes by org).
5. **HTTP endpoint must reject malformed bodies** (empty `integrationIds`, media without `path`, unknown `schedule.type`) with 400 from the DTO, before any service call (Task 3, DTO validation tests).

---

### Task 1: `QuickPostService` core with tests

**Files:**
- Create: `libraries/nestjs-libraries/src/quick-post/quick.post.service.ts`
- Create: `libraries/nestjs-libraries/src/quick-post/quick.post.service.spec.ts`

**Interfaces:**
- Consumes: `PostsService.validatePosts`, `PostsService.mapTypeToPost`, `PostsService.createPost`, `PostsService.findFreeDateTime`, `IntegrationService.getIntegrationsList`, `selectPostValidationFailure` from `database/prisma/posts/post.validation`, `makeId` from `services/make.is`.
- Produces (used by Tasks 2 and 3):

```ts
export class QuickPostError extends Error {}           // message is user-facing, Russian

export type QuickPostSchedule =
  | { type: 'now' }
  | { type: 'queue' }
  | { type: 'date'; date: string };                     // ISO 8601

export type QuickPostMedia = { id: string; path: string };

export type QuickPostInput = {
  text: string;                                         // plain text; converted to <p> HTML
  media: QuickPostMedia[];
  integrationIds: string[];
  schedule: QuickPostSchedule;
};

export type QuickPostChannel = { id: string; name: string; providerIdentifier: string };

export type QuickPostResult = {
  published: Array<{ id: string; name: string }>;
  failed: Array<{ id: string; name: string; error: string }>;
};

export type QuickPostDeps = {
  integrationService: Pick<IntegrationService, 'getIntegrationsList'>;
  postsService: Pick<PostsService, 'validatePosts' | 'mapTypeToPost' | 'createPost' | 'findFreeDateTime'>;
  now?: () => Date;                                     // injectable clock, defaults to () => new Date()
};

export class QuickPostService {
  constructor(deps: QuickPostDeps);
  listChannels(organizationId: string): Promise<QuickPostChannel[]>;
  publish(organizationId: string, input: QuickPostInput, creationMethod: 'WEB' | 'API'): Promise<QuickPostResult>;
}

export const plainTextToHtml: (text: string) => string;  // moved here from telegram.assistant.draft
export const validationMessage: (item: PostValidationResult) => string | undefined;
export const errorText: (error: unknown) => string;
```

- [ ] **Step 1: Write the failing tests**

Create `libraries/nestjs-libraries/src/quick-post/quick.post.service.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { QuickPostError, QuickPostService } from './quick.post.service';

const integrations = [
  { id: 'vk-1', name: 'My VK', providerIdentifier: 'vk', disabled: false, refreshNeeded: false, inBetweenSteps: false },
  { id: 'tg-1', name: 'Channel', providerIdentifier: 'telegram', disabled: false, refreshNeeded: false, inBetweenSteps: false },
  { id: 'pin-1', name: 'Boards', providerIdentifier: 'pinterest', disabled: false, refreshNeeded: false, inBetweenSteps: false },
  { id: 'off-1', name: 'Off', providerIdentifier: 'x', disabled: true, refreshNeeded: false, inBetweenSteps: false },
  { id: 'old-1', name: 'Expired', providerIdentifier: 'x', disabled: false, refreshNeeded: true, inBetweenSteps: false },
];

const validResult = (name: string) => ({
  identifier: 'x',
  name,
  emptyContent: false,
  valid: true,
  errors: true as const,
  tooLong: false,
  maximumCharacters: 1000,
});

const media = [{ id: 'media-1', path: 'https://app.test/uploads/a.jpg' }];

const make = () => {
  const deps = {
    integrationService: { getIntegrationsList: vi.fn(async () => integrations) },
    postsService: {
      validatePosts: vi.fn(async (_org: string, posts: any[]) =>
        posts.map((post) =>
          post.integration.id === 'pin-1'
            ? { ...validResult('Boards'), valid: false, settingsError: 'Board is required' }
            : validResult(post.integration.id)
        )
      ),
      mapTypeToPost: vi.fn(async (body: any) => body),
      createPost: vi.fn(async () => [{ postId: 'p1' }]),
      findFreeDateTime: vi.fn(async (_org: string, id?: string) =>
        id === 'vk-1' ? '2026-10-13T09:00:00.000Z' : '2026-10-13T12:00:00.000Z'
      ),
    },
    now: () => new Date('2026-10-12T10:00:00.000Z'),
  };
  return { service: new QuickPostService(deps as any), deps };
};

describe('QuickPostService', () => {
  it('offers only active channels', async () => {
    const { service } = make();
    await expect(service.listChannels('org-1')).resolves.toEqual([
      { id: 'vk-1', name: 'My VK', providerIdentifier: 'vk' },
      { id: 'tg-1', name: 'Channel', providerIdentifier: 'telegram' },
      { id: 'pin-1', name: 'Boards', providerIdentifier: 'pinterest' },
    ]);
  });

  it('creates a "now" post per valid channel and reports the rest', async () => {
    const { service, deps } = make();
    const result = await service.publish(
      'org-1',
      { text: 'Hello\nworld', media, integrationIds: ['vk-1', 'tg-1', 'pin-1'], schedule: { type: 'now' } },
      'API'
    );
    expect(deps.postsService.createPost).toHaveBeenCalledTimes(2);
    const body = deps.postsService.mapTypeToPost.mock.calls[0][0];
    expect(body.type).toBe('now');
    expect(body.date).toBe('2026-10-12T10:00:00.000Z');
    expect(body.posts[0].settings).toEqual({ __type: 'vk' });
    expect(body.posts[0].value[0]).toMatchObject({ content: '<p>Hello</p><p>world</p>', image: media });
    expect(deps.postsService.createPost.mock.calls[0]).toEqual(['org-1', expect.anything(), 'API']);
    expect(result).toEqual({
      published: [{ id: 'vk-1', name: 'My VK' }, { id: 'tg-1', name: 'Channel' }],
      failed: [{ id: 'pin-1', name: 'Boards', error: 'Board is required' }],
    });
  });

  it('uses a free slot per channel for queue', async () => {
    const { service, deps } = make();
    await service.publish('org-1', { text: 'Hi', media: [], integrationIds: ['vk-1', 'tg-1'], schedule: { type: 'queue' } }, 'WEB');
    expect(deps.postsService.findFreeDateTime).toHaveBeenCalledWith('org-1', 'vk-1');
    expect(deps.postsService.findFreeDateTime).toHaveBeenCalledWith('org-1', 'tg-1');
    const [first, second] = deps.postsService.mapTypeToPost.mock.calls.map((c) => c[0]);
    expect(first).toMatchObject({ type: 'schedule', date: '2026-10-13T09:00:00.000Z' });
    expect(second).toMatchObject({ type: 'schedule', date: '2026-10-13T12:00:00.000Z' });
  });

  it('schedules at the given date', async () => {
    const { service, deps } = make();
    await service.publish('org-1', { text: 'Hi', media: [], integrationIds: ['vk-1'], schedule: { type: 'date', date: '2026-10-20T08:00:00.000Z' } }, 'WEB');
    expect(deps.postsService.mapTypeToPost.mock.calls[0][0]).toMatchObject({ type: 'schedule', date: '2026-10-20T08:00:00.000Z' });
  });

  it('refuses a date in the past', async () => {
    const { service, deps } = make();
    await expect(
      service.publish('org-1', { text: 'Hi', media: [], integrationIds: ['vk-1'], schedule: { type: 'date', date: '2026-10-01T08:00:00.000Z' } }, 'WEB')
    ).rejects.toThrow(new QuickPostError('Дата публикации уже прошла'));
    expect(deps.postsService.createPost).not.toHaveBeenCalled();
  });

  it('deduplicates integration ids', async () => {
    const { service, deps } = make();
    const result = await service.publish('org-1', { text: 'Hi', media: [], integrationIds: ['vk-1', 'vk-1'], schedule: { type: 'now' } }, 'WEB');
    expect(deps.postsService.createPost).toHaveBeenCalledTimes(1);
    expect(result.published).toEqual([{ id: 'vk-1', name: 'My VK' }]);
  });

  it('ignores integrations outside the organization or no longer active', async () => {
    const { service, deps } = make();
    const result = await service.publish('org-1', { text: 'Hi', media: [], integrationIds: ['off-1', 'old-1', 'other-org', 'vk-1'], schedule: { type: 'now' } }, 'WEB');
    expect(result.published).toEqual([{ id: 'vk-1', name: 'My VK' }]);
    expect(deps.postsService.createPost).toHaveBeenCalledTimes(1);
  });

  it('reports a channel whose post creation throws', async () => {
    const { service, deps } = make();
    deps.postsService.createPost.mockRejectedValueOnce(new Error('Boom'));
    const result = await service.publish('org-1', { text: 'Hi', media: [], integrationIds: ['vk-1', 'tg-1'], schedule: { type: 'now' } }, 'WEB');
    expect(result).toEqual({
      published: [{ id: 'tg-1', name: 'Channel' }],
      failed: [{ id: 'vk-1', name: 'My VK', error: 'Boom' }],
    });
  });

  it('shows the details of a Nest validation error', async () => {
    const { service, deps } = make();
    deps.postsService.mapTypeToPost.mockRejectedValueOnce(
      Object.assign(new Error('Bad Request Exception'), { getResponse: () => ({ message: ['date must be a valid date'] }) })
    );
    const result = await service.publish('org-1', { text: 'Hi', media: [], integrationIds: ['vk-1'], schedule: { type: 'now' } }, 'WEB');
    expect(result.failed).toEqual([{ id: 'vk-1', name: 'My VK', error: 'date must be a valid date' }]);
  });

  it.each([
    [{ text: 'Hi', media: [], integrationIds: [], schedule: { type: 'now' } }, 'Выберите хотя бы один канал'],
    [{ text: '  ', media: [], integrationIds: ['vk-1'], schedule: { type: 'now' } }, 'Пустой пост'],
    [{ text: 'Hi', media: [], integrationIds: ['off-1'], schedule: { type: 'now' } }, 'Выбранные каналы недоступны — подключите их заново'],
  ])('refuses %j', async (input, message) => {
    const { service } = make();
    await expect(service.publish('org-1', input as any, 'WEB')).rejects.toThrow(new QuickPostError(message));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run libraries/nestjs-libraries/src/quick-post/quick.post.service.spec.ts`
Expected: FAIL with "Failed to resolve import './quick.post.service'".

- [ ] **Step 3: Implement the service**

Create `libraries/nestjs-libraries/src/quick-post/quick.post.service.ts`:

```ts
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import {
  PostValidationResult,
  selectPostValidationFailure,
} from '@gitroom/nestjs-libraries/database/prisma/posts/post.validation';
import type { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import type { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

/** A problem the user can fix; its message is shown as is. */
export class QuickPostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuickPostError';
  }
}

export type QuickPostSchedule =
  | { type: 'now' }
  | { type: 'queue' }
  | { type: 'date'; date: string };

export type QuickPostMedia = { id: string; path: string };

export type QuickPostInput = {
  text: string;
  media: QuickPostMedia[];
  integrationIds: string[];
  schedule: QuickPostSchedule;
};

export type QuickPostChannel = {
  id: string;
  name: string;
  providerIdentifier: string;
};

export type QuickPostResult = {
  published: Array<{ id: string; name: string }>;
  failed: Array<{ id: string; name: string; error: string }>;
};

export type QuickPostDeps = {
  integrationService: Pick<IntegrationService, 'getIntegrationsList'>;
  postsService: Pick<
    PostsService,
    'validatePosts' | 'mapTypeToPost' | 'createPost' | 'findFreeDateTime'
  >;
  now?: () => Date;
};

// Verbatim from telegram.assistant.draft.ts: only these three characters.
const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const plainTextToHtml = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');

export const validationMessage = (item: PostValidationResult) => {
  const failure = selectPostValidationFailure([item], false);
  switch (failure?.category) {
    case 'empty-content':
      return 'пустой пост';
    case 'invalid-settings':
      return (
        item.settingsError ||
        'нужны настройки канала — опубликуйте его через app.vezdepost.ru'
      );
    case 'provider-validity':
      return String(item.errors);
    case 'too-long':
      return `слишком длинный текст (максимум ${item.maximumCharacters})`;
    case 'content-error':
      return item.contentError || 'контент не подходит для канала';
    default:
      return undefined;
  }
};

// Nest HTTP exceptions keep the useful text in their response body.
export const errorText = (error: unknown) => {
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  const message = (response as { message?: unknown } | undefined)?.message;
  if (Array.isArray(message)) {
    return message.join('; ');
  }
  if (typeof message === 'string') {
    return message;
  }
  return (error as Error)?.message || 'ошибка публикации';
};

/** Creates one dashboard post per selected channel with default settings. */
export class QuickPostService {
  constructor(private readonly deps: QuickPostDeps) {}

  private now() {
    return (this.deps.now ?? (() => new Date()))();
  }

  private async activeIntegrations(organizationId: string) {
    const integrations = await this.deps.integrationService.getIntegrationsList(
      organizationId
    );
    return integrations.filter(
      (integration) =>
        !integration.disabled &&
        !integration.refreshNeeded &&
        !integration.inBetweenSteps
    );
  }

  async listChannels(organizationId: string): Promise<QuickPostChannel[]> {
    return (await this.activeIntegrations(organizationId)).map(
      ({ id, name, providerIdentifier }) => ({ id, name, providerIdentifier })
    );
  }

  private async scheduleFor(
    organizationId: string,
    integrationId: string,
    schedule: QuickPostSchedule
  ): Promise<{ type: 'now' | 'schedule'; date: string }> {
    switch (schedule.type) {
      case 'now':
        return { type: 'now', date: this.now().toISOString() };
      case 'queue':
        return {
          type: 'schedule',
          date: await this.deps.postsService.findFreeDateTime(
            organizationId,
            integrationId
          ),
        };
      case 'date':
        return { type: 'schedule', date: schedule.date };
    }
  }

  async publish(
    organizationId: string,
    input: QuickPostInput,
    creationMethod: 'WEB' | 'API'
  ): Promise<QuickPostResult> {
    const ids = Array.from(new Set(input.integrationIds));
    if (!ids.length) {
      throw new QuickPostError('Выберите хотя бы один канал');
    }
    if (!input.text.trim() && !input.media.length) {
      throw new QuickPostError('Пустой пост');
    }
    if (
      input.schedule.type === 'date' &&
      new Date(input.schedule.date).getTime() <= this.now().getTime()
    ) {
      throw new QuickPostError('Дата публикации уже прошла');
    }

    const integrations = (await this.activeIntegrations(organizationId)).filter(
      (integration) => ids.includes(integration.id)
    );
    if (!integrations.length) {
      throw new QuickPostError(
        'Выбранные каналы недоступны — подключите их заново'
      );
    }

    const content = plainTextToHtml(input.text);
    const image = input.media.map(({ id, path }) => ({ id, path }));

    const result: QuickPostResult = { published: [], failed: [] };
    for (const integration of integrations) {
      const settings = { __type: integration.providerIdentifier };
      const channel = { id: integration.id, name: integration.name };
      try {
        const [validation] = await this.deps.postsService.validatePosts(
          organizationId,
          [{ integration: { id: integration.id }, settings, value: [{ content, image }] }]
        );
        const problem = validationMessage(validation);
        if (problem) {
          result.failed.push({ ...channel, error: problem });
          continue;
        }
        const when = await this.scheduleFor(
          organizationId,
          integration.id,
          input.schedule
        );
        const body = await this.deps.postsService.mapTypeToPost(
          {
            ...when,
            shortLink: false,
            tags: [],
            posts: [
              {
                integration,
                group: makeId(10),
                settings,
                value: [{ content, id: makeId(10), delay: 0, image }],
              },
            ],
          } as any,
          organizationId
        );
        await this.deps.postsService.createPost(
          organizationId,
          body,
          creationMethod
        );
        result.published.push(channel);
      } catch (error) {
        result.failed.push({ ...channel, error: errorText(error) });
      }
    }
    return result;
  }
}
```

Note: `escapeHtml` is copied verbatim from `telegram.assistant.draft.ts` (three replacements, no `&quot;`), so `<p>` output stays byte-identical for the bot.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run libraries/nestjs-libraries/src/quick-post/quick.post.service.spec.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/quick-post/
git commit -m "feat(quick-post): shared QuickPostService for one-post-per-channel publishing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Telegram publisher delegates to `QuickPostService`

**Files:**
- Modify: `libraries/nestjs-libraries/src/telegram-assistant/telegram.assistant.publisher.ts` (whole file)
- Modify: `libraries/nestjs-libraries/src/telegram-assistant/telegram.assistant.publisher.spec.ts` (the `make()` factory and two assertions)
- Modify: `libraries/nestjs-libraries/src/telegram-assistant/telegram.assistant.draft.ts` (re-export `plainTextToHtml`)
- Modify: `libraries/nestjs-libraries/src/telegram-assistant/telegram.assistant.module.ts` (wire the service)

**Interfaces:**
- Consumes: `QuickPostService`, `QuickPostError`, `QuickPostResult` from Task 1.
- Produces: `TelegramAssistantPublisher` keeps `listChannels(orgId): Promise<DraftChannel[]>` and `publish(orgId, draft): Promise<PublishResult>` where `PublishResult = { published: string[]; failed: {name, error}[] }` (names only). `PublishError` is kept as an alias of `QuickPostError` so `telegram.assistant.router.ts` and its spec compile unchanged. New deps shape:

```ts
export type TelegramAssistantPublisherDeps = {
  api: Pick<TelegramAssistantApi, 'downloadFile'>;
  storeFile: (buffer: Buffer, kind: DraftFile['kind']) => Promise<{ path: string; name: string }>;
  mediaService: Pick<MediaService, 'saveFile'>;
  quickPost: Pick<QuickPostService, 'listChannels' | 'publish'>;
};
```

- [ ] **Step 1: Update the publisher spec to the new deps**

In `telegram.assistant.publisher.spec.ts` replace the `make()` factory so it builds a real `QuickPostService` over the same mocks (this keeps every existing assertion meaningful):

```ts
import { QuickPostService } from '@gitroom/nestjs-libraries/quick-post/quick.post.service';

const make = () => {
  let mediaNumber = 0;
  const postsService = {
    validatePosts: vi.fn(async (_org: string, posts: any[]) =>
      posts.map((post) =>
        post.integration.id === 'pin-1'
          ? { ...validResult('Boards'), valid: false, settingsError: 'Board is required' }
          : validResult(post.integration.id)
      )
    ),
    mapTypeToPost: vi.fn(async (body: any) => body),
    createPost: vi.fn(async () => [{ postId: 'p1' }]),
    findFreeDateTime: vi.fn(async () => '2026-10-13T09:00:00.000Z'),
  };
  const deps = {
    api: { downloadFile: vi.fn(async (id: string) => Buffer.from(id)) },
    storeFile: vi.fn(async (buffer: Buffer) => ({
      path: `https://app.test/uploads/${buffer.toString()}.jpg`,
      name: `${buffer.toString()}.jpg`,
    })),
    mediaService: {
      saveFile: vi.fn(async (_org: string, name: string, path: string) => ({
        id: `media-${++mediaNumber}`,
        name,
        path,
      })),
    },
    postsService,
    quickPost: new QuickPostService({
      integrationService: { getIntegrationsList: vi.fn(async () => integrations) },
      postsService,
    } as any),
  };
  return { publisher: new TelegramAssistantPublisher(deps as any), deps };
};
```

Keep every `it(...)` block as is. They still reference `deps.postsService.*`, which now points at the same mock object the service uses, so the assertions on `mapTypeToPost` and `createPost` keep working. Add one test to pin the creation method:

```ts
  it('creates bot posts with the API creation method', async () => {
    const { publisher, deps } = make();
    await publisher.publish('org-1', { text: 'Hi', files: [], selected: ['vk-1'] });
    expect(deps.postsService.createPost.mock.calls[0][2]).toBe('API');
  });
```

- [ ] **Step 2: Run the publisher spec to verify it fails**

Run: `pnpm vitest run libraries/nestjs-libraries/src/telegram-assistant/telegram.assistant.publisher.spec.ts`
Expected: FAIL, "listChannels"/"publish" fail because the publisher still reads `deps.integrationService` which is now undefined.

- [ ] **Step 3: Rewrite the publisher as a thin wrapper**

Replace the whole of `telegram.assistant.publisher.ts` with:

```ts
import type { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import type { TelegramAssistantApi } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.api';
import {
  Draft,
  DraftChannel,
  DraftFile,
} from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.draft';
import {
  QuickPostError,
  QuickPostService,
} from '@gitroom/nestjs-libraries/quick-post/quick.post.service';

/** A problem the user can fix in Telegram; its message is shown as is. */
export const PublishError = QuickPostError;
export type PublishError = QuickPostError;

export type PublishResult = {
  published: string[];
  failed: Array<{ name: string; error: string }>;
};

export type TelegramAssistantPublisherDeps = {
  api: Pick<TelegramAssistantApi, 'downloadFile'>;
  storeFile: (
    buffer: Buffer,
    kind: DraftFile['kind']
  ) => Promise<{ path: string; name: string }>;
  mediaService: Pick<MediaService, 'saveFile'>;
  quickPost: Pick<QuickPostService, 'listChannels' | 'publish'>;
};

/** Turns a Telegram draft into dashboard posts, one per selected channel. */
export class TelegramAssistantPublisher {
  constructor(private readonly deps: TelegramAssistantPublisherDeps) {}

  listChannels(organizationId: string): Promise<DraftChannel[]> {
    return this.deps.quickPost.listChannels(organizationId);
  }

  async publish(organizationId: string, draft: Draft): Promise<PublishResult> {
    // Validate before downloading so an empty draft never touches storage.
    if (!draft.selected.length) {
      throw new PublishError('Выберите хотя бы один канал');
    }
    if (!draft.text.trim() && !draft.files.length) {
      throw new PublishError('Пустой пост');
    }

    const media = [];
    for (const file of draft.files) {
      const stored = await this.deps.storeFile(
        await this.deps.api.downloadFile(file.fileId),
        file.kind
      );
      const saved = await this.deps.mediaService.saveFile(
        organizationId,
        stored.name,
        stored.path
      );
      media.push({ id: saved.id, path: saved.path });
    }

    const result = await this.deps.quickPost.publish(
      organizationId,
      {
        text: draft.text,
        media,
        integrationIds: draft.selected,
        schedule: { type: 'now' },
      },
      'API'
    );
    return {
      published: result.published.map(({ name }) => name),
      failed: result.failed.map(({ name, error }) => ({ name, error })),
    };
  }
}
```

In `telegram.assistant.draft.ts`, delete the local `plainTextToHtml` (and `escapeHtml` if nothing else in the file uses it) and add:

```ts
export { plainTextToHtml } from '@gitroom/nestjs-libraries/quick-post/quick.post.service';
```

Check with `grep -rn "plainTextToHtml\|escapeHtml" libraries/nestjs-libraries/src/telegram-assistant/` that the draft spec still imports from `./telegram.assistant.draft` and compiles.

In `telegram.assistant.module.ts`, build the service and pass it in:

```ts
import { QuickPostService } from '@gitroom/nestjs-libraries/quick-post/quick.post.service';
// ...
      publisher: new TelegramAssistantPublisher({
        api,
        storeFile: (buffer) => storeTelegramFile(buffer, storage),
        mediaService: this._mediaService,
        quickPost: new QuickPostService({
          integrationService: this._integrationService,
          postsService: this._postsService,
        }),
      }),
```

- [ ] **Step 4: Run the whole telegram-assistant suite and the quick-post suite**

Run: `pnpm vitest run libraries/nestjs-libraries/src/telegram-assistant libraries/nestjs-libraries/src/quick-post`
Expected: PASS. `telegram.assistant.router.spec.ts` must pass without edits; `telegram.assistant.draft.spec.ts` must pass (it imports `plainTextToHtml` through the re-export).

- [ ] **Step 5: Type-check the library**

Run: `pnpm run build:backend`
Expected: build succeeds with no type errors.

- [ ] **Step 6: Commit**

```bash
git add libraries/nestjs-libraries/src/telegram-assistant/ libraries/nestjs-libraries/src/quick-post/
git commit -m "refactor(telegram-assistant): publish through QuickPostService

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `POST /posts/quick` endpoint with DTO

**Files:**
- Create: `libraries/nestjs-libraries/src/dtos/posts/quick.post.dto.ts`
- Create: `libraries/nestjs-libraries/src/quick-post/quick.post.nest.service.ts`
- Create: `apps/backend/src/api/routes/quick.post.controller.ts`
- Create: `apps/backend/src/api/routes/quick.post.controller.spec.ts`
- Create: `libraries/nestjs-libraries/src/dtos/posts/quick.post.dto.spec.ts`
- Modify: `libraries/nestjs-libraries/src/database/prisma/database.module.ts` (register the Nest service in `providers` and `exports`)
- Modify: `apps/backend/src/api/api.module.ts` (register the controller)

**Interfaces:**
- Consumes: `QuickPostService`, `QuickPostError`, `QuickPostInput` from Task 1.
- Produces:

```ts
// DTO (validated by Nest's global ValidationPipe)
export class QuickPostMediaDto { id: string; path: string }
export class QuickPostScheduleDto { type: 'now' | 'queue' | 'date'; date?: string }
export class QuickPostDto {
  text: string;                // may be empty when media present
  media: QuickPostMediaDto[];  // may be empty
  integrationIds: string[];    // min 1
  schedule: QuickPostScheduleDto;
}

// Nest-injectable wrapper
@Injectable() export class QuickPostNestService {
  constructor(postsService: PostsService, integrationService: IntegrationService);
  listChannels(organizationId: string): Promise<QuickPostChannel[]>;
  publish(organizationId: string, input: QuickPostInput, creationMethod: 'WEB' | 'API'): Promise<QuickPostResult>;
}

// HTTP
POST /posts/quick  body: QuickPostDto  → 200 QuickPostResult
                                        → 400 { message } on QuickPostError
```

The controller is a separate class `QuickPostController` mounted at `/posts` so `posts.controller.ts` (upstream file) is not touched. Nest matches `/posts/quick` on this controller because the route is static and declared on its own controller; verify in Step 5 that `GET /posts/:id/...` routes in `PostsController` do not shadow it (they are `GET`, this is `POST`, so no conflict).

- [ ] **Step 1: Write the DTO validation tests**

Create `libraries/nestjs-libraries/src/dtos/posts/quick.post.dto.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QuickPostDto } from './quick.post.dto';

const check = async (body: unknown) =>
  validate(plainToInstance(QuickPostDto, body), { whitelist: true, forbidNonWhitelisted: true });

const valid = {
  text: 'Hi',
  media: [{ id: 'm1', path: 'https://app.test/uploads/a.jpg' }],
  integrationIds: ['vk-1'],
  schedule: { type: 'now' },
};

describe('QuickPostDto', () => {
  it('accepts a valid body', async () => {
    expect(await check(valid)).toEqual([]);
  });

  it('accepts empty text with media and empty media with text', async () => {
    expect(await check({ ...valid, text: '' })).toEqual([]);
    expect(await check({ ...valid, media: [] })).toEqual([]);
  });

  it('rejects an empty integration list', async () => {
    const errors = await check({ ...valid, integrationIds: [] });
    expect(errors.map((e) => e.property)).toEqual(['integrationIds']);
  });

  it('rejects media without a path', async () => {
    const errors = await check({ ...valid, media: [{ id: 'm1' }] });
    expect(errors.map((e) => e.property)).toEqual(['media']);
  });

  it('rejects an unknown schedule type', async () => {
    const errors = await check({ ...valid, schedule: { type: 'later' } });
    expect(errors.map((e) => e.property)).toEqual(['schedule']);
  });

  it('requires a date for schedule type date', async () => {
    const errors = await check({ ...valid, schedule: { type: 'date' } });
    expect(errors.map((e) => e.property)).toEqual(['schedule']);
    expect(await check({ ...valid, schedule: { type: 'date', date: '2026-10-20T08:00:00.000Z' } })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the DTO tests to verify they fail**

Run: `pnpm vitest run libraries/nestjs-libraries/src/dtos/posts/quick.post.dto.spec.ts`
Expected: FAIL, cannot resolve `./quick.post.dto`.

- [ ] **Step 3: Write the DTO**

Create `libraries/nestjs-libraries/src/dtos/posts/quick.post.dto.ts`:

```ts
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsDefined,
  IsIn,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class QuickPostMediaDto {
  @IsDefined()
  @IsString()
  id: string;

  @IsDefined()
  @IsString()
  path: string;
}

export class QuickPostScheduleDto {
  @IsDefined()
  @IsIn(['now', 'queue', 'date'])
  type: 'now' | 'queue' | 'date';

  @ValidateIf((o) => o.type === 'date')
  @IsDefined()
  @IsDateString()
  date?: string;
}

export class QuickPostDto {
  @IsDefined()
  @IsString()
  text: string;

  @IsDefined()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuickPostMediaDto)
  media: QuickPostMediaDto[];

  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  integrationIds: string[];

  @IsDefined()
  @ValidateNested()
  @Type(() => QuickPostScheduleDto)
  schedule: QuickPostScheduleDto;
}
```

- [ ] **Step 4: Run the DTO tests to verify they pass**

Run: `pnpm vitest run libraries/nestjs-libraries/src/dtos/posts/quick.post.dto.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the controller test**

Create `apps/backend/src/api/routes/quick.post.controller.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { QuickPostController } from './quick.post.controller';
import { QuickPostError } from '@gitroom/nestjs-libraries/quick-post/quick.post.service';

const org = { id: 'org-1' } as any;

const body = {
  text: 'Hi',
  media: [],
  integrationIds: ['vk-1'],
  schedule: { type: 'now' as const },
};

describe('QuickPostController', () => {
  it('publishes through the service with the WEB creation method', async () => {
    const service = { publish: vi.fn().mockResolvedValue({ published: [], failed: [] }) };
    const controller = new QuickPostController(service as any);

    await expect(controller.publish(org, body)).resolves.toEqual({ published: [], failed: [] });
    expect(service.publish).toHaveBeenCalledWith('org-1', body, 'WEB');
  });

  it('turns a QuickPostError into 400 with its message', async () => {
    const service = { publish: vi.fn().mockRejectedValue(new QuickPostError('Пустой пост')) };
    const controller = new QuickPostController(service as any);

    await expect(controller.publish(org, body)).rejects.toThrow(new BadRequestException('Пустой пост'));
  });

  it('lets unexpected errors through untouched', async () => {
    const service = { publish: vi.fn().mockRejectedValue(new Error('db down')) };
    const controller = new QuickPostController(service as any);

    await expect(controller.publish(org, body)).rejects.toThrow('db down');
  });
});
```

- [ ] **Step 6: Run the controller test to verify it fails**

Run: `pnpm vitest run apps/backend/src/api/routes/quick.post.controller.spec.ts`
Expected: FAIL, cannot resolve `./quick.post.controller`.

- [ ] **Step 7: Write the Nest service wrapper, controller, and registrations**

Create `libraries/nestjs-libraries/src/quick-post/quick.post.nest.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import {
  QuickPostChannel,
  QuickPostInput,
  QuickPostResult,
  QuickPostService,
} from '@gitroom/nestjs-libraries/quick-post/quick.post.service';

/** Nest-injectable facade over the dependency-free QuickPostService. */
@Injectable()
export class QuickPostNestService {
  private readonly service: QuickPostService;

  constructor(postsService: PostsService, integrationService: IntegrationService) {
    this.service = new QuickPostService({ postsService, integrationService });
  }

  listChannels(organizationId: string): Promise<QuickPostChannel[]> {
    return this.service.listChannels(organizationId);
  }

  publish(
    organizationId: string,
    input: QuickPostInput,
    creationMethod: 'WEB' | 'API'
  ): Promise<QuickPostResult> {
    return this.service.publish(organizationId, input, creationMethod);
  }
}
```

Create `apps/backend/src/api/routes/quick.post.controller.ts`:

```ts
import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { QuickPostDto } from '@gitroom/nestjs-libraries/dtos/posts/quick.post.dto';
import { QuickPostNestService } from '@gitroom/nestjs-libraries/quick-post/quick.post.nest.service';
import { QuickPostError } from '@gitroom/nestjs-libraries/quick-post/quick.post.service';

@ApiTags('Posts')
@Controller('/posts')
export class QuickPostController {
  constructor(private _quickPost: QuickPostNestService) {}

  /** One post per selected channel with default settings (mobile and bots). */
  @Post('/quick')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async publish(@GetOrgFromRequest() org: Organization, @Body() body: QuickPostDto) {
    try {
      return await this._quickPost.publish(
        org.id,
        {
          text: body.text,
          media: body.media,
          integrationIds: body.integrationIds,
          schedule:
            body.schedule.type === 'date'
              ? { type: 'date', date: body.schedule.date! }
              : { type: body.schedule.type },
        },
        'WEB'
      );
    } catch (error) {
      if (error instanceof QuickPostError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
```

The `AuthorizationActions` / `Sections` import path above is the one `posts.controller.ts` already uses.

In `libraries/nestjs-libraries/src/database/prisma/database.module.ts`: add `import { QuickPostNestService } from '@gitroom/nestjs-libraries/quick-post/quick.post.nest.service';` and add `QuickPostNestService` to both the `providers` array and the `exports` array (after `TelegramAssistantLinkService`).

In `apps/backend/src/api/api.module.ts`: add `import { QuickPostController } from '@gitroom/backend/api/routes/quick.post.controller';` and add `QuickPostController` to the controllers list right after `PostsController`.

- [ ] **Step 8: Run the controller tests and the full affected suites**

Run: `pnpm vitest run apps/backend/src/api/routes/quick.post.controller.spec.ts libraries/nestjs-libraries/src/quick-post libraries/nestjs-libraries/src/telegram-assistant libraries/nestjs-libraries/src/dtos/posts`
Expected: PASS.

- [ ] **Step 9: Build the backend to prove DI wiring compiles**

Run: `pnpm run build:backend`
Expected: build succeeds (this compiles the DI graph, so a missing provider registration fails here).

- [ ] **Step 10: Smoke-test the route table**

Add a test that compiles the API module's controllers list contains the new controller, in `apps/backend/src/api/routes/quick.post.controller.spec.ts`:

```ts
import { ApiModule } from '@gitroom/backend/api/api.module';

it('is registered in the API module', () => {
  const controllers: unknown[] = Reflect.getMetadata('controllers', ApiModule);
  expect(controllers).toContain(QuickPostController);
});
```

If importing `ApiModule` in vitest pulls in heavy providers and fails on environment variables, drop this test and instead verify with `grep -n QuickPostController apps/backend/src/api/api.module.ts` showing both the import and the list entry, and note that in the commit body.

Run: `pnpm vitest run apps/backend/src/api/routes/quick.post.controller.spec.ts`
Expected: PASS.

- [ ] **Step 11: Lint from the root**

Run: `pnpm run lint` (lint only works from the root per CLAUDE.md). If the repo's lint script lints only changed packages, run it as is.
Expected: no new errors in the files touched.

- [ ] **Step 12: Commit**

```bash
git add libraries/nestjs-libraries/src/dtos/posts/quick.post.dto.ts libraries/nestjs-libraries/src/dtos/posts/quick.post.dto.spec.ts libraries/nestjs-libraries/src/quick-post/quick.post.nest.service.ts libraries/nestjs-libraries/src/database/prisma/database.module.ts apps/backend/src/api/routes/quick.post.controller.ts apps/backend/src/api/routes/quick.post.controller.spec.ts apps/backend/src/api/api.module.ts
git commit -m "feat(posts): POST /posts/quick for one-post-per-channel publishing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Docs and handoff

**Files:**
- Modify: `docs/PROJECT.md` (add a short "Quick post API" note in the backend section)
- Modify: `docs/superpowers/specs/2026-10-12-mobile-version-design.md` (mark stage 1 row as "done, commit <sha>")

- [ ] **Step 1: Document the endpoint**

Append to the backend/API part of `docs/PROJECT.md`:

```markdown
### Quick post API

`POST /posts/quick` creates one post per selected channel with default
provider settings. Body: `{ text, media: [{id, path}], integrationIds, schedule: {type: 'now'|'queue'|'date', date?} }`.
Response: `{ published: [{id, name}], failed: [{id, name, error}] }`.
Logic lives in `libraries/nestjs-libraries/src/quick-post/`; the Telegram
assistant bot publishes through the same service with creation method `API`.
Spec: `docs/superpowers/specs/2026-10-12-mobile-version-design.md`.
```

- [ ] **Step 2: Update the spec's stage table**

In the stage table in section 7 of the spec, change the first row's "Результат" cell to start with `Готово (коммит <sha of Task 3 commit>).`

- [ ] **Step 3: Run the complete test suite once**

Run: `pnpm vitest run`
Expected: PASS (same pass count as before plus the new tests; any pre-existing failures unrelated to these files must be listed in the final report, not fixed here).

- [ ] **Step 4: Commit**

```bash
git add docs/PROJECT.md docs/superpowers/specs/2026-10-12-mobile-version-design.md
git commit -m "docs: quick post API and stage 1 status

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
