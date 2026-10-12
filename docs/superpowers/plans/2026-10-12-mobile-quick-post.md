# Mobile quick post, queue and Share Target (mobile stage 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/m` shell useful: a one-screen quick post editor (text, media from camera/gallery with client-side image compression, channel chips, "сейчас" / "в очередь" / date) posting through `POST /posts/quick`, an upcoming-posts queue with preview and delete, a web manifest with Android Share Target feeding the editor, and two product goals.

**Architecture:** All new code lives in `apps/frontend/src/components/mobile/` plus two route files under `app/(app)/(mobile)/m/share/` and `app/manifest.ts`. Pure helpers (request building, compression decisions, share payload encoding) are separated from React so they get plain unit tests; components are tested with jsdom and mocked hooks. Media goes through the existing `/media/upload-simple` endpoint; posts through `/posts/quick` from stage 1; the queue through `/posts/list?state=scheduled` and `DELETE /posts/:group`. The Share Target is a Next route handler that forwards shared files to the backend with the user's cookies and redirects to `/m` with an encoded payload.

**Tech Stack:** Next 16 app router (route handlers, manifest.ts), React 18, SWR via `useFetch`, Tailwind 3 `new*` tokens, `sharp` (already a dependency) only as a one-off script to render manifest icons, vitest + @testing-library/react (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-12-mobile-version-design.md`, section 4 (экраны «Пост», «Очередь», Share Target, загрузка медиа), section 1 (цели Метрики), stage table row 3 in section 7.

## Global Constraints

- Only pnpm. Tests from the root: `pnpm vitest run <path>`. Client specs start with `// @vitest-environment jsdom`, import React explicitly, and `cleanup` in `beforeEach`. Components import React explicitly (classic JSX runtime under vitest).
- SWR only through `useFetch`; one SWR call per hook. Native components only. Tailwind `new*` tokens; no `--color-custom*`.
- No changes to shared upstream files in this stage except `apps/frontend/src/app/manifest.ts` (new) and nothing in `posts.repository.ts` (queue shows the channel avatar, not a post thumbnail, because the list query does not select `image`).
- Backend untouched. `POST /posts/quick` contract from stage 1: body `{ text, media: [{id, path}], integrationIds, schedule: {type:'now'|'queue'|'date', date?} }`, response `{ published: [{id,name}], failed: [{id,name,error}] }`, 400 `{ message }` on a user-fixable error.
- Upload limits from `libraries/nestjs-libraries/src/upload/custom.upload.validation.ts`: images 10 MB, videos 1 GB. Client compresses images above 1.5 MB or above 2048 px on the long side to JPEG quality 0.85, never GIFs.
- Copy in Russian via `useT(key, default)` with keys prefixed `mobile_`.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **Submitting with no channel selected or an empty post must be impossible from the UI**, and the server's 400 message must still be shown if it happens (Task 3 tests "disables publish until the post is valid" and "shows the server message on 400").
2. **A partial failure must keep the failed channels visible and clear the form only when every channel succeeded** (Task 3 test "keeps failed channels on screen and clears only on full success").
3. **A 6 MB phone photo must be compressed before upload; a GIF or a 300 KB PNG must not be touched** (Task 2 tests on `shouldCompress`).
4. **Share Target with no files but with text must still open the editor with the text** (Task 5 test "redirects with text only").
5. **Deleting a queued post must ask for confirmation**, since a tap on a phone is easy to misplace (Task 4 test "asks before deleting").

---

### Task 1: Quick post request builder and mobile goals helper

**Files:**
- Create: `apps/frontend/src/components/mobile/quick.post.request.ts`
- Create: `apps/frontend/src/components/mobile/quick.post.request.spec.ts`
- Reuse: `apps/frontend/src/components/mobile/use.mobile.goal.tsx` (already created in the stage 2 fix pass)

**Interfaces:**
- Produces:

```ts
export type QuickPostMedia = { id: string; path: string };
export type QuickPostSchedule = { type: 'now' } | { type: 'queue' } | { type: 'date'; date: string };
export type QuickPostDraft = {
  text: string;
  media: QuickPostMedia[];
  selected: string[];               // integration ids
  schedule: QuickPostSchedule;
};
export const emptyDraft: () => QuickPostDraft;
export const draftProblem: (draft: QuickPostDraft) => string | null;   // Russian reason or null when valid
export const toQuickPostBody: (draft: QuickPostDraft) => {
  text: string; media: QuickPostMedia[]; integrationIds: string[];
  schedule: { type: 'now' | 'queue' | 'date'; date?: string };
};
export const localDateTimeToIso: (value: string) => string;           // '2026-10-20T08:00' (datetime-local) → ISO in the browser's zone

export const useMobileGoal: () => (goal: 'mobile_channel_added' | 'mobile_quick_post_sent') => void;
```

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/src/components/mobile/quick.post.request.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  draftProblem,
  emptyDraft,
  localDateTimeToIso,
  toQuickPostBody,
} from './quick.post.request';

const valid = () => ({
  ...emptyDraft(),
  text: 'Привет',
  selected: ['vk-1'],
});

describe('draftProblem', () => {
  it('accepts text with a channel, or media with a channel', () => {
    expect(draftProblem(valid())).toBeNull();
    expect(
      draftProblem({ ...valid(), text: '', media: [{ id: 'm', path: '/a.jpg' }] })
    ).toBeNull();
  });

  it('refuses an empty post and a post without channels', () => {
    expect(draftProblem({ ...valid(), text: '   ' })).toBe('Добавьте текст или фото');
    expect(draftProblem({ ...valid(), selected: [] })).toBe('Выберите хотя бы один канал');
  });

  it('refuses a dated post without a date', () => {
    expect(
      draftProblem({ ...valid(), schedule: { type: 'date', date: '' } })
    ).toBe('Выберите дату');
  });
});

describe('toQuickPostBody', () => {
  it('maps the draft to the /posts/quick body', () => {
    expect(
      toQuickPostBody({
        ...valid(),
        media: [{ id: 'm1', path: '/a.jpg' }],
        selected: ['vk-1', 'tg-1'],
        schedule: { type: 'date', date: '2026-10-20T08:00:00.000Z' },
      })
    ).toEqual({
      text: 'Привет',
      media: [{ id: 'm1', path: '/a.jpg' }],
      integrationIds: ['vk-1', 'tg-1'],
      schedule: { type: 'date', date: '2026-10-20T08:00:00.000Z' },
    });
    expect(toQuickPostBody(valid()).schedule).toEqual({ type: 'now' });
  });
});

