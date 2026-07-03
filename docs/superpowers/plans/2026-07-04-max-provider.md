Project: postiz-app
Document: implementation-plan

# MAX Messenger Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Russian messenger MAX as a fully connectable, publishable Postiz social provider, modeled on the Telegram "bot-admin in channel" flow.

**Architecture:** MAX reuses Postiz's existing "web3" custom-connect flow (`isWeb3 = true`, same as Telegram): a bot is added as admin to a channel, the user posts `/connect <word>`, a backend polling endpoint catches it via the MAX SDK and resolves the channel `chat_id`, which is stored as the integration's `accessToken`. Publishing uploads media via the SDK and sends one message per post through `sendMessageToChat`.

**Tech Stack:** NestJS (backend + libraries), Vite/React (frontend), TypeScript, `@maxhub/max-bot-api` SDK, pnpm monorepo (nx), Prisma.

## Global Constraints

- **pnpm only** — never npm/yarn. Add deps with `pnpm add` at repo root.
- **Lint runs only from repo root.**
- **Commits in English.**
- **No push, no PR** — the plan stops at "show the diff to the user."
- **Base branch:** `feat/max-provider` (already created; `upstream` = gitroomhq/postiz-app already added).
- **API client:** the official `@maxhub/max-bot-api` SDK. Do not hand-roll `fetch` to `platform-api*.max.ru` and do not use `?access_token=` query auth.
- **Provider layering:** backend logic lives in `libraries/nestjs-libraries`; the backend controller only wires it.
- **Production safety:** MAX registration must not throw at import time when `MAX_TOKEN` is unset (other providers must keep loading).

## Testing Approach (read before starting)

This repo has **no unit tests for social providers** (`jest.config.ts` only aggregates nx projects; there is no `*.provider.spec.ts` anywhere). The established verification pattern for a provider is **typecheck + build + lint + a manual runtime test**, not Jest. This plan follows that pattern: each task's gate is a build/lint command, and the final runtime test (create a MAX bot, connect a channel, publish) is user-performed because it needs a real `@MasterBot` token and channel. Do **not** introduce an SDK-mocking Jest harness — it would be a new, unsupported pattern.

## SDK field names to confirm on install (one lookup, used by Task 2)

After `pnpm add` (Task 1), open the SDK's type declarations under
`node_modules/@maxhub/max-bot-api/` and confirm these accessors the provider relies on. The MAX Bot API wire schema (from the official Go/PHP clients) is:
- Incoming message update (`message_created`): `update.message.body.text`, `update.message.body.mid`, `update.message.recipient.chat_id`.
- Send response `Message`: `message.body.mid`.
- Reply link on send: `link: { type: 'reply', mid: '<mid>' }`.
- Methods are on `bot.api.*` (`getUpdates`, `sendMessageToChat`, `uploadImage`, `uploadVideo`, `getChat`). If the SDK exposes them directly on the `Bot` instance, drop the `.api`.
- `getUpdates(types, extra)` pagination cursor is `marker`.

If any typed field differs, adjust the three/four accessors in Task 2 accordingly — the control flow does not change.

---

## File Structure

**New files:**
- `libraries/nestjs-libraries/src/integrations/social/max.provider.ts` — the provider (auth + connect polling + publish + comment).
- `apps/frontend/src/components/launches/web3/providers/max.provider.tsx` — the connect screen.
- `apps/frontend/public/icons/platforms/max.png` — UI icon (placeholder until the real logo is supplied).

**Modified files:**
- `libraries/nestjs-libraries/src/integrations/integration.manager.ts` — register `new MaxProvider()`.
- `apps/backend/src/api/routes/integrations.controller.ts` — add `GET /max/updates`.
- `apps/frontend/src/components/launches/web3/web3.list.tsx` — register the `max` component.
- `libraries/react-shared-libraries/src/helpers/variable.context.tsx` — add `maxBotName`.
- `apps/frontend/src/app/(app)/layout.tsx`, `(provider)/layout.tsx`, `(extension)/layout.tsx` — pass `maxBotName`.
- `.env.example`, `docker-compose.yaml` — `MAX_TOKEN`, `MAX_BOT_NAME`.

