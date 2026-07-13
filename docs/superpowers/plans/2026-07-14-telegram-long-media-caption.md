# Telegram Long Media Caption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Telegram media followed by a separate full-text message when the normalized caption exceeds 1024 characters, and warn the user before publishing.

**Architecture:** A dependency-light shared helper owns Telegram's 1024-character caption boundary and split decision. `TelegramProvider` uses that decision after HTML normalization to choose captioned media or captionless media followed by text; a Telegram-specific preview component uses the same decision to render a non-blocking warning while retaining the overall 4096-character maximum.

**Tech Stack:** TypeScript, React 19, NestJS shared libraries, `node-telegram-bot-api`, Vitest, PNPM.

## Global Constraints

- Text-only Telegram posts keep the 4096-character maximum.
- Media captions use the Telegram limit of 1024 visible characters.
- Long text is sent complete after the media/album and is never split or discarded.
- The release URL points to the first media message.
- No MAX or other provider behavior changes.
- Preserve all existing uncommitted LinkedIn and DevOps work.

---

### Task 1: Shared Telegram delivery decision

**Files:**
- Create: `libraries/helpers/src/utils/telegram.constraints.ts`
- Test: `libraries/helpers/src/utils/telegram.constraints.spec.ts`

**Interfaces:**
- Produces: `TELEGRAM_MEDIA_CAPTION_MAX_LENGTH: 1024`.
- Produces: `shouldSendTelegramTextSeparately(visibleTextLength: number, mediaCount: number): boolean`.
- Consumed by: backend sender and frontend warning in Tasks 2 and 3.

- [ ] **Step 1: Write the failing unit tests**

```ts
import {
  TELEGRAM_MEDIA_CAPTION_MAX_LENGTH,
  shouldSendTelegramTextSeparately,
} from './telegram.constraints';

describe('shouldSendTelegramTextSeparately', () => {
  it('keeps text-only posts in one message', () => {
    expect(shouldSendTelegramTextSeparately(1545, 0)).toBe(false);
  });

  it('keeps a 1024-character media caption attached', () => {
    expect(
      shouldSendTelegramTextSeparately(
        TELEGRAM_MEDIA_CAPTION_MAX_LENGTH,
        1
      )
    ).toBe(false);
  });

  it('splits media from text above 1024 characters', () => {
    expect(
      shouldSendTelegramTextSeparately(
        TELEGRAM_MEDIA_CAPTION_MAX_LENGTH + 1,
        1
      )
    ).toBe(true);
  });

  it('applies the same rule to albums', () => {
    expect(shouldSendTelegramTextSeparately(1545, 3)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run libraries/helpers/src/utils/telegram.constraints.spec.ts`

Expected: FAIL because `telegram.constraints.ts` does not exist.

- [ ] **Step 3: Implement the shared constraint**

```ts
export const TELEGRAM_MEDIA_CAPTION_MAX_LENGTH = 1024;

export const shouldSendTelegramTextSeparately = (
  visibleTextLength: number,
  mediaCount: number
) =>
  mediaCount > 0 && visibleTextLength > TELEGRAM_MEDIA_CAPTION_MAX_LENGTH;
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm exec vitest run libraries/helpers/src/utils/telegram.constraints.spec.ts`

Expected: 4 tests PASS.

- [ ] **Step 5: Commit the shared rule**

```bash
git add libraries/helpers/src/utils/telegram.constraints.ts libraries/helpers/src/utils/telegram.constraints.spec.ts
git commit -m "test: define Telegram media caption split rule"
```

---

### Task 2: Telegram provider sends captionless media then full text

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social/telegram.provider.ts:16-251`
- Test: `libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts`

**Interfaces:**
- Consumes: `shouldSendTelegramTextSeparately(visibleTextLength, mediaCount)` from Task 1.
- Produces: an optional constructor dependency `TelegramProvider(botClient?)` used only for deterministic tests; production continues to use the module-level bot.
- Preserves: `post(): Promise<PostResponse[]>` and `comment(): Promise<PostResponse[]>` public contracts.

- [ ] **Step 1: Add a test seam and failing provider tests**

Use a minimal fake bot passed to `new TelegramProvider(bot as any)`. The tests call `provider.post('channel', '-1001', [details])` and assert calls and order.

```ts
const media = [{ id: 'media', path: 'https://cdn.test/photo.jpg' }];
const details = (message: string, files = media) => [
  { id: 'post-1', message, media: files, settings: {} } as any,
];