describe('localDateTimeToIso', () => {
  it('converts a datetime-local value to an ISO string', () => {
    const iso = localDateTimeToIso('2026-10-20T08:30');
    expect(new Date(iso).getFullYear()).toBe(2026);
    expect(iso.endsWith('Z')).toBe(true);
    expect(new Date(iso).getMinutes()).toBe(new Date('2026-10-20T08:30').getMinutes());
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run apps/frontend/src/components/mobile/quick.post.request.spec.ts`
Expected: FAIL, cannot find module `./quick.post.request`.

- [ ] **Step 3: Implement**

Create `apps/frontend/src/components/mobile/quick.post.request.ts`:

```ts
export type QuickPostMedia = { id: string; path: string };
export type QuickPostSchedule =
  | { type: 'now' }
  | { type: 'queue' }
  | { type: 'date'; date: string };
export type QuickPostDraft = {
  text: string;
  media: QuickPostMedia[];
  selected: string[];
  schedule: QuickPostSchedule;
};

export const emptyDraft = (): QuickPostDraft => ({
  text: '',
  media: [],
  selected: [],
  schedule: { type: 'now' },
});

/** Russian reason the draft cannot be sent, or null when it can. */
export const draftProblem = (draft: QuickPostDraft): string | null => {
  if (!draft.text.trim() && draft.media.length === 0) {
    return 'Добавьте текст или фото';
  }
  if (draft.selected.length === 0) {
    return 'Выберите хотя бы один канал';
  }
  if (draft.schedule.type === 'date' && !draft.schedule.date) {
    return 'Выберите дату';
  }
  return null;
};

export const toQuickPostBody = (draft: QuickPostDraft) => ({
  text: draft.text,
  media: draft.media.map(({ id, path }) => ({ id, path })),
  integrationIds: draft.selected,
  schedule:
    draft.schedule.type === 'date'
      ? { type: 'date' as const, date: draft.schedule.date }
      : { type: draft.schedule.type },
});

/** datetime-local gives local wall time without a zone; the API wants ISO. */
export const localDateTimeToIso = (value: string) =>
  new Date(value).toISOString();
```

Create `apps/frontend/src/components/mobile/use.mobile.goal.tsx`:

```tsx
'use client';

import { useCallback } from 'react';
import { useFireEvents } from '@gitroom/helpers/utils/use.fire.events';

export type MobileGoal = 'mobile_channel_added' | 'mobile_quick_post_sent';

/** Product goals: PostHog/Plausible via useFireEvents plus a GTM dataLayer event. */
export const useMobileGoal = () => {
  const fireEvents = useFireEvents();
  return useCallback(
    (goal: MobileGoal) => {
      fireEvents(goal);
      if (typeof window !== 'undefined') {
        const w = window as unknown as { dataLayer?: unknown[] };
        w.dataLayer = w.dataLayer || [];
        w.dataLayer.push({ event: goal });
      }
    },
    [fireEvents]
  );
};
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run apps/frontend/src/components/mobile/quick.post.request.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/mobile/quick.post.request.ts apps/frontend/src/components/mobile/quick.post.request.spec.ts apps/frontend/src/components/mobile/use.mobile.goal.tsx
git commit -m "feat(mobile): quick post draft helpers and product goal hook

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Media upload with client-side image compression

**Files:**
- Create: `apps/frontend/src/components/mobile/image.compression.ts`
- Create: `apps/frontend/src/components/mobile/image.compression.spec.ts`
- Create: `apps/frontend/src/components/mobile/use.mobile.upload.tsx`

**Interfaces:**
- Produces:

```ts
export const COMPRESS_ABOVE_BYTES = 1.5 * 1024 * 1024;
export const MAX_SIDE = 2048;
export const IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;
export const VIDEO_LIMIT_BYTES = 1024 * 1024 * 1024;
export const shouldCompress: (file: { type: string; size: number }, width?: number, height?: number) => boolean;
export const targetSize: (width: number, height: number) => { width: number; height: number };
export const sizeProblem: (file: { type: string; size: number }) => string | null;   // Russian message when over limit / unsupported
export const compressImage: (file: File) => Promise<File>;   // browser only; returns the original when compression is not needed or fails

export const useMobileUpload: () => (file: File) => Promise<{ id: string; path: string }>;  // compresses, posts to /media/upload-simple, throws Error with a Russian message
```

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/src/components/mobile/image.compression.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  shouldCompress,
  sizeProblem,
  targetSize,
} from './image.compression';

const MB = 1024 * 1024;

describe('shouldCompress', () => {
  it('compresses a large phone photo', () => {
    expect(shouldCompress({ type: 'image/jpeg', size: 6 * MB })).toBe(true);
    expect(shouldCompress({ type: 'image/jpeg', size: 1 * MB }, 4000, 3000)).toBe(true);
  });

  it('leaves small images, GIFs and videos alone', () => {
    expect(shouldCompress({ type: 'image/png', size: 300 * 1024 }, 1200, 800)).toBe(false);
    expect(shouldCompress({ type: 'image/gif', size: 8 * MB })).toBe(false);
    expect(shouldCompress({ type: 'video/mp4', size: 50 * MB })).toBe(false);
  });
});

describe('targetSize', () => {
  it('scales the long side down to 2048 and keeps the ratio', () => {
    expect(targetSize(4000, 3000)).toEqual({ width: 2048, height: 1536 });
    expect(targetSize(1000, 2000)).toEqual({ width: 1000, height: 2000 });
    expect(targetSize(1000, 4096)).toEqual({ width: 500, height: 2048 });
  });
});

describe('sizeProblem', () => {
  it('explains the limit for oversized files and unsupported types', () => {
    expect(sizeProblem({ type: 'image/jpeg', size: 11 * MB })).toBe('Фото больше 10 МБ');
    expect(sizeProblem({ type: 'video/mp4', size: 2 * 1024 * MB })).toBe('Видео больше 1 ГБ');
    expect(sizeProblem({ type: 'application/pdf', size: 1 })).toBe('Можно только фото или видео');
    expect(sizeProblem({ type: 'video/mp4', size: 20 * MB })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run apps/frontend/src/components/mobile/image.compression.spec.ts`
Expected: FAIL, cannot find module `./image.compression`.

- [ ] **Step 3: Implement**

Create `apps/frontend/src/components/mobile/image.compression.ts`:

```ts
export const COMPRESS_ABOVE_BYTES = 1.5 * 1024 * 1024;
export const MAX_SIDE = 2048;
export const IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;
export const VIDEO_LIMIT_BYTES = 1024 * 1024 * 1024;
const JPEG_QUALITY = 0.85;

type FileLike = { type: string; size: number };

export const shouldCompress = (
  file: FileLike,
  width?: number,
  height?: number
) => {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return false;
  }
  if (file.size > COMPRESS_ABOVE_BYTES) {
    return true;
  }
  return Math.max(width || 0, height || 0) > MAX_SIDE;
};

export const targetSize = (width: number, height: number) => {
  const longest = Math.max(width, height);
  if (longest <= MAX_SIDE) {
    return { width, height };
  }
  const ratio = MAX_SIDE / longest;
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
};

/** Checked after compression, against the backend limits. */
export const sizeProblem = (file: FileLike): string | null => {
  if (file.type.startsWith('image/')) {
    return file.size > IMAGE_LIMIT_BYTES ? 'Фото больше 10 МБ' : null;
  }
  if (file.type.startsWith('video/')) {
    return file.size > VIDEO_LIMIT_BYTES ? 'Видео больше 1 ГБ' : null;
  }
  return 'Можно только фото или видео';
};

const loadBitmap = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode failed'));
    };
    image.src = url;
  });

/** Browser only. Returns the original file when nothing needs doing or on any failure. */
export const compressImage = async (file: File): Promise<File> => {
  if (!shouldCompress(file)) {
    return file;
  }
  try {
    const image = await loadBitmap(file);
    if (!shouldCompress(file, image.naturalWidth, image.naturalHeight)) {
      return file;
    }
    const { width, height } = targetSize(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return file;
    }
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
    );
    if (!blob || blob.size >= file.size) {
      return file;
    }
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file;
  }
};
```

Create `apps/frontend/src/components/mobile/use.mobile.upload.tsx`:

```tsx
'use client';

import { useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import {
  compressImage,
  sizeProblem,
} from '@gitroom/frontend/components/mobile/image.compression';

/** Compresses when useful, uploads to the media library, returns {id, path}. */
export const useMobileUpload = () => {
  const fetch = useFetch();
  return useCallback(
    async (original: File) => {
      const file = await compressImage(original);
      const problem = sizeProblem(file);
      if (problem) {
        throw new Error(problem);
      }
      const formData = new FormData();
      formData.append('file', file, file.name);
      const response = await fetch('/media/upload-simple', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        throw new Error('Не удалось загрузить файл');
      }
      const data = await response.json();
      return { id: data.id as string, path: data.path as string };
    },
    [fetch]
  );
};
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run apps/frontend/src/components/mobile/image.compression.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/mobile/image.compression.ts apps/frontend/src/components/mobile/image.compression.spec.ts apps/frontend/src/components/mobile/use.mobile.upload.tsx
git commit -m "feat(mobile): image compression rules and media upload hook

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Quick post editor on the Пост tab

**Files:**
- Replace: `apps/frontend/src/components/mobile/mobile.post.screen.tsx`
- Replace: `apps/frontend/src/components/mobile/mobile.post.screen.spec.tsx`
- Create: `apps/frontend/src/components/mobile/share.payload.ts`
- Create: `apps/frontend/src/components/mobile/share.payload.spec.ts`

**Interfaces:**
- Consumes: Task 1 helpers and `useMobileGoal`; Task 2 `useMobileUpload`; `useIntegrationList`; `useFetch`; `useSearchParams` from `next/navigation`.
- Produces:

```ts
// share.payload.ts — used by Task 5's route handler and by the editor
export type SharePayload = { text: string; media: { id: string; path: string }[] };
export const encodeSharePayload: (payload: SharePayload) => string;   // base64url JSON
export const decodeSharePayload: (value: string | null) => SharePayload | null;
```

Editor behaviour:
- Loads channels with `useIntegrationList`; chips show avatar + name; inactive channels (`disabled || refreshNeeded || inBetweenSteps`) are rendered but not selectable, with the «нужно переподключить» hint.
- Selected channels persist in `localStorage['vz-mobile-channels']` (array of ids) and are restored on mount, filtered to existing active channels.
- `?shared=<payload>` prefills text and media once, then the param is removed with `window.history.replaceState`.
- `?added=<provider>` is handled by `MobileQueryNotice` in the shell (toast + goals); the editor does not touch it.
- Schedule control: three radio-style buttons «Сейчас», «В очередь», «Дата»; «Дата» reveals `<input type="datetime-local">`.
- Submit disabled while `draftProblem(draft)` is non-null or while uploading/sending; the problem text is shown under the button.
- Result: `published` names shown as «✅ Ушло: …», each `failed` as «⚠️ Канал: причина». Form cleared only when `failed` is empty. On HTTP 400 the server `message` is shown; on other errors «Не удалось отправить, попробуйте ещё раз».
- Media row: thumbnails (img for images, a 🎬 tile for videos) with an «×» remove control, plus an «+» tile wrapping `<input type="file" accept="image/*,video/*" multiple>`; each selected file goes through `useMobileUpload`, errors are shown inline per file name.

- [ ] **Step 1: Write the failing share payload tests**

Create `apps/frontend/src/components/mobile/share.payload.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeSharePayload, encodeSharePayload } from './share.payload';

describe('share payload', () => {
  it('round-trips text and media through a URL-safe string', () => {
    const payload = {
      text: 'Привет, мир!?&=',
      media: [{ id: 'm1', path: 'https://app.test/uploads/a.jpg' }],
    };
    const encoded = encodeSharePayload(payload);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSharePayload(encoded)).toEqual(payload);
  });

  it('returns null for missing or broken values', () => {
    expect(decodeSharePayload(null)).toBeNull();
    expect(decodeSharePayload('***')).toBeNull();
    expect(decodeSharePayload(encodeSharePayload({ text: 'x', media: [] }))).toEqual({ text: 'x', media: [] });
  });
});
```

Run: `pnpm vitest run apps/frontend/src/components/mobile/share.payload.spec.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 2: Implement share.payload.ts**

```ts
export type SharePayload = {
  text: string;
  media: { id: string; path: string }[];
};

const toBase64Url = (value: string) =>
  Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const fromBase64Url = (value: string) =>
  Buffer.from(
    value.replace(/-/g, '+').replace(/_/g, '/'),
    'base64'
  ).toString('utf8');

export const encodeSharePayload = (payload: SharePayload) =>
  toBase64Url(JSON.stringify(payload));

export const decodeSharePayload = (
  value: string | null
): SharePayload | null => {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fromBase64Url(value));
    if (typeof parsed?.text !== 'string' || !Array.isArray(parsed?.media)) {
      return null;
    }
    return {
      text: parsed.text,
      media: parsed.media
        .filter((m: any) => m && typeof m.id === 'string' && typeof m.path === 'string')
        .map((m: any) => ({ id: m.id, path: m.path })),
    };
  } catch {
    return null;
  }
};
```

Note: `Buffer` is available in the Next client bundle through the existing polyfill (the add-provider flow already uses `Buffer.from(...).toString('base64')` client-side). Run the spec: PASS, 2 tests.

- [ ] **Step 3: Write the failing editor tests**

Replace `apps/frontend/src/components/mobile/mobile.post.screen.spec.tsx` with:

```tsx
// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.hoisted(() => ({ data: [] as any[], isLoading: false }));
const fetchMock = vi.hoisted(() => vi.fn());
const upload = vi.hoisted(() => vi.fn());
const goal = vi.hoisted(() => vi.fn());
const search = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@gitroom/frontend/components/launches/helpers/use.integration.list', () => ({
  useIntegrationList: () => list,
}));
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));
vi.mock('@gitroom/frontend/components/mobile/use.mobile.upload', () => ({
  useMobileUpload: () => upload,
}));
vi.mock('@gitroom/frontend/components/mobile/use.mobile.goal', () => ({
  useMobileGoal: () => goal,
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => search.params,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { MobilePostScreen } from './mobile.post.screen';
import { encodeSharePayload } from './share.payload';

const channel = (overrides: Record<string, unknown>) => ({
  id: 'vk-1',
  name: 'Мой VK',
  identifier: 'vk',
  picture: '/vk.jpg',
  disabled: false,
  refreshNeeded: false,
  inBetweenSteps: false,
  ...overrides,
});

const okResponse = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

beforeEach(() => {
  cleanup();
  localStorage.clear();
  list.data = [channel({}), channel({ id: 'tg-1', name: 'Канал', identifier: 'telegram' })];
  fetchMock.mockReset();
  upload.mockReset();
  goal.mockReset();
  search.params = new URLSearchParams();
  window.history.replaceState(null, '', '/m');
});

describe('MobilePostScreen', () => {
  it('asks a new user to connect the first channel', () => {
    list.data = [];
    render(<MobilePostScreen />);
    expect(
      screen.getByRole('link', { name: 'Подключить первый канал' }).getAttribute('href')
    ).toBe('/m/channels');
  });

  it('disables publish until the post is valid', () => {
    render(<MobilePostScreen />);
    const publish = screen.getByRole('button', { name: 'Опубликовать' }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    expect(screen.getByText('Добавьте текст или фото')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Привет' } });
    expect(screen.getByText('Выберите хотя бы один канал')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Мой VK' }));
    expect(publish.disabled).toBe(false);
  });

  it('sends the draft to /posts/quick and reports success', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ published: [{ id: 'vk-1', name: 'Мой VK' }], failed: [] })
    );
    render(<MobilePostScreen />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Привет' } });
    fireEvent.click(screen.getByRole('button', { name: 'Мой VK' }));
    fireEvent.click(screen.getByRole('button', { name: 'В очередь' }));
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));

    await waitFor(() => expect(screen.getByText('✅ Ушло: Мой VK')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('/posts/quick', {
      method: 'POST',
      body: JSON.stringify({
        text: 'Привет',
        media: [],
        integrationIds: ['vk-1'],
        schedule: { type: 'queue' },
      }),
    });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    expect(goal).toHaveBeenCalledWith('mobile_quick_post_sent');
  });

  it('keeps failed channels on screen and clears only on full success', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        published: [{ id: 'vk-1', name: 'Мой VK' }],
        failed: [{ id: 'tg-1', name: 'Канал', error: 'слишком длинный текст' }],
      })
    );
    render(<MobilePostScreen />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Привет' } });
    fireEvent.click(screen.getByRole('button', { name: 'Мой VK' }));
    fireEvent.click(screen.getByRole('button', { name: 'Канал' }));
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));

    await waitFor(() => expect(screen.getByText('⚠️ Канал: слишком длинный текст')).toBeTruthy());
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Привет');
    expect(goal).toHaveBeenCalledWith('mobile_quick_post_sent');
  });

  it('shows the server message on 400', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ message: 'Дата публикации уже прошла' }, 400));
    render(<MobilePostScreen />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Привет' } });
    fireEvent.click(screen.getByRole('button', { name: 'Мой VK' }));
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
    await waitFor(() => expect(screen.getByText('Дата публикации уже прошла')).toBeTruthy());
  });

  it('prefills from a shared payload', () => {
    search.params = new URLSearchParams({
      shared: encodeSharePayload({ text: 'Из галереи', media: [{ id: 'm1', path: '/a.jpg' }] }),
      added: 'telegram',
    });
    render(<MobilePostScreen />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Из галереи');
    expect(document.querySelector('img[src="/a.jpg"]')).toBeTruthy();
  });

  it('uploads a picked file and shows the upload error inline', async () => {
    upload.mockRejectedValueOnce(new Error('Фото больше 10 МБ'));
    render(<MobilePostScreen />);
    const input = screen.getByLabelText('Добавить фото или видео') as HTMLInputElement;
    const file = new File(['x'], 'big.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('big.jpg: Фото больше 10 МБ')).toBeTruthy());
  });

  it('remembers selected channels between visits', () => {
    localStorage.setItem('vz-mobile-channels', JSON.stringify(['tg-1', 'gone']));
    render(<MobilePostScreen />);
    expect(screen.getByRole('button', { name: 'Канал' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Мой VK' }).getAttribute('aria-pressed')).toBe('false');
  });
});
```

Run: `pnpm vitest run apps/frontend/src/components/mobile/mobile.post.screen.spec.tsx`
Expected: FAIL on everything except the first-run test.

- [ ] **Step 4: Implement the editor**

Replace `apps/frontend/src/components/mobile/mobile.post.screen.tsx` with:

```tsx
'use client';

import React, {
  ChangeEvent,
  FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useMobileUpload } from '@gitroom/frontend/components/mobile/use.mobile.upload';
import { useMobileGoal } from '@gitroom/frontend/components/mobile/use.mobile.goal';
import { decodeSharePayload } from '@gitroom/frontend/components/mobile/share.payload';
import {
  draftProblem,
  emptyDraft,
  localDateTimeToIso,
  QuickPostDraft,
  QuickPostMedia,
  toQuickPostBody,
} from '@gitroom/frontend/components/mobile/quick.post.request';

const CHANNELS_KEY = 'vz-mobile-channels';

type Channel = {
  id: string;
  name: string;
  identifier: string;
  picture: string;
  disabled: boolean;
  refreshNeeded: boolean;
  inBetweenSteps: boolean;
};

type Result = {
  published: { id: string; name: string }[];
  failed: { id: string; name: string; error: string }[];
};

const isActive = (channel: Channel) =>
  !channel.disabled && !channel.refreshNeeded && !channel.inBetweenSteps;

const readStoredChannels = (): string[] => {
  try {
    const raw = localStorage.getItem(CHANNELS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

const storeChannels = (ids: string[]) => {
  try {
    localStorage.setItem(CHANNELS_KEY, JSON.stringify(ids));
  } catch {
    // storage may be unavailable in private mode; selection just will not persist
  }
};

const isVideo = (path: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(path);

export const MobilePostScreen: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const upload = useMobileUpload();
  const goal = useMobileGoal();
  const searchParams = useSearchParams();
  const { data, isLoading } = useIntegrationList();
  const channels: Channel[] = data || [];

  const [draft, setDraft] = useState<QuickPostDraft>(() => emptyDraft());
  const [dateValue, setDateValue] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const initialised = useRef(false);

  // One-time init: shared payload, stored channels, channel-added goal.
  useEffect(() => {
    if (initialised.current) {
      return;
    }
    initialised.current = true;
    const shared = decodeSharePayload(searchParams.get('shared'));
    const stored = readStoredChannels();
    setDraft((current) => ({
      ...current,
      text: shared?.text || current.text,
      media: shared?.media || current.media,
      selected: stored,
    }));
    if (shared && typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('shared');
      window.history.replaceState(null, '', url.toString());
    }
  }, [searchParams, goal]);

  // Drop stored ids that no longer exist or are inactive once channels load.
  const activeIds = useMemo(
    () => new Set(channels.filter(isActive).map((c) => c.id)),
    [channels]
  );
  useEffect(() => {
    if (!channels.length) {
      return;
    }
    setDraft((current) => {
      const selected = current.selected.filter((id) => activeIds.has(id));
      return selected.length === current.selected.length
        ? current
        : { ...current, selected };
    });
  }, [channels.length, activeIds]);

  const toggleChannel = useCallback((id: string) => {
    setDraft((current) => {
      const selected = current.selected.includes(id)
        ? current.selected.filter((x) => x !== id)
        : [...current.selected, id];
      storeChannels(selected);
      return { ...current, selected };
    });
  }, []);

  const setSchedule = useCallback(
    (type: 'now' | 'queue' | 'date') => {
      setDraft((current) => ({
        ...current,
        schedule:
          type === 'date'
            ? { type: 'date', date: dateValue ? localDateTimeToIso(dateValue) : '' }
            : { type },
      }));
    },
    [dateValue]
  );

  const onDateChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setDateValue(value);
    setDraft((current) => ({
      ...current,
      schedule: { type: 'date', date: value ? localDateTimeToIso(value) : '' },
    }));
  }, []);

  const onFiles = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      for (const file of files) {
        setUploading((n) => n + 1);
        try {
          const media = await upload(file);
          setDraft((current) => ({ ...current, media: [...current.media, media] }));
        } catch (error) {
          setUploadErrors((list) => [
            ...list,
            `${file.name}: ${(error as Error).message}`,
          ]);
        } finally {
          setUploading((n) => n - 1);
        }
      }
    },
    [upload]
  );

  const removeMedia = useCallback((id: string) => {
    setDraft((current) => ({
      ...current,
      media: current.media.filter((m) => m.id !== id),
    }));
  }, []);

  const problem = draftProblem(draft);
  const canSend = !problem && !sending && uploading === 0;

  const send = useCallback(async () => {
    if (!canSend) {
      return;
    }
    setSending(true);
    setServerError(null);
    setResult(null);
    try {
      const response = await fetch('/posts/quick', {
        method: 'POST',
        body: JSON.stringify(toQuickPostBody(draft)),
      });
      if (response.status === 400) {
        const body = await response.json().catch(() => ({}));
        setServerError(
          typeof body?.message === 'string'
            ? body.message
            : t('mobile_send_failed', 'Не удалось отправить, попробуйте ещё раз')
        );
        return;
      }
      if (!response.ok) {
        setServerError(t('mobile_send_failed', 'Не удалось отправить, попробуйте ещё раз'));
        return;
      }
      const outcome = (await response.json()) as Result;
      setResult(outcome);
      goal('mobile_quick_post_sent');
      if (outcome.failed.length === 0) {
        setDraft((current) => ({ ...emptyDraft(), selected: current.selected }));
        setDateValue('');
        setUploadErrors([]);
      }
    } catch {
      setServerError(t('mobile_send_failed', 'Не удалось отправить, попробуйте ещё раз'));
    } finally {
      setSending(false);
    }
  }, [canSend, draft, fetch, goal, t]);

  if (!isLoading && channels.length === 0) {
    return (
      <div className="flex flex-col gap-[16px] pt-[32px] items-start">
        <h1 className="text-[22px] font-[600]">
          {t('mobile_first_run_title', 'Начнём с первого канала')}
        </h1>
        <p className="text-[15px] text-textItemBlur">
          {t(
            'mobile_first_run_hint',
            'Подключите Telegram, VK или другой канал — после этого можно будет постить с телефона.'
          )}
        </p>
        <Link
          href="/m/channels"
          className="h-[48px] px-[20px] inline-flex items-center rounded-[12px] bg-btnPrimary text-btnText text-[15px] font-[600]"
        >
          {t('mobile_first_run_cta', 'Подключить первый канал')}
        </Link>
      </div>
    );
  }

  const scheduleButton = (type: 'now' | 'queue' | 'date', label: string) => (
    <button
      type="button"
      onClick={() => setSchedule(type)}
      aria-pressed={draft.schedule.type === type}
      className={clsx(
        'flex-1 h-[40px] rounded-[10px] text-[14px] font-[600]',
        draft.schedule.type === type
          ? 'bg-boxFocused text-textItemFocused'
          : 'bg-newBgColorInner text-textItemBlur'
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-[16px] pt-[16px]">
      <textarea
        value={draft.text}
        onChange={(event) =>
          setDraft((current) => ({ ...current, text: event.target.value }))
        }
        placeholder={t('mobile_text_placeholder', 'Текст поста')}
        rows={5}
        className="w-full rounded-[12px] bg-newBgColorInner p-[12px] text-[16px] text-newTextColor outline-none"
      />

      <div className="flex gap-[8px] overflow-x-auto">
        {draft.media.map((item: QuickPostMedia) => (
          <div key={item.id} className="relative w-[72px] h-[72px] shrink-0">
            {isVideo(item.path) ? (
              <div className="w-full h-full rounded-[10px] bg-newBgLineColor flex items-center justify-center text-[24px]">
                🎬
              </div>
            ) : (
              <img
                src={item.path}
                alt=""
                className="w-full h-full rounded-[10px] object-cover"
              />
            )}
            <button
              type="button"
              aria-label={t('mobile_remove_media', 'Убрать')}
              onClick={() => removeMedia(item.id)}
              className="absolute -top-[6px] -end-[6px] w-[22px] h-[22px] rounded-full bg-newBgColor text-newTextColor text-[14px] leading-[22px] text-center"
            >
              ×
            </button>
          </div>
        ))}
        <label className="w-[72px] h-[72px] shrink-0 rounded-[10px] border border-dashed border-newBorder flex items-center justify-center text-[28px] text-textItemBlur cursor-pointer">
          <span aria-hidden="true">{uploading ? '…' : '+'}</span>
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={onFiles}
            className="sr-only"
            aria-label={t('mobile_add_media', 'Добавить фото или видео')}
          />
        </label>
      </div>
      {uploadErrors.map((message) => (
        <div key={message} className="text-[13px] text-amber-400">
          {message}
        </div>
      ))}

      <div className="flex gap-[8px] overflow-x-auto">
        {channels.map((channel) => {
          const active = isActive(channel);
          const selected = draft.selected.includes(channel.id);
          return (
            <button
              key={channel.id}
              type="button"
              disabled={!active}
              aria-pressed={selected}
              onClick={() => toggleChannel(channel.id)}
              title={
                active
                  ? undefined
                  : t('mobile_channel_reconnect', 'Нужно переподключить')
              }
              className={clsx(
                'flex items-center gap-[6px] shrink-0 h-[40px] ps-[6px] pe-[12px] rounded-full text-[14px] font-[600]',
                selected
                  ? 'bg-boxFocused text-textItemFocused'
                  : 'bg-newBgColorInner text-textItemBlur',
                !active && 'opacity-40'
              )}
            >
              <img
                src={channel.picture}
                alt=""
                className="w-[28px] h-[28px] rounded-full object-cover"
              />
              {channel.name}
            </button>
          );
        })}
      </div>

      <div className="flex gap-[8px]">
        {scheduleButton('now', t('mobile_schedule_now', 'Сейчас'))}
        {scheduleButton('queue', t('mobile_schedule_queue', 'В очередь'))}
        {scheduleButton('date', t('mobile_schedule_date', 'Дата'))}
      </div>
      {draft.schedule.type === 'date' && (
        <input
          type="datetime-local"
          value={dateValue}
          onChange={onDateChange}
          aria-label={t('mobile_schedule_date', 'Дата')}
          className="h-[44px] rounded-[10px] bg-newBgColorInner px-[12px] text-newTextColor"
        />
      )}

      <button
        type="button"
        onClick={() => void send()}
        disabled={!canSend}
        className="h-[52px] rounded-[12px] bg-btnPrimary text-btnText text-[16px] font-[600] disabled:opacity-50"
      >
        {sending
          ? t('mobile_sending', 'Отправляем…')
          : t('mobile_publish', 'Опубликовать')}
      </button>
      {problem && !result && (
        <div className="text-[13px] text-textItemBlur">{problem}</div>
      )}
      {serverError && (
        <div className="text-[14px] text-amber-400">{serverError}</div>
      )}
      {result && (
        <div className="flex flex-col gap-[4px] text-[14px]">
          {result.published.length > 0 && (
            <div>
              {t('mobile_result_published', '✅ Ушло: ')}
              {result.published.map((p) => p.name).join(', ')}
            </div>
          )}
          {result.failed.map((f) => (
            <div key={f.id} className="text-amber-400">
              {`⚠️ ${f.name}: ${f.error}`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

Note on the "✅ Ушло: Мой VK" assertion: the text is split across the translation string and the names; render both inside one element as above so `getByText` matches the concatenated text node. If jsdom splits the node, wrap the two parts in a single template string: `{`${t('mobile_result_published', '✅ Ушло: ')}${names}`}`.

- [ ] **Step 5: Run the editor tests**

Run: `pnpm vitest run apps/frontend/src/components/mobile/mobile.post.screen.spec.tsx`
Expected: PASS, 8 tests. If `getByAltText('')` is ambiguous because the channel avatars also have `alt=""`, change the shared-payload assertion to `expect(document.querySelector('img[src="/a.jpg"]')).toBeTruthy()`.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/components/mobile/mobile.post.screen.tsx apps/frontend/src/components/mobile/mobile.post.screen.spec.tsx apps/frontend/src/components/mobile/share.payload.ts apps/frontend/src/components/mobile/share.payload.spec.ts
git commit -m "feat(mobile): quick post editor on the post tab

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Очередь screen

**Files:**
- Replace: `apps/frontend/src/components/mobile/mobile.queue.screen.tsx`
- Create: `apps/frontend/src/components/mobile/mobile.queue.screen.spec.tsx`
- Create: `apps/frontend/src/components/mobile/use.mobile.queue.tsx`

**Interfaces:**
- Consumes: `expandPostsList` from `@gitroom/helpers/utils/posts.list.minify`; `GET /posts/list?state=scheduled&limit=50&page=0`; `DELETE /posts/:group`; `deleteDialog` from `@gitroom/react/helpers/delete.dialog` (returns a Promise<boolean>; already used by the app for confirmations).
- Produces: `useMobileQueue(): SWRResponse<{ posts: QueueItem[] }>` where `QueueItem = { id, group, content, publishDate, integration: { id, name, picture, providerIdentifier } }`; `MobileQueueScreen: FC`.

Behaviour: list sorted as returned (ascending by date), each row: channel avatar, channel name, date formatted `DD.MM HH:mm` in the browser zone via `dayjs`, first 80 characters of the content with HTML tags stripped, actions «Открыть» (opens `/p/<id>?share=true` in a new tab) and «Удалить» (confirm via `deleteDialog`, then `DELETE /posts/<group>`, then `mutate()`). Empty: «В очереди пока пусто».

- [ ] **Step 1: Write the failing tests**

Create `apps/frontend/src/components/mobile/mobile.queue.screen.spec.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queue = vi.hoisted(() => ({ data: undefined as any, isLoading: false, mutate: vi.fn() }));
const fetchMock = vi.hoisted(() => vi.fn());
const confirm = vi.hoisted(() => vi.fn());

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@gitroom/frontend/components/mobile/use.mobile.queue', () => ({
  useMobileQueue: () => queue,
}));
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));
vi.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: confirm,
}));

import { MobileQueueScreen } from './mobile.queue.screen';

const item = {
  id: 'p1',
  group: 'g1',
  content: '<p>Привет <b>мир</b></p>',
  publishDate: '2026-10-20T08:30:00.000Z',
  integration: { id: 'vk-1', name: 'Мой VK', picture: '/vk.jpg', providerIdentifier: 'vk' },
};

beforeEach(() => {
  cleanup();
  queue.data = { posts: [item] };
  queue.mutate.mockClear();
  fetchMock.mockReset();
  confirm.mockReset();
  window.open = vi.fn();
});

describe('MobileQueueScreen', () => {
  it('shows the empty state', () => {
    queue.data = { posts: [] };
    render(<MobileQueueScreen />);
    expect(screen.getByText('В очереди пока пусто')).toBeTruthy();
  });

  it('lists upcoming posts with channel, date and stripped text', () => {
    render(<MobileQueueScreen />);
    expect(screen.getByText('Мой VK')).toBeTruthy();
    expect(screen.getByText('Привет мир')).toBeTruthy();
    expect(screen.getByText(/20\.10 \d\d:\d\d/)).toBeTruthy();
  });

  it('opens the preview in a new tab', () => {
    render(<MobileQueueScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    expect(window.open).toHaveBeenCalledWith('/p/p1?share=true', '_blank');
  });

  it('asks before deleting and deletes the group when confirmed', async () => {
    confirm.mockResolvedValueOnce(true);
    fetchMock.mockResolvedValueOnce({ ok: true } as Response);
    render(<MobileQueueScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/posts/g1', { method: 'DELETE' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(queue.mutate).toHaveBeenCalledTimes(1);
  });

  it('does nothing when deletion is declined', async () => {
    confirm.mockResolvedValueOnce(false);
    render(<MobileQueueScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm vitest run apps/frontend/src/components/mobile/mobile.queue.screen.spec.tsx`
Expected: FAIL (stub text, no list).

- [ ] **Step 2: Implement the hook and the screen**

Check the signature of `deleteDialog` first: `sed -n 1,30p libraries/react-shared-libraries/src/helpers/delete.dialog.tsx`. It is called in `layout.context.tsx` as `await deleteDialog('message', 'Yes')`; use the same two-argument form.

Create `apps/frontend/src/components/mobile/use.mobile.queue.tsx`:

```tsx
'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { expandPostsList } from '@gitroom/helpers/utils/posts.list.minify';

export type QueueItem = {
  id: string;
  group: string;
  content: string;
  publishDate: string;
  integration: { id: string; name: string; picture: string; providerIdentifier: string };
};

export const useMobileQueue = () => {
  const fetch = useFetch();
  const load = useCallback(
    async (path: string) =>
      expandPostsList(await (await fetch(path)).json()) as { posts: QueueItem[] },
    [fetch]
  );
  return useSWR('/posts/list?state=scheduled&limit=50&page=0', load, {
    revalidateOnFocus: true,
    revalidateOnReconnect: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};
```

Replace `apps/frontend/src/components/mobile/mobile.queue.screen.tsx` with:

```tsx
'use client';

import React, { FC, useCallback } from 'react';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import {
  QueueItem,
  useMobileQueue,
} from '@gitroom/frontend/components/mobile/use.mobile.queue';

const stripHtml = (html: string) =>
  html
    .replace(/<\/p>\s*<p>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

const excerpt = (html: string) => {
  const text = stripHtml(html);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
};

export const MobileQueueScreen: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const { data, isLoading, mutate } = useMobileQueue();
  const posts: QueueItem[] = data?.posts || [];

  const open = useCallback((post: QueueItem) => {
    window.open(`/p/${post.id}?share=true`, '_blank');
  }, []);

  const remove = useCallback(
    async (post: QueueItem) => {
      const yes = await deleteDialog(
        t('mobile_queue_delete_confirm', 'Удалить этот пост из очереди?'),
        t('mobile_queue_delete_yes', 'Удалить')
      );
      if (!yes) {
        return;
      }
      await fetch(`/posts/${post.group}`, { method: 'DELETE' });
      mutate();
    },
    [fetch, mutate, t]
  );

  return (
    <div className="flex flex-col gap-[16px] pt-[16px]">
      <h1 className="text-[22px] font-[600]">
        {t('mobile_queue_title', 'Очередь')}
      </h1>
      {!isLoading && posts.length === 0 ? (
        <p className="text-textItemBlur text-[15px]">
          {t('mobile_queue_empty', 'В очереди пока пусто')}
        </p>
      ) : (
        <ul className="flex flex-col gap-[8px]">
          {posts.map((post) => (
            <li
              key={post.id}
              className="flex flex-col gap-[8px] rounded-[12px] bg-newBgColorInner p-[12px]"
            >
              <div className="flex items-center gap-[10px]">
                <img
                  src={post.integration.picture}
                  alt=""
                  className="w-[32px] h-[32px] rounded-full object-cover"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-[600] truncate">
                    {post.integration.name}
                  </div>
                  <div className="text-[12px] text-textItemBlur">
                    {dayjs(post.publishDate).format('DD.MM HH:mm')}
                  </div>
                </div>
              </div>
              <div className="text-[14px]">{excerpt(post.content)}</div>
              <div className="flex gap-[8px]">
                <button
                  type="button"
                  onClick={() => open(post)}
                  className="flex-1 h-[36px] rounded-[10px] bg-btnSimple text-btnText text-[13px] font-[600]"
                >
                  {t('mobile_queue_open', 'Открыть')}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(post)}
                  className="flex-1 h-[36px] rounded-[10px] bg-btnSimple text-amber-400 text-[13px] font-[600]"
                >
                  {t('mobile_queue_delete', 'Удалить')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
```

- [ ] **Step 3: Run the tests**

Run: `pnpm vitest run apps/frontend/src/components/mobile/mobile.queue.screen.spec.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/components/mobile/mobile.queue.screen.tsx apps/frontend/src/components/mobile/mobile.queue.screen.spec.tsx apps/frontend/src/components/mobile/use.mobile.queue.tsx
git commit -m "feat(mobile): queue screen with preview and delete

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Web manifest, icons and Share Target route

**Files:**
- Create: `apps/frontend/src/app/manifest.ts`
- Create: `apps/frontend/public/icons/vezdepost-192.png`, `apps/frontend/public/icons/vezdepost-512.png` (generated once by a scratch script, committed as binaries)
- Create: `apps/frontend/src/app/(app)/(mobile)/m/share/route.ts`
- Create: `apps/frontend/src/app/(app)/(mobile)/m/share/route.spec.ts`
- Create: `apps/frontend/src/components/mobile/share.handler.ts`

**Interfaces:**
- Consumes: `encodeSharePayload` from Task 3; `internalFetch` from `@gitroom/helpers/utils/internal.fetch` (server-side fetch to the backend that forwards the `auth` and `showorg` cookies and sends FormData untouched).
- Produces:

```ts
// share.handler.ts — framework-free so it is unit-testable
export const handleShare: (
  form: FormData,
  deps: { upload: (file: File) => Promise<{ id: string; path: string } | null> }
) => Promise<string>;   // returns the redirect path '/m?shared=<payload>' (or '/m' when nothing usable was shared)
```

The manifest is served by Next at `/manifest.webmanifest` and linked automatically from every layout. The proxy's matcher skips paths that look like files, so it needs no auth. Share Target entries: `action: '/m/share'`, `method: 'POST'`, `enctype: 'multipart/form-data'`, params `title`, `text`, `url`, files named `media` accepting `image/*` and `video/*`.

- [ ] **Step 1: Write the failing handler tests**

Create `apps/frontend/src/app/(app)/(mobile)/m/share/route.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { handleShare } from '@gitroom/frontend/components/mobile/share.handler';
import { decodeSharePayload } from '@gitroom/frontend/components/mobile/share.payload';

const payloadOf = (path: string) =>
  decodeSharePayload(new URL(path, 'https://app.test').searchParams.get('shared'));

describe('handleShare', () => {
  it('uploads shared files and redirects with the payload', async () => {
    const upload = vi.fn(async (file: File) => ({ id: `id-${file.name}`, path: `/u/${file.name}` }));
    const form = new FormData();
    form.append('text', 'Из галереи');
    form.append('media', new File(['a'], 'a.jpg', { type: 'image/jpeg' }));
    form.append('media', new File(['b'], 'b.mp4', { type: 'video/mp4' }));

    const target = await handleShare(form, { upload });

    expect(target.startsWith('/m?shared=')).toBe(true);
    expect(payloadOf(target)).toEqual({
      text: 'Из галереи',
      media: [
        { id: 'id-a.jpg', path: '/u/a.jpg' },
        { id: 'id-b.mp4', path: '/u/b.mp4' },
      ],
    });
  });

  it('redirects with text only', async () => {
    const upload = vi.fn();
    const form = new FormData();
    form.append('title', 'Заголовок');
    form.append('text', 'Только текст');
    form.append('url', 'https://example.com');

    const target = await handleShare(form, { upload });

    expect(upload).not.toHaveBeenCalled();
    expect(payloadOf(target)).toEqual({
      text: 'Заголовок\nТолько текст\nhttps://example.com',
      media: [],
    });
  });

  it('skips files the upload rejects and goes to a plain /m when nothing is left', async () => {
    const upload = vi.fn(async () => null);
    const form = new FormData();
    form.append('media', new File(['a'], 'a.jpg', { type: 'image/jpeg' }));

    expect(await handleShare(form, { upload })).toBe('/m');
  });
});
```

Run: `pnpm vitest run "apps/frontend/src/app/(app)/(mobile)/m/share/route.spec.ts"`
Expected: FAIL, cannot find module `share.handler`.

- [ ] **Step 2: Implement the handler, the route, the manifest and the icons**

Create `apps/frontend/src/components/mobile/share.handler.ts`:

```ts
import { encodeSharePayload } from '@gitroom/frontend/components/mobile/share.payload';

type Uploaded = { id: string; path: string } | null;

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
};

/** Builds the /m redirect for a Web Share Target POST. */
export const handleShare = async (
  form: FormData,
  deps: { upload: (file: File) => Promise<Uploaded> }
): Promise<string> => {
  const parts = [text(form, 'title'), text(form, 'text'), text(form, 'url')].filter(Boolean);
  const files = form
    .getAll('media')
    .filter((entry): entry is File => typeof entry !== 'string' && entry.size > 0);

  const media: { id: string; path: string }[] = [];
  for (const file of files) {
    const uploaded = await deps.upload(file);
    if (uploaded) {
      media.push(uploaded);
    }
  }

  const joined = parts.join('\n');
  if (!joined && media.length === 0) {
    return '/m';
  }
  return `/m?shared=${encodeSharePayload({ text: joined, media })}`;
};
```

Create `apps/frontend/src/app/(app)/(mobile)/m/share/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
import { handleShare } from '@gitroom/frontend/components/mobile/share.handler';

export const dynamic = 'force-dynamic';

const upload = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file, file.name);
  const response = await internalFetch('/media/upload-simple', {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    return null;
  }
  const data = await response.json();
  return typeof data?.id === 'string' && typeof data?.path === 'string'
    ? { id: data.id, path: data.path }
    : null;
};

/** Android Web Share Target: files and text arrive here as multipart/form-data. */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const target = await handleShare(form, { upload });
  return NextResponse.redirect(new URL(target, request.nextUrl.href), 303);
}

/** A plain GET (someone typing the URL) just opens the editor. */
export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/m', request.nextUrl.href), 307);
}
```

Create `apps/frontend/src/app/manifest.ts`:

```ts
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Vezdepost',
    short_name: 'Vezdepost',
    description: 'Публикуйте в Telegram, VK, MAX и другие каналы с телефона',
    start_url: '/m',
    scope: '/',
    display: 'standalone',
    background_color: '#0e0e0e',
    theme_color: '#0e0e0e',
    lang: 'ru',
    icons: [
      { src: '/icons/vezdepost-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/vezdepost-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
    share_target: {
      action: '/m/share',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        title: 'title',
        text: 'text',
        url: 'url',
        files: [{ name: 'media', accept: ['image/*', 'video/*'] }],
      },
    },
  };
}
```

Generate the icons once with a scratch script (not committed) in the session scratchpad directory, using the `sharp` dependency already installed; the SVG is the mark from `components/new-layout/logo.tsx` on a purple rounded square:

```js
// scratch: make-icons.mjs  (run: node make-icons.mjs <repo>/apps/frontend/public/icons)
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const mark = `<path transform="translate(96 96) scale(5.333)" d="M31.0188 12.0956L31.2277 14.7969C31.6025 14.3332 32.0909 13.9331 32.6929 13.5967C33.2931 13.2362 34.0374 13.0217 34.9259 12.953C35.7423 12.8899 36.5227 12.9865 37.2672 13.243C38.0357 13.4976 38.723 13.9517 39.3291 14.6054C39.9574 15.2332 40.4832 16.0983 40.9067 17.2009C41.3301 18.3035 41.604 19.6592 41.7284 21.268C41.8175 22.4205 41.7985 23.5814 41.6715 24.7507C41.5685 25.9182 41.3002 26.9776 40.8665 27.929C40.4328 28.8805 39.806 29.6777 38.9861 30.3209C38.1884 30.9381 37.1532 31.2959 35.8806 31.3943C34.9681 31.4649 34.2385 31.4005 33.6917 31.2012C33.143 30.9779 32.7236 30.7084 32.4335 30.3927L33.1102 39.145L28.0238 40.8427L25.8323 12.4966L31.0188 12.0956ZM33.9095 28.3944C34.5338 28.3462 35.0463 28.1012 35.4469 27.6596C35.8457 27.194 36.1392 26.6157 36.3273 25.9248C36.5395 25.2321 36.662 24.4738 36.6949 23.6499C36.75 22.8002 36.746 21.9672 36.6829 21.1508C36.5808 19.8301 36.38 18.7949 36.0804 18.0451C35.8049 17.2934 35.4972 16.7495 35.1572 16.4135C34.8153 16.0534 34.4846 15.8374 34.165 15.7655C33.8694 15.6918 33.6376 15.6614 33.4695 15.6744C33.0373 15.7078 32.6292 15.8963 32.2451 16.2401C31.8592 16.5598 31.5934 17.0272 31.4477 17.6423L32.2246 27.6913C32.3595 27.8741 32.5665 28.0514 32.8455 28.2231C33.1226 28.3707 33.4773 28.4278 33.9095 28.3944Z" fill="#ffffff"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#612bd3"/>${mark}</svg>`;
const out = process.argv[2];
for (const size of [192, 512]) {
  const png = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  writeFileSync(join(out, `vezdepost-${size}.png`), png);
}
console.log('icons written');
```

Run it, then `file apps/frontend/public/icons/vezdepost-512.png` must print `PNG image data, 512 x 512`.

- [ ] **Step 3: Run the handler tests and build the frontend**

Run: `pnpm vitest run "apps/frontend/src/app/(app)/(mobile)/m/share/route.spec.ts" apps/frontend/src/components/mobile`
Expected: PASS.

Run: `pnpm run build:frontend > <workspace>/build-t5.log 2>&1; echo $?; grep -nE "manifest|/m/share|Type error|Error:" <workspace>/build-t5.log | head`
Expected: exit 0; `/manifest.webmanifest` and `/m/share` in the route table. If the `share_target.params.files` typing rejects the array form, cast the `files` value with `as unknown as MetadataRoute.Manifest['share_target']` on the whole `share_target` object and note it in the ledger.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/app/manifest.ts apps/frontend/public/icons/vezdepost-192.png apps/frontend/public/icons/vezdepost-512.png "apps/frontend/src/app/(app)/(mobile)/m/share" apps/frontend/src/components/mobile/share.handler.ts
git commit -m "feat(mobile): web manifest with Android Share Target into the editor

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Docs, spec status, full suite

**Files:**
- Modify: `apps/frontend/src/components/mobile/mobile.layout.component.tsx` (shell parity: add `useUserTimezoneSync(user?.timezoneName, mutate)` from `layout/use.personal.streak` and `<AuthenticatedAppOpened />` from `layout/authenticated.app.opened`, exactly as `new-layout/layout.component.tsx` does)
- Modify: `docs/PROJECT.md` (extend the «Мобильная версия /m» section)
- Modify: `docs/superpowers/specs/2026-10-12-mobile-version-design.md` (stage 3 row → done)

- [ ] **Step 1: Document**

Append to the «Мобильная версия `/m`» section of `docs/PROJECT.md`:

```markdown
Экран «Пост» отправляет в `POST /posts/quick`; медиа грузится через
`/media/upload-simple` с клиентским сжатием картинок (>1.5 МБ или >2048 px →
JPEG 0.85, GIF не трогаем). «Очередь» читает `/posts/list?state=scheduled`
и удаляет `DELETE /posts/:group`. Web-манифест `/manifest.webmanifest`
(иконки `public/icons/vezdepost-*.png`) объявляет Share Target: Android
отправляет файлы POST-ом в `/m/share`, который заливает их в медиатеку и
редиректит на `/m?shared=<payload>`. Цели продукта: события
`mobile_channel_added` и `mobile_quick_post_sent` уходят в PostHog и в
`dataLayer` (для GTM/Метрики).
```

In the spec stage table, change row 3's "Результат" cell to start with `Готово (коммит <sha of Task 5 commit>).`

- [ ] **Step 2: Full suite**

Run: `pnpm vitest run > <workspace>/full-suite.log 2>&1; echo $?; grep -E "Test Files|Tests |FAIL" <workspace>/full-suite.log | head`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add docs/PROJECT.md docs/superpowers/specs/2026-10-12-mobile-version-design.md
git commit -m "docs: mobile quick post, queue and share target

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
