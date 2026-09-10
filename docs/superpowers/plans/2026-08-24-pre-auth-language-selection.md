# Pre-Auth Language Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make locale detection request-scoped and durable, expose the shared language selector throughout unauthenticated auth routes, and make its modal and controls accessible and responsive.

**Architecture:** Centralize supported-language normalization, direction, and the 365-day cookie contract in the shared translation library. The proxy resolves and persists the request locale, while a request-scoped server helper supplies the same locale to server translations and root HTML attributes without mutating the global i18next language. The existing shared modal and language selector receive additive accessibility/responsive behavior, then the auth layout mounts them once and renders its social proof through a client translation component.

**Tech Stack:** Next.js 16 App Router and proxy, React 19, TypeScript, i18next/react-i18next, Zustand modal store, Tailwind CSS 3, Vitest, Testing Library, jsdom.

## Global Constraints

- Follow the approved design in `docs/superpowers/specs/2026-08-24-onboarding-channel-availability-and-language-design.md`, limited to pre-auth language selection and locale persistence.
- Execute this plan in an isolated git worktree created with `superpowers:using-git-worktrees`; preserve unrelated changes in the primary checkout.
- Bootstrap a new worktree with `pnpm install --frozen-lockfile`, then run `pnpm run verify:workspace` before the first test or build.
- Use only PNPM and existing dependencies; do not install a new component, cookie, localization, focus-management, or testing package.
- The language cookie is named `i18next`, uses `Path=/`, `Max-Age=31536000` (365 days), `SameSite=Lax`, is readable by client JavaScript, and adds `Secure` on HTTPS.
- A valid existing language cookie has priority; an invalid existing cookie resolves to English; without a cookie, use the supported `Accept-Language` result or English.
- English remains the safe fallback and `he`/`ar` are the only RTL languages.
- Do not edit translation JSON catalogues: all strings used by this plan already exist (`change_language`, `close`, and the four `billing_*` social-proof keys).
- Do not edit backend integration/deploy code, channel-picker files, onboarding files, or PostHog behavior; PostHog reset is explicitly outside this plan.
- Modal changes are additive: preserve existing store APIs, stacking, outside-click behavior, Escape behavior, and all existing callers.
- Before completion, run focused tests, the complete Vitest suite, `pnpm run build:frontend`, and `git diff --check` with fresh passing output.

## File Structure

- `libraries/react-shared-libraries/src/translation/i18n.config.ts`: supported-language validation, normalization, direction, and cookie lifetime constants.
- `libraries/react-shared-libraries/src/translation/language.cookie.ts`: browser serialization and persistence of the shared 365-day language cookie.
- `libraries/react-shared-libraries/src/translation/get.request.language.ts`: request-scoped locale resolution from the forwarded proxy header and cookie.
- `libraries/react-shared-libraries/src/translation/get.translation.service.backend.ts`: fixed-language server translator for the current request.
- `apps/frontend/src/proxy.ts`: request locale selection, forwarding, and durable response-cookie persistence.
- `apps/frontend/src/app/(app)/layout.tsx`: request locale consumption and first-render root `lang`/`dir` attributes.
- `apps/frontend/src/components/layout/new-modal.tsx`: additive dialog naming, initial focus, focus restoration, and close-button metadata.
- `apps/frontend/src/components/layout/language.component.tsx`: native controls, durable manual selection, HTML language/direction updates, and viewport-safe layout.
- `apps/frontend/src/components/auth/auth.social-proof.tsx`: client-translated desktop auth social proof using existing catalogue keys.
- `apps/frontend/src/app/(app)/auth/layout.tsx`: one shared auth header containing logo/selector, modal renderer, and translated social proof.
- Co-located `*.spec.ts`/`*.spec.tsx` files: focused red/green coverage for each responsibility.

---

### Task 1: Shared Locale and Cookie Contract

**Files:**
- Modify: `libraries/react-shared-libraries/src/translation/i18n.config.ts:1-21`
- Create: `libraries/react-shared-libraries/src/translation/language.cookie.ts`
- Create: `libraries/react-shared-libraries/src/translation/language.contract.spec.ts`

**Interfaces:**
- Consumes: the existing `languages`, `fallbackLng`, and `cookieName` exports.
- Produces: `languageCookieMaxAgeSeconds: number`, `isSupportedLanguage(value: string | null | undefined): boolean`, `normalizeLanguage(value: string | null | undefined): string`, `getLanguageDirection(language: string | null | undefined): 'ltr' | 'rtl'`, `serializeLanguageCookie(language: string, secure: boolean): string`, and `persistLanguageCookie(language: string): void`.

- [ ] **Step 1: Bootstrap the isolated worktree**

Run:

```bash
rtk pnpm install --frozen-lockfile
rtk pnpm run verify:workspace
```

Expected: install exits `0`, then workspace verification prints a successful bootstrap result and exits `0`.

- [ ] **Step 2: Write the failing shared-contract test**