---

## Task 1: Add the MAX SDK dependency

**Files:**
- Modify: `package.json` (root, via pnpm)

**Interfaces:**
- Produces: the `@maxhub/max-bot-api` module (exporting `Bot`) available to Task 2.

- [ ] **Step 1: Add the dependency**

Run:
```bash
pnpm add @maxhub/max-bot-api
```
Expected: install succeeds; `@maxhub/max-bot-api` appears under `dependencies` in root `package.json`; `pnpm-lock.yaml` updated.

- [ ] **Step 2: Verify it resolves and exports `Bot`**

Run:
```bash
node -e "const m = require('@maxhub/max-bot-api'); console.log(typeof m.Bot)"
```
Expected: prints `function` (if it prints `undefined`, the export is a default or namespaced — note the actual export shape for Task 2's import).

- [ ] **Step 3: Confirm SDK field names**

Open `node_modules/@maxhub/max-bot-api/` type declarations (`*.d.ts`) and confirm the accessors listed in "SDK field names to confirm on install" above. Note any deviations for Task 2.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add @maxhub/max-bot-api dependency"
```

---

## Task 2: Backend MAX provider

**Files:**
- Create: `libraries/nestjs-libraries/src/integrations/social/max.provider.ts`

**Interfaces:**
- Consumes: `@maxhub/max-bot-api` (`Bot`); `SocialAbstract` (provides default `checkValidity` and `maxConcurrentJob`); `SocialProvider`, `AuthTokenDetails`, `PostDetails`, `PostResponse` from `social.integrations.interface`; `MediaContent.type` is already `'image' | 'video'` (no MIME sniffing needed).
- Produces: `class MaxProvider` with `identifier = 'max'`, and public methods:
  - `getBotId(query: { id?: number; word: string }): Promise<{ chatId: number } | { lastChatId: number } | {}>` — consumed by Task 3's controller.
  - `generateAuthUrl()`, `authenticate()`, `post()`, `comment()`, `refreshToken()`, `maxLength()`.

- [ ] **Step 1: Create the provider file**

Create `libraries/nestjs-libraries/src/integrations/social/max.provider.ts`:

```ts
import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import dayjs from 'dayjs';
import { SocialAbstract } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { Integration } from '@prisma/client';
import striptags from 'striptags';
import { Bot } from '@maxhub/max-bot-api';

// Bot token is permanent (like Telegram's). Constructing with an unset token
// must not throw at import time so other providers keep loading.
const bot = new Bot(process.env.MAX_TOKEN || '');
const frontendURL = process.env.FRONTEND_URL || 'http://localhost:5000';

export class MaxProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 3; // ~30 rps API limit; keep concurrency moderate
  identifier = 'max';
  name = 'MAX';
  isBetweenSteps = false;
  isWeb3 = true; // routes the "Add channel" UI to the web3 custom-connect component
  scopes = [] as string[]; // bot token; no OAuth scopes
  editor = 'html' as const;

  maxLength() {
    return 4000;
  }

  // Token is permanent — no refresh, mirrors TelegramProvider.
  async refreshToken(): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  async generateAuthUrl() {
    const state = makeId(17);
    return { url: state, codeVerifier: makeId(10), state };
  }

  // Long-poll the bot's updates for a "/connect <word>" message in the channel.
  // Returns { chatId } on match, { lastChatId } to advance the poll cursor, or {}.
  async getBotId(query: { id?: number; word: string }) {
    const updates: any = await bot.api.getUpdates(
      ['message_created'],
      query.id ? { marker: query.id } : {}
    );

    const list: any[] = Array.isArray(updates) ? updates : updates?.updates || [];

    const match = list.find(
      (u) => u?.message?.body?.text === `/connect ${query.word}`
    );
    const chatId = match?.message?.recipient?.chat_id;

    if (chatId) {
      return { chatId };
    }

    const marker =
      (updates && !Array.isArray(updates) && updates.marker) ||
      list[list.length - 1]?.marker;

    return marker ? { lastChatId: marker } : {};
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const chat: any = await bot.api.getChat(Number(params.code));

    return {
      id: String(chat?.chat_id ?? params.code),
      name: chat?.title ?? 'MAX Channel',
      accessToken: String(params.code), // store chat_id as accessToken (like Telegram)
      refreshToken: '',
      expiresIn: dayjs().add(200, 'year').unix() - dayjs().unix(),
      picture: chat?.icon?.url ?? '',
      username: chat?.link ?? '',
    };
  }

  private normalizeText(message: string) {
    return striptags(message || '', ['b', 'strong', 'i', 'u', 'a', 'p'])
      .replace(/<strong>/g, '<b>')
      .replace(/<\/strong>/g, '</b>')
      .replace(/<p>(.*?)<\/p>/g, '$1\n');
  }

  private async buildAttachments(media: PostDetails['media']) {
    const files = media || [];
    const attachments: any[] = [];
    for (const m of files) {
      // Local-storage paths are relative; make them absolute for the SDK upload.
      const url = m.path.startsWith('http') ? m.path : `${frontendURL}${m.path}`;
      const attachment =
        m.type === 'video'
          ? await bot.api.uploadVideo({ url })
          : await bot.api.uploadImage({ url });
      attachments.push(attachment);
    }
    return attachments;
  }

  async post(
    id: string,
    accessToken: string, // = chat_id of the channel
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const attachments = await this.buildAttachments(firstPost.media);

    const message: any = await bot.api.sendMessageToChat(
      Number(accessToken),
      this.normalizeText(firstPost.message),
      {
        format: 'html',
        ...(attachments.length ? { attachments } : {}),
      }
    );

    const messageId = message?.body?.mid ?? message?.mid;

    return [
      {
        id: firstPost.id,
        postId: String(messageId),
        releaseURL: `https://max.ru/${id}`,
        status: 'completed',
      },
    ];
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;
    const replyMid = lastCommentId || postId;
    const attachments = await this.buildAttachments(commentPost.media);

    const message: any = await bot.api.sendMessageToChat(
      Number(accessToken),
      this.normalizeText(commentPost.message),
      {
        format: 'html',
        link: { type: 'reply', mid: replyMid },
        ...(attachments.length ? { attachments } : {}),
      }
    );

    const messageId = message?.body?.mid ?? message?.mid;

    return [
      {
        id: commentPost.id,
        postId: String(messageId),
        releaseURL: `https://max.ru/${id}`,
        status: 'completed',
      },
    ];
  }
}
```

- [ ] **Step 2: Reconcile with the SDK types confirmed in Task 1**

If any accessor from "SDK field names to confirm on install" differed (e.g. methods on `bot` not `bot.api`, or upload option shape is `{ source }` not `{ url }`), edit the corresponding lines now. Control flow stays the same.

- [ ] **Step 3: Typecheck the library compiles**

Run:
```bash
npx tsc --noEmit -p libraries/nestjs-libraries/tsconfig.lib.json 2>&1 | grep -i "max.provider" || echo "no max.provider type errors"
```
Expected: `no max.provider type errors` (if the lib has no such tsconfig, fall back to the Task 6 full build; the point is zero type errors in `max.provider.ts`).

- [ ] **Step 4: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/social/max.provider.ts
git commit -m "feat: add MAX provider (auth, connect polling, post, comment)"
```