const makeBot = () => {
  const calls: string[] = [];
  return {
    calls,
    bot: {
      sendPhoto: vi.fn(async (_chat, _media, options) => {
        calls.push(`photo:${String(options.caption)}`);
        return { message_id: 41 };
      }),
      sendMediaGroup: vi.fn(async (_chat, group) => {
        calls.push(`album:${String(group[0].caption)}`);
        return [{ message_id: 51 }];
      }),
      sendMessage: vi.fn(async (_chat, text) => {
        calls.push(`text:${text}`);
        return { message_id: 42 };
      }),
    },
  };
};
```

Cover these assertions:

```ts
expect(calls).toEqual([`photo:${shortText}`]);
expect(calls).toEqual(['photo:undefined', `text:${longText}`]);
expect(calls).toEqual([`album:${shortText}`]);
expect(calls).toEqual(['album:undefined', `text:${longText}`]);
expect(result[0].postId).toBe('41');
expect(result[0].releaseURL).toContain('/41');
```

Also make `sendPhoto` reject and assert `sendMessage` is not called; make the second `sendMessage` reject and assert `post()` rejects.

- [ ] **Step 2: Run the provider test and verify RED**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts`

Expected: FAIL because `TelegramProvider` does not accept the fake bot and sends long text as a caption.

- [ ] **Step 3: Inject the bot client without changing production construction**

Add a private bot field and default it to the existing module bot:

```ts
type TelegramBotClient = Pick<
  TelegramBot,
  | 'getChat'
  | 'getFileLink'
  | 'getUpdates'
  | 'getMe'
  | 'deleteMessage'
  | 'sendMessage'
  | 'sendVideo'
  | 'sendPhoto'
  | 'sendDocument'
  | 'sendMediaGroup'
  | 'getChatMember'
>;

export class TelegramProvider extends SocialAbstract implements SocialProvider {
  constructor(private readonly botClient: TelegramBotClient = telegramBot) {
    super();
  }
```

Replace calls from `telegramBot.<method>` to `this.botClient.<method>` throughout the class. Do not change method arguments or authentication behavior.

- [ ] **Step 4: Implement conditional caption/text delivery**

After normalizing `text`, calculate visible length without Telegram HTML tags and choose the mode:

```ts
const sendTextSeparately = shouldSendTelegramTextSeparately(
  striptags(text).length,
  processedMedia.length
);
const caption = sendTextSeparately ? undefined : text;
```

Use `caption` in the single-media and media-group options. Preserve the first media message ID before sending the separate text:

```ts
if (sendTextSeparately) {
  await this.botClient.sendMessage(accessToken, text, {
    parse_mode: 'HTML',
  });
}

return messageId;
```

The separate text call occurs only after every media group succeeds. For comments, pass `reply_to_message_id` to the media/album exactly as today; the follow-up text does not reply to the parent because it is the second half of the new publication.

- [ ] **Step 5: Run provider and shared tests**

Run: `pnpm exec vitest run libraries/helpers/src/utils/telegram.constraints.spec.ts libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts`

Expected: all tests PASS, including media-failure and text-failure propagation.

- [ ] **Step 6: Commit backend behavior**

```bash
git add libraries/nestjs-libraries/src/integrations/social/telegram.provider.ts libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts
git commit -m "feat: split long Telegram media captions"
```

---

### Task 3: Non-blocking warning in the Telegram preview

**Files:**
- Create: `apps/frontend/src/components/new-launch/providers/telegram/telegram.preview.tsx`
- Create: `apps/frontend/src/components/new-launch/providers/telegram/telegram.preview.spec.ts`
- Modify: `apps/frontend/src/components/new-launch/providers/telegram/telegram.provider.tsx:1-15`

**Interfaces:**
- Consumes: `shouldSendTelegramTextSeparately(visibleTextLength, mediaCount)` from Task 1.
- Produces: `TelegramPreview`, a provider-specific wrapper around `GeneralPreviewComponent`.
- Produces: `shouldShowTelegramSplitWarning(posts): boolean`, the pure visibility function used by tests and the component.

- [ ] **Step 1: Write failing warning-visibility tests**