Create `libraries/react-shared-libraries/src/translation/language.contract.spec.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  fallbackLng,
  getLanguageDirection,
  isSupportedLanguage,
  languageCookieMaxAgeSeconds,
  normalizeLanguage,
} from './i18n.config';
import {
  persistLanguageCookie,
  serializeLanguageCookie,
} from './language.cookie';

describe('language contract', () => {
  beforeEach(() => {
    document.cookie = 'i18next=; Max-Age=0; Path=/';
  });

  it('normalizes only configured languages and falls back to English', () => {
    expect(isSupportedLanguage('ru')).toBe(true);
    expect(isSupportedLanguage('ar')).toBe(true);
    expect(isSupportedLanguage('bn')).toBe(false);
    expect(normalizeLanguage('ru')).toBe('ru');
    expect(normalizeLanguage('invalid')).toBe(fallbackLng);
    expect(normalizeLanguage(undefined)).toBe(fallbackLng);
  });

  it('uses RTL only for Hebrew and Arabic', () => {
    expect(getLanguageDirection('he')).toBe('rtl');
    expect(getLanguageDirection('ar')).toBe('rtl');
    expect(getLanguageDirection('ru')).toBe('ltr');
    expect(getLanguageDirection('invalid')).toBe('ltr');
  });

  it('serializes the exact 365-day cookie contract', () => {
    expect(languageCookieMaxAgeSeconds).toBe(31_536_000);
    expect(serializeLanguageCookie('ru', false)).toBe(
      'i18next=ru; Path=/; Max-Age=31536000; SameSite=Lax'
    );
    expect(serializeLanguageCookie('ar', true)).toBe(
      'i18next=ar; Path=/; Max-Age=31536000; SameSite=Lax; Secure'
    );
    expect(serializeLanguageCookie('invalid', false)).toContain('i18next=en;');
  });

  it('persists a client-readable language cookie', () => {
    persistLanguageCookie('ru');
    expect(document.cookie).toContain('i18next=ru');
  });
});
```

- [ ] **Step 3: Run the shared-contract test to verify RED**

Run:

```bash
rtk pnpm exec vitest run libraries/react-shared-libraries/src/translation/language.contract.spec.ts --reporter=default
```

Expected: FAIL because `getLanguageDirection`, `isSupportedLanguage`, `languageCookieMaxAgeSeconds`, `normalizeLanguage`, and `./language.cookie` do not exist.

- [ ] **Step 4: Implement the shared language helpers**

Replace `libraries/react-shared-libraries/src/translation/i18n.config.ts` with:

```ts
export const fallbackLng = 'en';
export const languages = [
  fallbackLng,
  'he',
  'ru',
  'zh',
  'fr',
  'es',
  'pt',
  'de',
  'it',
  'ja',
  'ko',
  'ar',
  'tr',
  'vi',
];

export const defaultNS = 'translation';
export const cookieName = 'i18next';
export const headerName = 'x-i18next-current-language';
export const languageCookieMaxAgeSeconds = 60 * 60 * 24 * 365;

export const isSupportedLanguage = (
  value: string | null | undefined
): value is string => typeof value === 'string' && languages.includes(value);

export const normalizeLanguage = (
  value: string | null | undefined
): string => (isSupportedLanguage(value) ? value : fallbackLng);

export const getLanguageDirection = (
  language: string | null | undefined
): 'ltr' | 'rtl' =>
  language === 'he' || language === 'ar' ? 'rtl' : 'ltr';
```

Create `libraries/react-shared-libraries/src/translation/language.cookie.ts`:

```ts
import {
  cookieName,
  languageCookieMaxAgeSeconds,
  normalizeLanguage,
} from './i18n.config';

export const serializeLanguageCookie = (
  language: string,
  secure: boolean
): string =>
  [
    `${cookieName}=${encodeURIComponent(normalizeLanguage(language))}`,
    'Path=/',
    `Max-Age=${languageCookieMaxAgeSeconds}`,
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');

export const persistLanguageCookie = (language: string): void => {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }

  document.cookie = serializeLanguageCookie(
    language,
    window.location.protocol === 'https:'
  );
};
```

- [ ] **Step 5: Run the shared-contract test to verify GREEN**

Run:

```bash
rtk pnpm exec vitest run libraries/react-shared-libraries/src/translation/language.contract.spec.ts --reporter=default
```

Expected: PASS with `4 passed` and no unhandled errors.

- [ ] **Step 6: Commit the shared contract**

```bash
rtk git add libraries/react-shared-libraries/src/translation/i18n.config.ts libraries/react-shared-libraries/src/translation/language.cookie.ts libraries/react-shared-libraries/src/translation/language.contract.spec.ts
rtk git commit -m "feat: define durable language preference contract"
```

---

### Task 2: Request-Scoped Locale Resolution and Server Rendering

**Files:**
- Create: `libraries/react-shared-libraries/src/translation/get.request.language.ts`
- Create: `libraries/react-shared-libraries/src/translation/get.request.language.spec.ts`
- Modify: `libraries/react-shared-libraries/src/translation/get.translation.service.backend.ts:1-12`
- Create: `libraries/react-shared-libraries/src/translation/get.translation.service.backend.spec.ts`
- Modify: `apps/frontend/src/proxy.ts:1-40`
- Create: `apps/frontend/src/proxy.localization.spec.ts`
- Modify: `apps/frontend/src/app/(app)/layout.tsx:17-41,53-57`
- Create: `apps/frontend/src/app/(app)/layout.locale.spec.ts`

**Interfaces:**
- Consumes: `normalizeLanguage`, `isSupportedLanguage`, `getLanguageDirection`, `languageCookieMaxAgeSeconds`, `cookieName`, and `headerName` from Task 1.
- Produces: `getRequestLanguage(): Promise<string>` for server layouts/translators and `resolveProxyLanguage(cookieLanguage: string | undefined, acceptLanguageHeader: string | null): string` for deterministic proxy behavior.

- [ ] **Step 1: Write failing request-locale tests**

