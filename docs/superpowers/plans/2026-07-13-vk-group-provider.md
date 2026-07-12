Project: postiz-app
Document: implementation-plan

# VK Group Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `vk-group` channel type so Postiz publishes to VK communities the user administers, posting as the community.

**Architecture:** `VkGroupProvider extends VkProvider` — same VK ID OAuth (PKCE, shared `VK_ID`), plus the existing two-step page-picker pattern (`isBetweenSteps = true` → provider `pages()` → frontend `withContinueProvider` picker → `fetchPageInformation()` binds the channel to the group). The integration's `internalId` stores the **negative** group id (VK `owner_id` semantics), so attachment strings and `owner_id` params compose naturally.

**Tech Stack:** NestJS (libraries/backend), React (frontend), TypeScript, pnpm monorepo, VK API v5.251 via the provider's `this.fetch` wrapper.

**Spec:** `docs/superpowers/specs/2026-07-13-vk-group-provider-design.md` (approved 2026-07-13).

## Global Constraints

- **pnpm only**; lint/build run from repo root.
- **Commits in English.** No push, no PR — plan stops at "show the diff to the user".
- **Base branch:** create `feat/vk-group-provider` off `prod` (Task 1). `prod` autodeploys on push — never commit directly to it during this work.
- **Upstream discipline:** new files + one-line registrations preferred; edits to upstream files must stay semantically minimal (this plan touches `vk.provider.ts` with exactly three small changes and `integration.manager.ts` / two frontend registries with one entry each).
- Provider `name` is **"VK Group"** (English); identifier is **`vk-group`** everywhere (it is also the OAuth redirect path and the icon filename).
- No new env vars, no DB migrations. `VK_ID` is shared with the existing VK provider.
- **Verification pattern:** this repo has no unit tests for social providers and no root lint script (checked 2026-07-13: no `*.provider.spec.ts`, no `lint` script in root `package.json`). Gates are `pnpm run build:backend` / `pnpm run build:frontend` per task, full `pnpm run build` at the end, then a user-performed manual runtime test. Do not introduce a Jest harness.

## Plumbing facts (verified against the code, 2026-07-13)

The implementer should trust these without re-deriving them:

- **Picker data, path A (connect):** `apps/backend/src/api/routes/no.auth.integrations.controller.ts` — after `authenticate()`, if `isBetweenSteps && !refresh` it duck-types the provider for a `pages` method and calls `pages(accessToken)`; the result is returned to the frontend as `pages` (becomes the picker's `initialData`).
- **Picker data, path B (reload):** the `withContinueProvider` HOC calls `useCustomProviderFunction().get('pages')` → `POST /integrations/function` with `{name: 'pages', id: integrationId}` → `apps/backend/src/api/routes/integrations.controller.ts` `functionIntegration()` → `provider['pages'](integration.token, body.data, integration.internalId, integration)`. So `pages(accessToken)` receives the token as its first arg on both paths.
- **Saving the pick:** picker `onSave` → `POST /integrations/provider/:id/connect` → `integration.service.ts` `saveProviderPage()` → requires the provider to implement `fetchPageInformation(token, data)`; its return value `{id, name, access_token, picture, username}` is written to the integration (`internalId = String(id)`, `token = access_token`, `inBetweenSteps = false`). The optional `reConnect()` interface method is dead code — nothing calls it; do not implement it.
- **Token refresh never touches identity:** `integration.service.ts` `refreshToken()` persists only `{accessToken, refreshToken, expiresIn}` — the inherited `VkProvider.refreshToken()` is correct as-is for groups.
- **TS visibility:** `VkProvider.uploadMedia` is `private`; a subclass redeclaring it is a compile error (TS2415). Task 1 makes it `protected`.
- **VK API notes:** `wall.post` takes `from_group=1` (flag); `wall.createComment` takes `from_group={positive group id}`. Media uploaded for a group wall needs `group_id={positive id}` on `photos.getWallUploadServer`, `photos.saveWallPhoto`, and `video.save`; the saved media's owner is `-{groupId}`, which equals the stored `internalId`, so the base attachment format `${type}${userId}_${id}` stays correct. `groups.getById` on v5.251 returns `{response: {groups: [...]}}` (older versions returned a bare array — the code handles both).

## File Structure

**New files:**
- `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts` — the provider (group listing, group binding, group-wall publish/comment).
- `apps/frontend/src/components/new-launch/providers/continue-provider/vk/vk.continue.tsx` — the group picker (config for the existing HOC).
- `apps/frontend/public/icons/platforms/vk-group.png` — channel icon (placeholder copy of `vk.png` initially).

**Modified files:**
- `libraries/nestjs-libraries/src/integrations/social/vk.provider.ts` — 3 minimal changes: identifier-based redirect URI, `uploadMedia` → `protected`, `maxLength()` → 16384.
- `libraries/nestjs-libraries/src/integrations/integration.manager.ts` — register `new VkGroupProvider()`.
- `apps/frontend/src/components/new-launch/providers/continue-provider/list.tsx` — register the picker under `vk-group`.
- `apps/frontend/src/components/new-launch/providers/show.all.providers.tsx` — register `vk-group` (reusing the VK settings component).

---

### Task 1: Branch + minimal base `VkProvider` changes

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.provider.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `VkProvider` with `protected uploadMedia(userId, accessToken, post): Promise<{id: string; type: string}[]>`, redirect URIs built from `this.identifier`, and `maxLength() = 16384`. Task 2 subclasses all of this.

- [ ] **Step 1: Create the working branch**

```bash
git checkout prod && git pull && git checkout -b feat/vk-group-provider
```
Expected: on `feat/vk-group-provider`, up to date with `prod`.

- [ ] **Step 2: Build redirect URIs from `this.identifier`**

In `libraries/nestjs-libraries/src/integrations/social/vk.provider.ts` there are exactly **two** occurrences of the hard-coded redirect path — one in `generateAuthUrl()` (~line 101), one in `authenticate()` (~line 129). In both, change:

```ts
          }/integrations/social/vk`
```
to:
```ts
          }/integrations/social/${this.identifier}`
```