```ts
import { shouldShowTelegramSplitWarning } from './telegram.preview';

const post = (content: string, image: Array<{ path: string }> = []) => ({
  content,
  image,
});

describe('shouldShowTelegramSplitWarning', () => {
  it('is hidden for text-only posts', () => {
    expect(shouldShowTelegramSplitWarning([post('x'.repeat(1545))])).toBe(false);
  });

  it('is hidden at the caption boundary', () => {
    expect(
      shouldShowTelegramSplitWarning([
        post('x'.repeat(1024), [{ path: 'photo.jpg' }]),
      ])
    ).toBe(false);
  });

  it('is visible above the boundary when media exists', () => {
    expect(
      shouldShowTelegramSplitWarning([
        post('<p>' + 'x'.repeat(1025) + '</p>', [{ path: 'photo.jpg' }]),
      ])
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run the frontend test and verify RED**

Run: `pnpm exec vitest run apps/frontend/src/components/new-launch/providers/telegram/telegram.preview.spec.ts`

Expected: FAIL because `telegram.preview.tsx` does not exist.

- [ ] **Step 3: Implement the warning component**

Create `TelegramPreview` using `useIntegration()`. Normalize each entry with `stripHtmlValidation('normal', content, true)`, count its media, and call the shared decision helper. Render the existing preview unchanged, followed by the warning only when any post requires a split:

```tsx
export const TelegramPreview: FC<{ maximumCharacters?: number }> = (props) => {
  const { value } = useIntegration();
  const showWarning = shouldShowTelegramSplitWarning(value);

  return (
    <>
      <GeneralPreviewComponent {...props} />
      {showWarning && (
        <div className="mx-[15px] mb-[15px] rounded-md border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200">
          Telegram ограничивает подпись к медиа 1024 символами. Медиа и текст
          будут опубликованы двумя отдельными сообщениями.
        </div>
      )}
    </>
  );
};
```

Keep `maximumCharacters: 4096` in `telegram.provider.tsx` and change only:

```ts
CustomPreviewComponent: TelegramPreview,
```

- [ ] **Step 4: Run warning and delivery tests**

Run: `pnpm exec vitest run libraries/helpers/src/utils/telegram.constraints.spec.ts libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts apps/frontend/src/components/new-launch/providers/telegram/telegram.preview.spec.ts`

Expected: all tests PASS.

- [ ] **Step 5: Run project verification**

Run: `pnpm exec prettier --check libraries/helpers/src/utils/telegram.constraints.ts libraries/helpers/src/utils/telegram.constraints.spec.ts libraries/nestjs-libraries/src/integrations/social/telegram.provider.ts libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts apps/frontend/src/components/new-launch/providers/telegram/telegram.provider.tsx apps/frontend/src/components/new-launch/providers/telegram/telegram.preview.tsx apps/frontend/src/components/new-launch/providers/telegram/telegram.preview.spec.ts`

Expected: all files use Prettier formatting. If the check fails, run the same command with `--write`, then rerun `--check`.

Run: `pnpm run build:backend`

Expected: backend build succeeds.

Run: `pnpm run build:frontend`

Expected: frontend build succeeds.

- [ ] **Step 6: Commit frontend warning**

```bash
git add apps/frontend/src/components/new-launch/providers/telegram/telegram.provider.tsx apps/frontend/src/components/new-launch/providers/telegram/telegram.preview.tsx apps/frontend/src/components/new-launch/providers/telegram/telegram.preview.spec.ts
git commit -m "feat: warn when Telegram splits media and text"
```

---

### Task 4: Final regression review

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Consumes: all Task 1–3 behavior.
- Produces: evidence that the feature works without touching unrelated dirty files.

- [ ] **Step 1: Review the final scoped diff**

Run: `git diff HEAD~3 -- libraries/helpers/src/utils/telegram.constraints.ts libraries/helpers/src/utils/telegram.constraints.spec.ts libraries/nestjs-libraries/src/integrations/social/telegram.provider.ts libraries/nestjs-libraries/src/integrations/social/telegram.provider.spec.ts apps/frontend/src/components/new-launch/providers/telegram/telegram.provider.tsx apps/frontend/src/components/new-launch/providers/telegram/telegram.preview.tsx apps/frontend/src/components/new-launch/providers/telegram/telegram.preview.spec.ts`

Expected: only the shared rule, Telegram provider behavior, warning UI, and tests are present.

- [ ] **Step 2: Confirm unrelated work remains untouched**

Run: `git status --short`

Expected: the pre-existing LinkedIn edits and untracked DevOps files remain present and are not included in Telegram commits.

- [ ] **Step 3: Report verification**

Record the focused test count, backend/frontend build results, and any unrelated pre-existing working-tree changes in the final handoff.