---

## Task 3: Register the provider and add the connect endpoint

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/integration.manager.ts`
- Modify: `apps/backend/src/api/routes/integrations.controller.ts`

**Interfaces:**
- Consumes: `MaxProvider` and its `getBotId(query)` from Task 2.
- Produces: `GET /integrations/max/updates?word=<word>&id=<marker?>` returning the shape Task 4's frontend polls (`{ chatId } | { lastChatId } | {}`).

- [ ] **Step 1: Import and register the provider**

In `libraries/nestjs-libraries/src/integrations/integration.manager.ts`, add the import alongside the other social-provider imports:

```ts
import { MaxProvider } from '@gitroom/nestjs-libraries/integrations/social/max.provider';
```

Then in the `socialIntegrationList` array, add `new MaxProvider()` right after `new TelegramProvider()` (and near `new VkProvider()`):

```ts
  new TelegramProvider(),
  new MaxProvider(),
  new NostrProvider(),
  new VkProvider(),
```

(Match the existing import style — confirm whether the file uses `@gitroom/...` aliases or relative paths for these imports and follow it.)

- [ ] **Step 2: Add the controller endpoint**

In `apps/backend/src/api/routes/integrations.controller.ts`, add the MAX import next to the existing `TelegramProvider` import:

```ts
import { MaxProvider } from '@gitroom/nestjs-libraries/integrations/social/max.provider';
```

Then add this handler immediately after the existing `getUpdates` (`@Get('/telegram/updates')`) method (around line 454):

```ts
  @Get('/max/updates')
  async getMaxUpdates(@Query() query: { word: string; id?: number }) {
    return new MaxProvider().getBotId(query);
  }