Create `libraries/react-shared-libraries/src/translation/get.request.language.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { headersMock, cookiesMock } = vi.hoisted(() => ({
  headersMock: vi.fn(),
  cookiesMock: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: headersMock,
  cookies: cookiesMock,
}));

import { getRequestLanguage } from './get.request.language';

describe('getRequestLanguage', () => {
  beforeEach(() => {
    headersMock.mockReset();
    cookiesMock.mockReset();
    headersMock.mockResolvedValue({ get: vi.fn().mockReturnValue(null) });
    cookiesMock.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) });
  });

  it('uses the normalized proxy header first', async () => {
    headersMock.mockResolvedValue({ get: vi.fn().mockReturnValue('ru') });
    cookiesMock.mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'en' }) });
    await expect(getRequestLanguage()).resolves.toBe('ru');
  });

  it('uses a valid cookie when the proxy header is unavailable', async () => {
    cookiesMock.mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'ar' }) });
    await expect(getRequestLanguage()).resolves.toBe('ar');
  });

  it('falls back to English for invalid or missing request state', async () => {
    headersMock.mockResolvedValue({ get: vi.fn().mockReturnValue('invalid') });
    cookiesMock.mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'bn' }) });
    await expect(getRequestLanguage()).resolves.toBe('en');
  });
});
```

Create `libraries/react-shared-libraries/src/translation/get.translation.service.backend.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getRequestLanguageMock } = vi.hoisted(() => ({
  getRequestLanguageMock: vi.fn(),
}));

vi.mock('./get.request.language', () => ({
  getRequestLanguage: getRequestLanguageMock,
}));

import { getT } from './get.translation.service.backend';

describe('getT', () => {
  beforeEach(() => {
    getRequestLanguageMock.mockReset();
  });

  it('returns request-fixed translators without changing global language', async () => {
    getRequestLanguageMock.mockResolvedValueOnce('ru').mockResolvedValueOnce('en');

    const [russianT, englishT] = await Promise.all([getT(), getT()]);

    expect(russianT('sign_up')).toBe('Зарегистрироваться');
    expect(englishT('sign_up')).toBe('Sign Up');
  });
});
```

Create `apps/frontend/src/proxy.localization.spec.ts`:

```ts
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy, resolveProxyLanguage } from './proxy';

describe('proxy localization', () => {
  it('gives a valid cookie priority and rejects an invalid cookie to English', () => {
    expect(resolveProxyLanguage('ru', 'en-US')).toBe('ru');
    expect(resolveProxyLanguage('invalid', 'ru-RU')).toBe('en');
  });

  it('uses Accept-Language only when no cookie exists', () => {
    expect(resolveProxyLanguage(undefined, 'ru-RU,ru;q=0.9')).toBe('ru');
    expect(resolveProxyLanguage(undefined, 'bn-BD')).toBe('en');
    expect(resolveProxyLanguage(undefined, null)).toBe('en');
  });

  it('persists the detected locale for 365 days on an auth response', async () => {
    const response = await proxy(
      new NextRequest('https://app.vezdepost.ru/auth', {
        headers: { 'accept-language': 'ru-RU,ru;q=0.9' },
      })
    );
    const setCookie = response.headers.get('set-cookie') || '';

    expect(response.cookies.get('i18next')?.value).toBe('ru');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('Max-Age=31536000');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
    expect(setCookie.toLowerCase()).toContain('secure');
  });
});
```

Create `apps/frontend/src/app/(app)/layout.locale.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8');

describe('app root locale metadata', () => {
  it('uses the request locale for root language, direction, and client context', () => {
    expect(source).toContain('const language = await getRequestLanguage();');
    expect(source).toContain('const direction = getLanguageDirection(language);');
    expect(source).toContain('<html lang={language} dir={direction}>');
    expect(source).toContain('language={language}');
  });
});
```

- [ ] **Step 2: Run request-locale tests to verify RED**

Run:

```bash
rtk pnpm exec vitest run libraries/react-shared-libraries/src/translation/get.request.language.spec.ts libraries/react-shared-libraries/src/translation/get.translation.service.backend.spec.ts apps/frontend/src/proxy.localization.spec.ts 'apps/frontend/src/app/(app)/layout.locale.spec.ts' --reporter=default
```

Expected: FAIL because `get.request.language.ts`, `resolveProxyLanguage`, the durable response cookie, and root `lang`/`dir` integration do not exist; the translator test also observes the current global/fallback language behavior.

- [ ] **Step 3: Implement request-scoped language resolution and translation**

Create `libraries/react-shared-libraries/src/translation/get.request.language.ts`:

```ts
import { cookies, headers } from 'next/headers';
import {
  cookieName,
  fallbackLng,
  headerName,
  isSupportedLanguage,
} from './i18n.config';

export const getRequestLanguage = async (): Promise<string> => {
  const [requestHeaders, requestCookies] = await Promise.all([
    headers(),
    cookies(),
  ]);
  const forwardedLanguage = requestHeaders.get(headerName);
  if (isSupportedLanguage(forwardedLanguage)) {
    return forwardedLanguage;
  }

  const cookieLanguage = requestCookies.get(cookieName)?.value;
  return isSupportedLanguage(cookieLanguage) ? cookieLanguage : fallbackLng;
};
```

Replace `libraries/react-shared-libraries/src/translation/get.translation.service.backend.ts` with:

```ts
import i18next from './i18next';
import { getRequestLanguage } from './get.request.language';

export async function getT(ns?: string, options?: any) {
  const language = await getRequestLanguage();
  await i18next.loadLanguages(language);
  if (ns && !i18next.hasLoadedNamespace(ns)) {
    await i18next.loadNamespaces(ns);
  }
  return i18next.getFixedT(
    language,
    Array.isArray(ns) ? ns[0] : ns,
    options?.keyPrefix
  );
}
```

- [ ] **Step 4: Implement proxy resolution and 365-day persistence**