(No behavior change for the base class: `this.identifier === 'vk'`. The subclass inherits both methods and gets `/integrations/social/vk-group` for free.)

- [ ] **Step 3: Make `uploadMedia` protected**

Same file (~line 163), change:
```ts
  private async uploadMedia(
```
to:
```ts
  protected async uploadMedia(
```

- [ ] **Step 4: Raise the post length limit to VK's documented maximum**

Same file (~line 33), change:
```ts
  maxLength() {
    return 2048;
  }
```
to:
```ts
  maxLength() {
    return 16384;
  }
```

- [ ] **Step 5: Verify the backend builds**

Run:
```bash
pnpm run build:backend 2>&1 | tail -5
```
Expected: exit 0, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/social/vk.provider.ts
git commit -m "refactor(vk): identifier-based redirect URI, protected uploadMedia, real 16384 post limit"
```

---

### Task 2: Backend `VkGroupProvider` + registration

**Files:**
- Create: `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/integration.manager.ts`

**Interfaces:**
- Consumes: `VkProvider` from Task 1 (`protected uploadMedia`, identifier-based redirect, inherited `generateAuthUrl`/`authenticate`/`refreshToken`).
- Produces: `class VkGroupProvider` with `identifier = 'vk-group'`, and the methods the plumbing calls by name: `pages(accessToken): Promise<{id: string; name: string; username: string; picture: string}[]>` (ids are **negative-as-string**, e.g. `"-123"`) and `fetchPageInformation(accessToken, data: {page: string})` returning `{id, name, access_token, picture, username}`. Task 3's picker sends `{page: '<negative id>'}`.

- [ ] **Step 1: Create the provider file**

Create `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts`:

```ts
import {
  PostDetails,
  PostResponse,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { VkProvider } from '@gitroom/nestjs-libraries/integrations/social/vk.provider';
import { Integration } from '@prisma/client';
import axios from 'axios';
import FormDataNew from 'form-data';
import mime from 'mime-types';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';

export class VkGroupProvider extends VkProvider {
  override identifier = 'vk-group';
  override name = 'VK Group';
  override isBetweenSteps = true;
  override scopes = [
    'vkid.personal_info',
    'email',
    'wall',
    'status',
    'docs',
    'photos',
    'video',
    'groups',
  ];

  // Groups the user can post to (admin/editor). Ids are returned negated to
  // match the internalId convention (VK owner_id semantics) — this also lets
  // the picker's existingId filter recognize already-connected groups.
  async pages(accessToken: string) {
    const { response } = await (
      await this.fetch(
        `https://api.vk.com/method/groups.get?filter=admin,editor&extended=1&fields=photo_200,screen_name&access_token=${accessToken}&v=5.251`
      )
    ).json();

    return (response?.items || []).map((g: any) => ({
      id: String(-g.id),
      name: g.name,
      username: g.screen_name || '',
      picture: g.photo_200 || '',
    }));
  }

  async fetchPageInformation(accessToken: string, data: { page: string }) {
    const groupId = Math.abs(Number(data.page));
    const { response } = await (
      await this.fetch(
        `https://api.vk.com/method/groups.getById?group_id=${groupId}&fields=photo_200,screen_name&access_token=${accessToken}&v=5.251`
      )
    ).json();

    const group = response?.groups?.[0] ?? response?.[0];

    return {
      id: String(-groupId),
      name: group?.name ?? '',
      // Same user token — VK ID has no per-group token in this flow.
      access_token: accessToken,
      picture: group?.photo_200 ?? '',
      username: group?.screen_name ?? '',
    };
  }

  // userId here is the integration internalId: the NEGATIVE group id.
  protected override async uploadMedia(
    userId: string,
    accessToken: string,
    post: PostDetails
  ): Promise<{ id: string; type: string }[]> {
    const groupId = Math.abs(Number(userId));

    return await Promise.all(
      (post?.media || []).map(async (media) => {
        const all = await (
          await this.fetch(
            hasExtension(media.path, 'mp4')
              ? `https://api.vk.com/method/video.save?group_id=${groupId}&access_token=${accessToken}&v=5.251`
              : `https://api.vk.com/method/photos.getWallUploadServer?group_id=${groupId}&access_token=${accessToken}&v=5.251`
          )
        ).json();

        const { data } = await axios.get(media.path!, {
          responseType: 'stream',
        });

        const slash = media.path.split('/').at(-1);

        const formData = new FormDataNew();
        formData.append('photo', data, {
          filename: slash,
          contentType: mime.lookup(slash!) || '',
        });
        const value = (
          await axios.post(all.response.upload_url, formData, {
            headers: {
              ...formData.getHeaders(),
            },
          })
        ).data;

        if (hasExtension(media.path, 'mp4')) {
          return {
            id: all.response.video_id,
            type: 'video',
          };
        }

        const formSend = new FormData();
        formSend.append('photo', value.photo);
        formSend.append('server', value.server);
        formSend.append('hash', value.hash);
        formSend.append('group_id', String(groupId));

        const { id } = (
          await (
            await fetch(
              `https://api.vk.com/method/photos.saveWallPhoto?access_token=${accessToken}&v=5.251`,
              {
                method: 'POST',
                body: formSend,
              }
            )
          ).json()
        ).response[0];

        return {
          id,
          type: 'photo',
        };
      })
    );
  }

  override async post(
    userId: string,
    accessToken: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;

    const mediaList = await this.uploadMedia(userId, accessToken, firstPost);

    const body = new FormData();
    body.append('owner_id', userId); // negative group id
    body.append('from_group', '1'); // post as the community
    body.append('message', firstPost.message);

    if (mediaList.length) {
      body.append(
        'attachments',
        mediaList.map((p) => `${p.type}${userId}_${p.id}`).join(',')
      );
    }

    const { response } = await (
      await this.fetch(
        `https://api.vk.com/method/wall.post?v=5.251&access_token=${accessToken}&client_id=${process.env.VK_ID}`,
        {
          method: 'POST',
          body,
        }
      )
    ).json();

    return [
      {
        id: firstPost.id,
        postId: String(response?.post_id),
        releaseURL: `https://vk.com/wall${userId}_${response?.post_id}`,
        status: 'completed',
      },
    ];
  }

  override async comment(
    userId: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;

    const mediaList = await this.uploadMedia(userId, accessToken, commentPost);

    const body = new FormData();
    body.append('owner_id', userId); // negative group id
    // wall.createComment expects the POSITIVE community id here (unlike
    // wall.post, where from_group is a 0/1 flag).
    body.append('from_group', String(Math.abs(Number(userId))));
    body.append('message', commentPost.message);
    body.append('post_id', postId);

    if (mediaList.length) {
      body.append(
        'attachments',
        mediaList.map((p) => `${p.type}${userId}_${p.id}`).join(',')
      );
    }

    const { response } = await (
      await this.fetch(
        `https://api.vk.com/method/wall.createComment?v=5.251&access_token=${accessToken}&client_id=${process.env.VK_ID}`,
        {
          method: 'POST',
          body,
        }
      )
    ).json();

    return [
      {
        id: commentPost.id,
        postId: String(response?.comment_id),
        releaseURL: `https://vk.com/wall${userId}_${postId}`,
        status: 'completed',
      },
    ];
  }
}
```

- [ ] **Step 2: Register the provider**

In `libraries/nestjs-libraries/src/integrations/integration.manager.ts`, add the import next to the VK import (~line 29):

```ts
import { VkGroupProvider } from '@gitroom/nestjs-libraries/integrations/social/vk.group.provider';
```

And in `socialIntegrationList`, right after `new VkProvider(),` (~line 67):

```ts
  new VkProvider(),
  new VkGroupProvider(),
```

- [ ] **Step 3: Verify the backend builds**

Run:
```bash
pnpm run build:backend 2>&1 | tail -5
```
Expected: exit 0. Any TS2415 error about `uploadMedia` means Task 1 Step 3 was skipped.

- [ ] **Step 4: Commit**

```bash
git add libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts libraries/nestjs-libraries/src/integrations/integration.manager.ts
git commit -m "feat: add VK Group provider (post to communities as the community)"
```

---

### Task 3: Frontend — group picker, registrations, icon

**Files:**
- Create: `apps/frontend/src/components/new-launch/providers/continue-provider/vk/vk.continue.tsx`
- Modify: `apps/frontend/src/components/new-launch/providers/continue-provider/list.tsx`
- Modify: `apps/frontend/src/components/new-launch/providers/show.all.providers.tsx`
- Create: `apps/frontend/public/icons/platforms/vk-group.png`

**Interfaces:**
- Consumes: `withContinueProvider` HOC (existing); backend `pages` items `{id: '-123', name, username, picture}` and save shape `{page: '<negative id>'}` from Task 2.
- Produces: `VkGroupContinue` component registered under identifier `vk-group`; the `vk-group` channel renders with the existing VK post-settings component.

- [ ] **Step 1: Create the picker component**

Create `apps/frontend/src/components/new-launch/providers/continue-provider/vk/vk.continue.tsx` (mirrors `linkedin/linkedin.continue.tsx`):

```tsx
'use client';

import { withContinueProvider } from '../with-continue-provider';

interface VkGroupItem {
  id: string; // negative group id as string, e.g. "-123"
  username: string;
  name: string;
  picture: string;
}

interface VkGroupSelection {
  id: string;
}

export const VkGroupContinue = withContinueProvider<
  VkGroupItem,
  VkGroupSelection
>({
  endpoint: 'pages',
  swrKey: 'load-vk-groups',
  titleKey: 'select_vk_group',
  titleDefault: 'Select VK Group:',
  emptyStateMessages: [
    {
      key: 'we_couldn_t_find_any_vk_group_you_can_post_to',
      text: "We couldn't find any VK group you can post to.",
    },
    {
      key: 'please_make_sure_you_are_an_admin_or_editor_of_a_group_and_add_a_new_channel_again',
      text: 'Please make sure you are an admin or editor of a group, and add a new channel again.',
    },
  ],
  getItemId: (item) => item.id,
  getSelectionValue: (item) => ({ id: item.id }),
  transformSaveData: (selection) => ({ page: selection.id }),
  isSelected: (item, selection) => selection?.id === item.id,
  renderItem: (item) => (
    <>
      <div>
        <img className="w-full" src={item.picture} alt="group" />
      </div>
      <div>{item.name}</div>
    </>
  ),
});
```

- [ ] **Step 2: Register the picker**

In `apps/frontend/src/components/new-launch/providers/continue-provider/list.tsx`, add the import after the other continue imports:

```ts
import { VkGroupContinue } from '@gitroom/frontend/components/new-launch/providers/continue-provider/vk/vk.continue';
```

(Confirm the import style — if the file's existing imports use relative paths like `'./linkedin/linkedin.continue'`-style aliases, match them.) Then add to `continueProviderList`:

```ts
export const continueProviderList = {
  instagram: InstagramContinue,
  facebook: FacebookContinue,
  'linkedin-page': LinkedinContinue,
  gmb: GmbContinue,
  youtube: YoutubeContinue,
  tumblr: TumblrContinue,
  'vk-group': VkGroupContinue,
};
```

- [ ] **Step 3: Register the channel settings component**

In `apps/frontend/src/components/new-launch/providers/show.all.providers.tsx`, find the existing entry (~line 151):

```ts
  {
    identifier: 'vk',
    component: VkProvider,
  },
```

and add right after it (reusing the same component, exactly like `linkedin-page` reuses `LinkedinProvider`):

```ts
  {
    identifier: 'vk-group',
    component: VkProvider,
  },
```

- [ ] **Step 4: Add the icon**

```bash
cp apps/frontend/public/icons/platforms/vk.png apps/frontend/public/icons/platforms/vk-group.png
```

(Placeholder per spec — a badged variant can replace it later without code changes.)

- [ ] **Step 5: Verify the frontend builds**

Run:
```bash
pnpm run build:frontend 2>&1 | tail -5
```
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/components/new-launch/providers/continue-provider/vk/vk.continue.tsx apps/frontend/src/components/new-launch/providers/continue-provider/list.tsx apps/frontend/src/components/new-launch/providers/show.all.providers.tsx apps/frontend/public/icons/platforms/vk-group.png
git commit -m "feat: VK Group frontend — group picker, registrations, icon"
```

---

### Task 4: Full build + diff handoff

**Files:** none (verification only).

**Interfaces:** consumes everything from Tasks 1–3.

- [ ] **Step 1: Full monorepo build**

Run:
```bash
pnpm run build 2>&1 | tail -10
```
Expected: backend + frontend + orchestrator all build with exit 0. (The orchestrator imports `integration.manager.ts`, so this also proves the new provider loads there.) Fix any error mentioning `vk.group`/`VkGroup` before proceeding.

- [ ] **Step 2: Produce the diff for the user**

Run:
```bash
git log --oneline prod..feat/vk-group-provider
git diff --stat prod..feat/vk-group-provider
```
Expected: 3 commits (Tasks 1–3); stat covers exactly the 7 planned files.

- [ ] **Step 3: STOP and hand off**

Do **not** push, do **not** merge. Present the diff to the user. The remaining steps are user-performed:

1. **VK ID app config (one-time, manual):** add trusted redirect `https://app.vezdepost.ru/integrations/social/vk-group`; request the `groups` scope (on top of wall/photos/video/docs/status/email/personal_info). While the app is un-moderated, add the test account as an app tester.
2. Merge `feat/vk-group-provider` into `prod` and push (autodeploy per `docs/devops/deployment.md`).
3. Runtime test: "Add channel → VK Group" → OAuth → pick a test group → publish from the calendar: (a) a text post, (b) a post with an image — both must appear on the group wall **authored by the community**; (c) a post with a comment thread — the comment must also be community-authored.

---

## Self-Review (completed by plan author)

**Spec coverage:** Every spec section maps to a task — base-class edits incl. `maxLength` 16384 (T1), `VkGroupProvider` with `pages`/`fetchPageInformation`/group-aware `uploadMedia`/`post`/`comment` + registration (T2), picker + `list.tsx` + `show.all.providers.tsx` + icon (T3), verification + VK app config + manual runtime test (T4). Refresh-safety needs no task (verified inherited behavior, documented in Plumbing facts). Out-of-scope items from the spec have no tasks, as intended.

**Placeholder scan:** No TBDs; every code step shows complete code; the only deferred artifact is the final icon PNG, with an explicit placeholder command (spec-sanctioned).

**Type consistency:** `pages()` returns `{id: '-123' as string}` → picker `getItemId`/`transformSaveData` pass the same string → `fetchPageInformation` does `Math.abs(Number(data.page))` → stores `id: String(-groupId)` = same negative string → `post()`/`comment()`/`uploadMedia()` treat `userId` as that negative string and derive the positive `groupId` via `Math.abs(Number(...))`. `uploadMedia` signature matches Task 1's `protected` base signature exactly.