```

- [ ] **Step 3: Verify the backend compiles**

Run:
```bash
pnpm run build:backend 2>&1 | tail -20
```
Expected: build succeeds. (If no `build:backend` script exists, use the project's backend build target — e.g. `npx nx build backend` — and confirm it exits 0.)

- [ ] **Step 4: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/integration.manager.ts apps/backend/src/api/routes/integrations.controller.ts
git commit -m "feat: register MAX provider and add /max/updates connect endpoint"
```

---

## Task 4: Frontend connect flow

**Files:**
- Create: `apps/frontend/src/components/launches/web3/providers/max.provider.tsx`
- Modify: `apps/frontend/src/components/launches/web3/web3.list.tsx`
- Modify: `libraries/react-shared-libraries/src/helpers/variable.context.tsx`
- Modify: `apps/frontend/src/app/(app)/layout.tsx`
- Modify: `apps/frontend/src/app/(provider)/layout.tsx`
- Modify: `apps/frontend/src/app/(extension)/layout.tsx`

**Interfaces:**
- Consumes: `useVariables().maxBotName` (added in this task); `GET /integrations/max/updates` (Task 3); `Web3ProviderInterface` (`{ onComplete, nonce }`).
- Produces: a `MaxProvider` React component registered under identifier `max`, rendered when the user adds a MAX channel.

- [ ] **Step 1: Add `maxBotName` to the variables context**

In `libraries/react-shared-libraries/src/helpers/variable.context.tsx`:

Add to the `VariableContextInterface` (right after `telegramBotName: string;` on line 23):
```ts
  maxBotName: string;
```

Add to the default `createContext({...})` object (right after `telegramBotName: '',` on line 56):
```ts
  maxBotName: '',
```

- [ ] **Step 2: Pass `maxBotName` from all three layouts**

In each of `apps/frontend/src/app/(app)/layout.tsx`, `apps/frontend/src/app/(provider)/layout.tsx`, and `apps/frontend/src/app/(extension)/layout.tsx`, find the line:
```tsx
          telegramBotName={process.env.TELEGRAM_BOT_NAME!}
```
and add immediately below it:
```tsx
          maxBotName={process.env.MAX_BOT_NAME!}
```

- [ ] **Step 3: Create the connect component**

Create `apps/frontend/src/components/launches/web3/providers/max.provider.tsx`:

```tsx
'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { Web3ProviderInterface } from '@gitroom/frontend/components/launches/web3/web3.provider.interface';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { timer } from '@gitroom/helpers/utils/timer';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { Input } from '@gitroom/react/form/input';
import { Button } from '@gitroom/react/form/button';
import copy from 'copy-to-clipboard';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const MaxProvider: FC<Web3ProviderInterface> = (props) => {
  const { onComplete, nonce } = props;
  const { maxBotName } = useVariables();
  const fetch = useFetch();
  const word = useRef(makeId(4));
  const stop = useRef(false);
  const [step, setStep] = useState(false);
  const toaster = useToaster();
  const t = useT();

  async function* load() {
    let id = '';
    while (true) {
      const data = await (
        await fetch(
          `/integrations/max/updates?word=${word.current}${
            id ? `&id=${id}` : ''
          }`
        )
      ).json();
      if (data.lastChatId) {
        id = data.lastChatId;
      }
      yield data;
    }
  }

  const loadAll = async () => {
    stop.current = false;
    setStep(true);
    const generator = load();
    for await (const data of generator) {
      if (stop.current) {
        return;
      }
      if (data.chatId) {
        onComplete(data.chatId, nonce);
        return;
      }
      await timer(2000);
    }
  };

  const copyText = useCallback(() => {
    copy(`/connect ${word.current}`);
    toaster.show('Copied to clipboard', 'success');
  }, []);

  useEffect(() => {
    return () => {
      stop.current = true;
    };
  }, []);

  return (
    <>
      <div className="justify-center items-center flex flex-col pt-[16px]">
        <div>
          {t('please_add', 'Please add')} <strong>@{maxBotName}</strong>{' '}
          {t(
            'to_your_max_group_channel_and_click_here',
            'to your MAX group / channel and click here:'
          )}
        </div>
        {!step ? (
          <div className="w-full mt-[16px]" onClick={loadAll}>
            <div className="cursor-pointer bg-[#8A2BE2] h-[44px] rounded-[4px] flex justify-center items-center text-white gap-[4px]">
              <div>{t('connect_max', 'Connect MAX')}</div>
            </div>
          </div>
        ) : (
          <div className="w-full text-center" onClick={copyText}>
            {t(
              'please_add_the_following_command_in_your_chat',
              'Please add the following command in your chat:'
            )}
            <div className="mt-[16px] flex">
              <div className="flex-1">
                <Input
                  label=""
                  value={`/connect ${word.current}`}
                  name=""
                  disableForm={true}
                />
              </div>
              <Button>{t('copy', 'Copy')}</Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
```

- [ ] **Step 4: Register the component in web3List**

In `apps/frontend/src/components/launches/web3/web3.list.tsx`, add the import after the Telegram import:
```ts
import { MaxProvider } from '@gitroom/frontend/components/launches/web3/providers/max.provider';
```

And add an entry to the `web3List` array (after the `telegram` entry):
```ts
  {
    identifier: 'max',
    component: MaxProvider,
  },
```

- [ ] **Step 5: Verify the frontend compiles**