Update the translation import in `apps/frontend/src/proxy.ts` to:

```ts
import {
  cookieName,
  fallbackLng,
  headerName,
  isSupportedLanguage,
  languageCookieMaxAgeSeconds,
  languages,
} from '@gitroom/react/translation/i18n.config';
```

Immediately after `acceptLanguage.languages(languages);`, add:

```ts
export const resolveProxyLanguage = (
  cookieLanguage: string | undefined,
  acceptLanguageHeader: string | null
): string => {
  if (typeof cookieLanguage !== 'undefined') {
    return isSupportedLanguage(cookieLanguage) ? cookieLanguage : fallbackLng;
  }

  return acceptLanguage.get(acceptLanguageHeader || '') || fallbackLng;
};
```

Replace the current `lng` calculation inside `proxy()` with:

```ts
  const lng = resolveProxyLanguage(
    request.cookies.get(cookieName)?.value,
    request.headers.get('Accept-Language') ||
      request.headers.get('accept-language')
  );
```

Keep forwarding the normalized request header, then replace `topResponse.headers.set(cookieName, lng)` with:

```ts
  topResponse.cookies.set({
    name: cookieName,
    value: lng,
    path: '/',
    maxAge: languageCookieMaxAgeSeconds,
    sameSite: 'lax',
    secure: nextUrl.protocol === 'https:',
    httpOnly: false,
  });
```

- [ ] **Step 5: Use the request locale for first-render HTML metadata**

In `apps/frontend/src/app/(app)/layout.tsx`, remove:

```ts
import { cookies } from 'next/headers';
import {
  cookieName,
  fallbackLng,
} from '@gitroom/react/translation/i18n.config';
```

Add:

```ts
import { getLanguageDirection } from '@gitroom/react/translation/i18n.config';
import { getRequestLanguage } from '@gitroom/react/translation/get.request.language';
```

Replace the first two locale statements inside `AppLayout`:

```ts
  const cookieStore = await cookies();
  const language = cookieStore.get(cookieName)?.value || fallbackLng;
```

with:

```ts
  const language = await getRequestLanguage();
  const direction = getLanguageDirection(language);
```

Replace:

```tsx
    <html>
```

with:

```tsx
    <html lang={language} dir={direction}>
```

Keep the existing `language={language}` prop on `VariableContextComponent` unchanged.

- [ ] **Step 6: Run request-locale tests to verify GREEN**

Run:

```bash
rtk pnpm exec vitest run libraries/react-shared-libraries/src/translation/get.request.language.spec.ts libraries/react-shared-libraries/src/translation/get.translation.service.backend.spec.ts apps/frontend/src/proxy.localization.spec.ts 'apps/frontend/src/app/(app)/layout.locale.spec.ts' --reporter=default
```

Expected: PASS with `8 passed`, proving valid-cookie priority, invalid-cookie English fallback, `Accept-Language` detection, durable cookie attributes, request-fixed server translations, and root `lang`/`dir` wiring.

- [ ] **Step 7: Commit request-scoped localization**

```bash
rtk git add libraries/react-shared-libraries/src/translation/get.request.language.ts libraries/react-shared-libraries/src/translation/get.request.language.spec.ts libraries/react-shared-libraries/src/translation/get.translation.service.backend.ts libraries/react-shared-libraries/src/translation/get.translation.service.backend.spec.ts apps/frontend/src/proxy.ts apps/frontend/src/proxy.localization.spec.ts 'apps/frontend/src/app/(app)/layout.tsx' 'apps/frontend/src/app/(app)/layout.locale.spec.ts'
rtk git commit -m "fix: make app locale request scoped"
```

---

### Task 3: Add Accessible Modal Metadata and Focus

**Files:**
- Modify: `apps/frontend/src/components/layout/new-modal.tsx:4-13,19-37,98-130,197-240`
- Create: `apps/frontend/src/components/layout/new-modal.accessibility.spec.tsx`

**Interfaces:**
- Consumes: the existing `useModals()` and `ModalManager` APIs.
- Produces: additive `OpenModalInterface` fields `ariaLabel?: string` and `closeButtonAriaLabel?: string`; rendered modals expose `role="dialog"`, `aria-modal="true"`, a stable accessible name, initial dialog focus, focus restoration on unmount, and Tab/Shift+Tab containment on the last-open dialog only.

- [ ] **Step 1: Write the failing modal accessibility test**

Create `apps/frontend/src/components/layout/new-modal.accessibility.spec.tsx`:

```tsx
// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import {
  ModalManager,
  useModals,
} from './new-modal';

const Harness = () => {
  const modal = useModals();
  return (
    <button
      type="button"
      onClick={() =>
        modal.openModal({
          id: 'language-dialog',
          title: 'Change Language',
          closeButtonAriaLabel: 'Close',
          children: (
            <>
              <button type="button">First language</button>
              <button type="button">Last language</button>
              <OpenStackedDialog />
            </>
          ),
        })
      }
    >
      Open language dialog
    </button>
  );
};

const OpenStackedDialog = () => {
  const modal = useModals();
  return (
    <button
      type="button"
      onClick={() =>
        modal.openModal({
          id: 'stacked-dialog',
          title: 'Second Dialog',
          closeButtonAriaLabel: 'Close second',
          children: (
            <>
              <button type="button">Second first</button>
              <button type="button">Second last</button>
            </>
          ),
        })
      }
    >
      Open second dialog
    </button>
  );
};

describe('new modal accessibility', () => {
  it('names and focuses a dialog, then restores trigger focus on close', async () => {
    render(
      <ModalManager>
        <Harness />
      </ModalManager>
    );
    const trigger = screen.getByRole('button', {
      name: 'Open language dialog',
    });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog', {
      name: 'Change Language',
    });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(dialog);

    const focusableButtons = within(dialog).getAllByRole('button');
    const firstFocusable = focusableButtons[0];
    const lastFocusable = focusableButtons[focusableButtons.length - 1];

    lastFocusable.focus();
    expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(firstFocusable);

    firstFocusable.focus();
    expect(
      fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    ).toBe(false);
    expect(document.activeElement).toBe(lastFocusable);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('contains focus only in the last-open dialog', async () => {
    render(
      <ModalManager>
        <Harness />
      </ModalManager>
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Open language dialog' })
    );
    const firstDialog = await screen.findByRole('dialog', {
      name: 'Change Language',
    });
    fireEvent.click(
      within(firstDialog).getByRole('button', {
        name: 'Open second dialog',
      })
    );
    await screen.findByRole('dialog', { name: 'Second Dialog' });

    const backgroundButtons = within(firstDialog).getAllByRole('button');
    backgroundButtons[backgroundButtons.length - 1].focus();
    expect(fireEvent.keyDown(firstDialog, { key: 'Tab' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the modal test to verify RED**

Run:

```bash
rtk pnpm exec vitest run apps/frontend/src/components/layout/new-modal.accessibility.spec.tsx --reporter=default
```

Expected: FAIL because no element has `role="dialog"`, the close button is unnamed, focus is not managed, and Tab is not contained.

- [ ] **Step 3: Add modal naming and focus without changing store behavior**

Add `useRef` to the React import in `apps/frontend/src/components/layout/new-modal.tsx`:

```ts
import React, {
  createContext,
  FC,
  memo,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
```

Add these fields to `OpenModalInterface` immediately after `title?: any;`:

```ts
  ariaLabel?: string;
  closeButtonAriaLabel?: string;
```

Immediately after `const decision = useDecisionModal();` in `Component`, add:

```ts
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);
  const isLastRef = useRef(isLast);
  const titleId = `modal-${modal.id}-title`;
  isLastRef.current = isLast;

  useEffect(() => {
    previouslyFocusedElement.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (isLastRef.current) {
      dialogRef.current?.focus();
    }

    return () => {
      if (isLastRef.current) {
        previouslyFocusedElement.current?.focus();
      }
    };
  }, []);
```

Immediately before the existing `useHotkeys` call in `Component`, add the last-open-dialog focus trap:

```ts
  const containKeyboardFocus = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!isLast || event.key !== 'Tab' || !dialogRef.current) {
        return;
      }

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.getAttribute('aria-hidden') !== 'true');

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (
        event.shiftKey &&
        (activeElement === firstFocusable || activeElement === dialogRef.current)
      ) {
        event.preventDefault();
        lastFocusable.focus();
        return;
      }

      if (!event.shiftKey && activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    },
    [isLast]
  );
```

On the inner modal panel at current lines 197-211—the `div` whose classes include `bg-newBgColorInner mx-auto flex flex-col w-fit rounded-[24px] relative`—add these props before `className`:

```tsx
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={modal.title ? titleId : undefined}
              aria-label={modal.title ? undefined : modal.ariaLabel || 'Dialog'}
              tabIndex={-1}
              onKeyDown={containKeyboardFocus}
```

Replace the modal title wrapper with:

```tsx
                <div
                  id={modal.title ? titleId : undefined}
                  className="text-[24px] font-[600] flex-1"
                >
                  {modal.title}
                </div>
```

Add the accessible name to the existing close button:

```tsx
                      aria-label={modal.closeButtonAriaLabel || 'Close dialog'}
```

Keep its existing `className`, `type`, and `onClick` props unchanged.

- [ ] **Step 4: Run the modal test to verify GREEN**

Run:

```bash
rtk pnpm exec vitest run apps/frontend/src/components/layout/new-modal.accessibility.spec.tsx --reporter=default
```

Expected: PASS with `2 passed`; forward and reverse Tab wrap only in the last-open dialog, while the background dialog does not prevent Tab. Existing Escape and outside-click behavior remains unchanged.

- [ ] **Step 5: Commit the additive modal behavior**

```bash
rtk git add apps/frontend/src/components/layout/new-modal.tsx apps/frontend/src/components/layout/new-modal.accessibility.spec.tsx
rtk git commit -m "fix: add accessible modal focus metadata"
```

---

### Task 4: Harden the Shared Language Selector

**Files:**
- Modify: `apps/frontend/src/components/layout/language.component.tsx:1-156`
- Create: `apps/frontend/src/components/layout/language.component.spec.tsx`

**Interfaces:**
- Consumes: `persistLanguageCookie(language)`, `getLanguageDirection(language)`, `languages`, Task 3's `closeButtonAriaLabel`, and the existing `useModals()` API.
- Produces: `LanguageComponent` as a 44-by-44 native trigger and `ChangeLanguageComponent` as a responsive grid of native option buttons; selecting a language persists it for 365 days, updates i18next, sets root `lang`/`dir`, and closes the dialog.

- [ ] **Step 1: Write the failing selector behavior test**

Create `apps/frontend/src/components/layout/language.component.spec.tsx`:

```tsx
// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import i18next from '@gitroom/react/translation/i18next';
import { ModalManager } from './new-modal';
import {
  ChangeLanguageComponent,
  LanguageComponent,
} from './language.component';