Run:
```bash
pnpm run build:frontend 2>&1 | tail -20
```
Expected: build succeeds. (If no `build:frontend` script, use the project's frontend build target — e.g. `npx nx build frontend` — and confirm exit 0.)

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/components/launches/web3/providers/max.provider.tsx apps/frontend/src/components/launches/web3/web3.list.tsx libraries/react-shared-libraries/src/helpers/variable.context.tsx "apps/frontend/src/app/(app)/layout.tsx" "apps/frontend/src/app/(provider)/layout.tsx" "apps/frontend/src/app/(extension)/layout.tsx"
git commit -m "feat: add MAX connect flow to the frontend"
```

---

## Task 5: Config and icon

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yaml`
- Create: `apps/frontend/public/icons/platforms/max.png`

**Interfaces:**
- Consumes: `MAX_TOKEN` (backend, read in Task 2), `MAX_BOT_NAME` (frontend, read in Task 4's layouts).
- Produces: documented env vars and an icon asset the channel list renders.

- [ ] **Step 1: Add env vars to `.env.example`**

Append to `.env.example`:
```bash

# MAX messenger (https://dev.max.ru) — create a bot via @MasterBot
MAX_TOKEN=""
# MAX_BOT_NAME="" # bot username shown on the connect screen (without @)
```

- [ ] **Step 2: Add env vars to `docker-compose.yaml`**

In the `postiz` service `environment:` block (starts at line 6), add after the existing social/required settings (a sensible spot is near the other integration tokens; if none, add under the required settings block):
```yaml
      MAX_TOKEN: ''
      # MAX_BOT_NAME: ''
```
Keep the two-space + block indentation consistent with the surrounding keys.

- [ ] **Step 3: Add the icon asset**

Place a `max.png` at `apps/frontend/public/icons/platforms/max.png` (same format/size as `telegram.png` / `vk.png` in that folder). If the real MAX logo is not available yet, copy an existing icon as a placeholder so the UI renders, and note in the commit that the final logo is pending:
```bash
cp apps/frontend/public/icons/platforms/vk.png apps/frontend/public/icons/platforms/max.png
```

- [ ] **Step 4: Verify the files exist**

Run:
```bash
grep -q "MAX_TOKEN" .env.example && grep -q "MAX_TOKEN" docker-compose.yaml && ls apps/frontend/public/icons/platforms/max.png && echo "OK"
```
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add .env.example docker-compose.yaml apps/frontend/public/icons/platforms/max.png
git commit -m "chore: add MAX env vars and platform icon"
```

---

## Task 6: Full build, lint, and diff handoff

**Files:** none (verification only).

**Interfaces:** consumes everything from Tasks 1–5.

- [ ] **Step 1: Install (in case lockfile changed) and full build**

Run:
```bash
pnpm install
pnpm run build 2>&1 | tail -30
```
Expected: the monorepo build completes with exit 0 (backend + frontend + libraries). Investigate and fix any error referencing `max`/`Max` before proceeding.

- [ ] **Step 2: Lint from root**

Run:
```bash
pnpm run lint 2>&1 | tail -30
```
Expected: no new lint errors attributable to the new/modified MAX files. Fix any that are.

- [ ] **Step 3: Produce the diff for the user**

Run:
```bash
git log --oneline main..feat/max-provider
git diff --stat main..feat/max-provider
```
Expected: the five feature commits (Tasks 1–5) and a stat covering exactly the planned files.

- [ ] **Step 4: STOP and hand off**

Do **not** push and do **not** open a PR. Present the diff to the user and hand off the manual runtime test:
1. Create a bot via `@MasterBot`; get `MAX_TOKEN`.
2. Add the bot as **admin** to a test MAX channel.
3. Set `MAX_TOKEN` (+ `MAX_BOT_NAME`) in env; restart Postiz.
4. UI "Add channel → MAX" → connect via `/connect <word>`.
5. Create a post with an image → verify it publishes to the channel.

---

## Self-Review (completed by plan author)

**Spec coverage:** All 8 touchpoints + dependency from the spec map to tasks — provider (T2), manager+endpoint (T3), frontend component+web3List+variables+layouts (T4), icon+env+compose (T5), build/lint verification (T6), dependency (T1). Connect flow, publish flow, and both API corrections (Authorization header via SDK; `/subscriptions` not used) are reflected. Spec's four "known uncertainties" are folded into T1 Step 3 / T2 Step 2 as concrete confirmation steps, not deferred TODOs.

**Placeholder scan:** No "TBD/TODO/handle edge cases" left in steps. The only intentionally deferred item is the real logo PNG (T5 Step 3), with an explicit placeholder fallback so nothing blocks.

**Type consistency:** `getBotId` return shape (`{ chatId } | { lastChatId } | {}`) is produced in T2 and consumed identically by T3's endpoint and T4's poller. `maxBotName` is declared (T4 S1), passed (T4 S2), and read (T4 S3) with the same name. `accessToken = chat_id` is written in `authenticate` (T2) and read by `post`/`comment` (T2). `MAX_TOKEN`/`MAX_BOT_NAME` names are consistent across T2, T4, and T5.