describe('language selector', () => {
  beforeEach(async () => {
    document.cookie = 'i18next=; Max-Age=0; Path=/';
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    await act(async () => {
      await i18next.changeLanguage('en');
    });
  });

  it('opens a viewport-safe named dialog from a native 44px trigger', async () => {
    render(
      <ModalManager>
        <LanguageComponent />
      </ModalManager>
    );
    const trigger = screen.getByRole('button', { name: 'Change Language' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.className).toContain('h-[44px]');
    expect(trigger.className).toContain('w-[44px]');

    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', {
      name: 'Change Language',
    });
    expect(dialog.style.width).toBe('min(600px, calc(100vw - 24px))');
    expect(screen.getByRole('button', { name: 'Close' })).not.toBeNull();
  });

  it('renders native responsive options with selected state', () => {
    const { container } = render(
      <ModalManager>
        <ChangeLanguageComponent />
      </ModalManager>
    );
    const english = container.querySelector<HTMLButtonElement>(
      'button[data-language="en"]'
    );
    const grid = container.querySelector('[data-language-grid]');

    expect(english).not.toBeNull();
    expect(english?.getAttribute('type')).toBe('button');
    expect(english?.getAttribute('aria-pressed')).toBe('true');
    expect(grid?.className).toContain('grid-cols-2');
    expect(grid?.className).toContain('sm:grid-cols-4');
  });

  it('persists Arabic and updates i18next, lang, and RTL direction', async () => {
    const { container } = render(
      <ModalManager>
        <ChangeLanguageComponent />
      </ModalManager>
    );
    const arabic = container.querySelector<HTMLButtonElement>(
      'button[data-language="ar"]'
    );
    expect(arabic).not.toBeNull();
    fireEvent.click(arabic!);

    await waitFor(() => expect(i18next.resolvedLanguage).toBe('ar'));
    expect(document.cookie).toContain('i18next=ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });
});
```

- [ ] **Step 2: Run the selector test to verify RED**

Run:

```bash
rtk pnpm exec vitest run apps/frontend/src/components/layout/language.component.spec.tsx --reporter=default
```

Expected: FAIL because the trigger and options are click-only `div` elements, the modal is not viewport-sized, the cookie is not explicitly durable, and root `lang` is not updated.

- [ ] **Step 3: Replace the selector imports and language-change handler**

In `apps/frontend/src/components/layout/language.component.tsx`, remove imports for `useCookie`, `List`, `Box`, `Group`, `ModalWrapperComponent`, and the unused `t` inside `ChangeLanguageComponent`.

Use this import block:

```ts
'use client';

import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  fallbackLng,
  getLanguageDirection,
  languages,
} from '@gitroom/react/translation/i18n.config';
import { persistLanguageCookie } from '@gitroom/react/translation/language.cookie';
import i18next from 'i18next';
import ReactCountryFlag from 'react-country-flag';
import { Text } from '@mantine/core';
import React, { useCallback } from 'react';
import countries from 'i18n-iso-countries';
import countriesEn from 'i18n-iso-countries/langs/en.json';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import clsx from 'clsx';
```

Inside `ChangeLanguageComponent`, remove the `useCookie` and unused translation declarations, then replace `handleLanguageChange` with:

```ts
  const handleLanguageChange = async (language: string) => {
    persistLanguageCookie(language);
    await i18next.changeLanguage(language);
    document.documentElement.lang = language;
    document.documentElement.dir = getLanguageDirection(language);
    modals.closeCurrent();
  };
```

- [ ] **Step 4: Replace option cards with responsive native buttons**

Replace the return value of `ChangeLanguageComponent` with:

```tsx
  return (
    <div className="relative">
      <div
        data-language-grid
        className="grid grid-cols-2 sm:grid-cols-4 gap-2"
      >
        {availableLanguages.map((language) => {
          const languageName = getLanguageName(language) || language;
          return (
            <button
              type="button"
              data-language={language}
              aria-label={languageName}
              aria-pressed={language === currentLanguage}
              className={clsx(
                'min-h-[88px] flex items-center justify-center flex-col rounded-[8px] bg-newTableHeader hover:bg-newTableBorder p-[12px] cursor-pointer gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-textColor',
                language === currentLanguage
                  ? 'border border-textColor'
                  : 'border border-transparent'
              )}
              key={language}
              onClick={() => void handleLanguageChange(language)}
            >
              <span aria-hidden="true">
                <ReactCountryFlag
                  countryCode={getCountryCodeForFlag(language)}
                  svg
                  style={{ width: '1.5em', height: '1.5em' }}
                />
              </span>
              <Text weight={language === currentLanguage ? 'bold' : 'normal'}>
                {languageName}
              </Text>
            </button>
          );
        })}
      </div>
    </div>
  );
```

- [ ] **Step 5: Replace the trigger with an accessible viewport-safe button**

Replace `LanguageComponent` with:

```tsx
export const LanguageComponent = () => {
  const modal = useModals();
  const currentLanguage = i18next.resolvedLanguage || fallbackLng;
  const t = useT();
  const openModal = () => {
    modal.openModal({
      title: t('change_language', 'Change Language'),
      closeButtonAriaLabel: t('close', 'Close'),
      withCloseButton: true,
      size: 'min(600px, calc(100vw - 24px))',
      children: <ChangeLanguageComponent />,
    });
  };
  return (
    <button
      type="button"
      onClick={openModal}
      aria-label={t('change_language', 'Change Language')}
      aria-haspopup="dialog"
      className="rounded-full overflow-hidden h-[44px] w-[44px] relative cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-textColor"
    >
      <span aria-hidden="true">
        <ReactCountryFlag
          countryCode={getCountryCodeForFlag(currentLanguage)}
          svg
          style={{
            width: '22px',
            height: '22px',
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            objectFit: 'cover',
          }}
        />
      </span>
    </button>
  );
};
```

- [ ] **Step 6: Run selector and modal tests to verify GREEN**

Run:

```bash
rtk pnpm exec vitest run apps/frontend/src/components/layout/language.component.spec.tsx apps/frontend/src/components/layout/new-modal.accessibility.spec.tsx --reporter=default
```

Expected: PASS with `5 passed`; no React accessibility or unhandled promise warnings appear.

- [ ] **Step 7: Commit the selector hardening**

```bash
rtk git add apps/frontend/src/components/layout/language.component.tsx apps/frontend/src/components/layout/language.component.spec.tsx
rtk git commit -m "fix: harden shared language selector"
```

---

### Task 5: Mount Pre-Auth Selection and Translate Auth Social Proof

**Files:**
- Create: `apps/frontend/src/components/auth/auth.social-proof.tsx`
- Create: `apps/frontend/src/components/auth/auth.social-proof.spec.tsx`
- Modify: `apps/frontend/src/app/(app)/auth/layout.tsx:1-37`
- Create: `apps/frontend/src/app/(app)/auth/layout.language.spec.ts`

**Interfaces:**
- Consumes: `LanguageComponent`, `MantineWrapper`, `useT()`, and existing keys `billing_join_over`, `billing_entrepreneurs_count`, `billing_who_use`, and `billing_postiz_grow_social`.
- Produces: `AuthSocialProof(): JSX.Element` and one common auth layout header/modal boundary covering registration, login, password recovery, activation, and other descendants of `app/(app)/auth/layout.tsx`.

- [ ] **Step 1: Write failing auth composition and social-proof tests**

Create `apps/frontend/src/components/auth/auth.social-proof.spec.tsx`:

```tsx
// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import i18next from '@gitroom/react/translation/i18next';
import { AuthSocialProof } from './auth.social-proof';

describe('AuthSocialProof', () => {
  beforeEach(async () => {
    await act(async () => {
      await i18next.changeLanguage('en');
    });
  });

  it('reacts to language changes using existing social-proof keys', async () => {
    render(<AuthSocialProof />);
    expect(
      screen
        .getByTestId('auth-social-proof')
        .textContent?.replace(/\s+/g, ' ')
        .trim()
    ).toBe(
      'Join Over 20,000+ Entrepreneurs who use Postiz To Grow Their Social Presence'
    );

    await act(async () => {
      await i18next.changeLanguage('ru');
    });
    expect(
      screen
        .getByTestId('auth-social-proof')
        .textContent?.replace(/\s+/g, ' ')
        .trim()
    ).toBe(
      'Присоединяйтесь к 20 000+ предпринимателей которые используют Postiz для роста своей социальной активности'
    );
  });
});
```

Create `apps/frontend/src/app/(app)/auth/layout.language.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8');

describe('auth language layout', () => {
  it('mounts one modal boundary and language trigger in the shared logo row', () => {
    expect(source).toContain("import { MantineWrapper }");
    expect(source).toContain("import { LanguageComponent }");
    expect(source).toContain('<MantineWrapper>');
    expect(source).toMatch(
      /className="flex items-center justify-between"[\s\S]*<LogoTextComponent \/>[\s\S]*<LanguageComponent \/>/
    );
  });

  it('uses the translated client social proof and removes server-global auth translation', () => {
    expect(source).toContain('<AuthSocialProof />');
    expect(source).not.toContain('getT');
    expect(source).not.toContain('Entrepreneurs use');
  });
});
```

- [ ] **Step 2: Run auth tests to verify RED**

Run:

```bash
rtk pnpm exec vitest run apps/frontend/src/components/auth/auth.social-proof.spec.tsx 'apps/frontend/src/app/(app)/auth/layout.language.spec.ts' --reporter=default
```

Expected: FAIL because `AuthSocialProof` does not exist and the auth layout has no modal boundary or language trigger.

- [ ] **Step 3: Create the translated client social proof**

Create `apps/frontend/src/components/auth/auth.social-proof.tsx`:

```tsx
'use client';

import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const AuthSocialProof = () => {
  const t = useT();
  return (
    <div data-testid="auth-social-proof" className="text-center">
      {t('billing_join_over', 'Join Over')}{' '}
      <span className="text-[42px] text-[#FC69FF]">
        {t('billing_entrepreneurs_count', '20,000+ Entrepreneurs')}
      </span>{' '}
      {t('billing_who_use', 'who use')}
      <br />
      {t(
        'billing_postiz_grow_social',
        'Postiz To Grow Their Social Presence'
      )}
    </div>
  );
};
```

- [ ] **Step 4: Mount the selector and modal renderer once in the auth layout**

Replace `apps/frontend/src/app/(app)/auth/layout.tsx` with:

```tsx
export const dynamic = 'force-dynamic';
import { ReactNode } from 'react';
import loadDynamic from 'next/dynamic';
import { TestimonialComponent } from '@gitroom/frontend/components/auth/testimonial.component';
import { LogoTextComponent } from '@gitroom/frontend/components/ui/logo-text.component';
import { LanguageComponent } from '@gitroom/frontend/components/layout/language.component';
import { MantineWrapper } from '@gitroom/react/helpers/mantine.wrapper';
import { AuthSocialProof } from '@gitroom/frontend/components/auth/auth.social-proof';

const ReturnUrlComponent = loadDynamic(() => import('./return.url.component'));

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <MantineWrapper>
      <div className="bg-[#0E0E0E] flex flex-1 p-[12px] gap-[12px] min-h-screen w-screen text-white">
        <ReturnUrlComponent />
        <div className="flex flex-col py-[40px] px-[20px] flex-1 lg:w-[600px] lg:flex-none rounded-[12px] text-white p-[12px] bg-[#1A1919]">
          <div className="w-full max-w-[440px] mx-auto justify-center gap-[20px] h-full flex flex-col text-white">
            <div className="flex items-center justify-between">
              <LogoTextComponent />
              <LanguageComponent />
            </div>
            <div className="flex">{children}</div>
          </div>
        </div>
        <div className="text-[36px] flex-1 pt-[88px] hidden lg:flex flex-col items-center">
          <AuthSocialProof />
          <TestimonialComponent />
        </div>
      </div>
    </MantineWrapper>
  );
}
```

- [ ] **Step 5: Run auth tests to verify GREEN**

Run:

```bash
rtk pnpm exec vitest run apps/frontend/src/components/auth/auth.social-proof.spec.tsx 'apps/frontend/src/app/(app)/auth/layout.language.spec.ts' --reporter=default
```

Expected: PASS with `3 passed`, proving immediate client translation and one shared pre-auth selector/modal boundary.

- [ ] **Step 6: Run all focused pre-auth language tests together**

Run:

```bash
rtk pnpm exec vitest run libraries/react-shared-libraries/src/translation/language.contract.spec.ts libraries/react-shared-libraries/src/translation/get.request.language.spec.ts libraries/react-shared-libraries/src/translation/get.translation.service.backend.spec.ts apps/frontend/src/proxy.localization.spec.ts 'apps/frontend/src/app/(app)/layout.locale.spec.ts' apps/frontend/src/components/layout/new-modal.accessibility.spec.tsx apps/frontend/src/components/layout/language.component.spec.tsx apps/frontend/src/components/auth/auth.social-proof.spec.tsx 'apps/frontend/src/app/(app)/auth/layout.language.spec.ts' --reporter=default
```

Expected: PASS with `20 passed` and no unhandled errors, act warnings, or accessibility-query failures.

- [ ] **Step 7: Commit the pre-auth UI**

```bash
rtk git add apps/frontend/src/components/auth/auth.social-proof.tsx apps/frontend/src/components/auth/auth.social-proof.spec.tsx 'apps/frontend/src/app/(app)/auth/layout.tsx' 'apps/frontend/src/app/(app)/auth/layout.language.spec.ts'
rtk git commit -m "feat: expose language selection before auth"
```

---

### Task 6: Regression and Browser Verification

**Files:**
- Verify only; no production or test files are added in this task.

**Interfaces:**
- Consumes: all Task 1-5 behavior.
- Produces: fresh automated and browser evidence that the implementation satisfies the approved pre-auth localization scope without PostHog, catalogue, backend-integration, deployment, or channel-picker changes.

- [ ] **Step 1: Run the complete test suite**

Run:

```bash
rtk pnpm exec vitest run --reporter=default
```

Expected: all repository Vitest files pass; there are zero failed tests and zero unhandled errors.

- [ ] **Step 2: Build the frontend**

Run:

```bash
rtk pnpm run build:frontend
```

Expected: Next.js production build exits `0` with no TypeScript, server/client-boundary, route, or Tailwind errors.

- [ ] **Step 3: Start the frontend for manual auth-route verification**

Run:

```bash
rtk pnpm run dev:frontend
```

Expected: the frontend reports its local URL and remains running without a compilation error. Keep this terminal open for the next two steps.

- [ ] **Step 4: Verify keyboard, persistence, and responsive behavior at 375 pixels**

In a browser with no `auth` or `i18next` cookie:

1. Open `/auth` at a `375 × 667` viewport.
2. Confirm the language trigger is visible beside the logo and the page has `html[lang]` and `html[dir]` before interaction.
3. Tab to the trigger; confirm a visible focus indicator and press Enter.
4. Confirm the dialog stays within the viewport, is announced as “Change Language,” initially owns focus, and shows two columns.
5. Select Russian by keyboard; confirm the registration form uses Russian, the dialog closes, and the trigger regains focus.
6. Reload `/auth`, `/auth/login`, `/auth/forgot`, and `/auth/activate`; confirm Russian persists and the same trigger is available on every route.
7. Select Hebrew, reload, and confirm `html[lang="he"][dir="rtl"]`; select English before continuing.

Expected: every numbered observation succeeds without horizontal scrolling, clipped options, inaccessible controls, or a Russian/English first-render flash after reload.

- [ ] **Step 5: Verify desktop social proof and request detection**

At a viewport at least `1280` pixels wide:

1. Remove the `i18next` cookie and request `/auth` with browser preferred language Russian.
2. Confirm the first response sets a 365-day `i18next=ru` cookie and renders `html[lang="ru"][dir="ltr"]`.
3. Confirm the desktop social-proof headline is Russian while authored testimonial quotations remain unchanged.
4. Set an invalid `i18next=invalid` cookie and reload; confirm English/LTR replaces it.
5. Choose Arabic in the UI, reload, and confirm Arabic/RTL persists.

Expected: detected, invalid, and manually selected locale behavior matches the cookie-priority contract exactly.

- [ ] **Step 6: Prove scope and diff hygiene**

Run:

```bash
rtk git status --short
rtk git diff --check
rtk git diff --name-only HEAD~5..HEAD
```

Expected: `git diff --check` exits `0`; changed files are limited to the translation helpers/tests, frontend proxy/root layout/tests, shared modal/selector/tests, auth social-proof/tests, auth layout/test, and this plan. No translation JSON, PostHog, backend integration, deployment, onboarding, or channel-picker file appears.
