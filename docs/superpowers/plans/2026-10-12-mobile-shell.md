# Mobile shell `/m` (mobile stage 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the mobile route group `/m` behind a flag: phone detection with a desktop opt-out cookie, a three-tab shell, the "Каналы" screen (connected channels, add channel, link the Telegram assistant), a "no channels yet" first-run state on the "Пост" tab, and a "Мобильная версия" link on desktop.

**Architecture:** Detection is a pure helper called from the existing Next proxy (`apps/frontend/src/proxy.ts`), which already gates auth and runs for every navigation, so a phone that logs in or returns from OAuth lands on `/m` without touching the login code. The shell is a client layout component under `apps/frontend/src/components/mobile/` that reuses the app's providers (user context, modal manager, toaster, OAuth continue) and the existing add-channel modal. Pages are thin server components under `apps/frontend/src/app/(app)/(mobile)/m/`.

**Tech Stack:** Next 16 app router (proxy.ts middleware, server layouts), React 18 client components, SWR via `useFetch`, Tailwind 3 with the `new*` color tokens, vitest + @testing-library/react (jsdom), pnpm.

**Spec:** `docs/superpowers/specs/2026-10-12-mobile-version-design.md`, sections 3 (маршрут, детект, изоляция) and 4 (экраны: навигация, «Каналы», первый вход), stage table row 2 in section 7.

## Global Constraints

- Only pnpm. Tests from the root: `pnpm vitest run <path>`. Client component specs start with `// @vitest-environment jsdom` and `beforeEach(cleanup)`.
- Frontend rules from CLAUDE.md: SWR only through `useFetch`, each SWR call in its own hook, no eslint-disable on hooks. Native components only. Tailwind 3; use `new*` tokens (`bg-newBgColorInner`, `bg-newBgLineColor`, `text-newTextColor`, `text-textItemBlur`, `bg-btnPrimary`, `bg-btnSimple`, `text-btnText`, `border-newBorder`), never `--color-custom*`.
- Shared upstream files touched only at two points: `apps/frontend/src/proxy.ts` (one helper call) and `apps/frontend/src/components/new-layout/layout.component.tsx` (one link component). Everything else is new files under `components/mobile/` and `app/(app)/(mobile)/`.
- Flag: `MOBILE_ROUTE_ENABLED` (string `'true'` enables). Default off in compose. `/m` stays reachable by direct URL when off.
- Desktop opt-out cookie: name `vz-desktop`, value `1`, path `/`, one year.
- Copy is Russian for user-facing strings, via `useT(key, default)` with new keys prefixed `mobile_`.
- No backend changes in this stage. No schema changes.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **Tablets must not be redirected**: an iPad or Android tablet user agent stays on desktop (Task 1 test "does not treat tablets as phones").
2. **OAuth callback query must survive the redirect**: `/launches?added=telegram&continue=123` on a phone becomes `/m?added=telegram&continue=123`, so the two-step Telegram connect still completes (Task 1 proxy test "keeps the query string").
3. **Direct `/m` with the opt-out cookie set must still render `/m`**: the cookie only suppresses the automatic redirect; it never blocks the route (Task 1 test "never redirects away from /m").
4. **Unauthenticated phone hitting `/launches` must go to `/auth`, not `/m`**: auth gating runs first (Task 1 proxy test "auth redirect wins over mobile redirect").
5. **A channel that needs reconnection must be visibly flagged on the Каналы screen**, otherwise the user posts into a dead channel and only learns from the bot's error (Task 3 test "flags channels that need reconnection").

---

### Task 1: Phone detection helper and proxy redirect

**Files:**
- Create: `apps/frontend/src/components/mobile/mobile.detect.ts`
- Create: `apps/frontend/src/components/mobile/mobile.detect.spec.ts`
- Create: `apps/frontend/src/proxy.mobile.spec.ts`
- Modify: `apps/frontend/src/proxy.ts` (add one import and one block right before the final `return topResponse;` inside the `try`)

**Interfaces:**
- Produces:

```ts
export const DESKTOP_COOKIE = 'vz-desktop';
export const isPhoneUserAgent: (userAgent: string | null | undefined) => boolean;
export const resolveMobileRedirect: (input: {
  pathname: string;
  search: string;            // including leading '?' or ''
  userAgent: string | null | undefined;
  desktopCookie: string | undefined;
  enabled: boolean;
}) => string | null;         // e.g. '/m?added=telegram' or null
```

- [ ] **Step 1: Write the failing helper tests**

Create `apps/frontend/src/components/mobile/mobile.detect.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isPhoneUserAgent, resolveMobileRedirect } from './mobile.detect';

const iphone =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const android =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';
const ipad =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const androidTablet =
  'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const desktop =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const base = {
  pathname: '/launches',
  search: '',
  userAgent: iphone,
  desktopCookie: undefined,
  enabled: true,
};

describe('isPhoneUserAgent', () => {
  it('recognises iPhone and Android phones', () => {
    expect(isPhoneUserAgent(iphone)).toBe(true);
    expect(isPhoneUserAgent(android)).toBe(true);
  });

  it('does not treat tablets or desktops as phones', () => {
    expect(isPhoneUserAgent(ipad)).toBe(false);
    expect(isPhoneUserAgent(androidTablet)).toBe(false);
    expect(isPhoneUserAgent(desktop)).toBe(false);
    expect(isPhoneUserAgent(null)).toBe(false);
  });
});

describe('resolveMobileRedirect', () => {
  it('sends a phone on /launches to /m', () => {
    expect(resolveMobileRedirect(base)).toBe('/m');
  });

  it('keeps the query string', () => {
    expect(
      resolveMobileRedirect({ ...base, search: '?added=telegram&continue=1' })
    ).toBe('/m?added=telegram&continue=1');
  });

  it('does nothing when the flag is off', () => {
    expect(resolveMobileRedirect({ ...base, enabled: false })).toBeNull();
  });

  it('respects the desktop opt-out cookie', () => {
    expect(resolveMobileRedirect({ ...base, desktopCookie: '1' })).toBeNull();
  });

  it('never redirects away from /m or other pages', () => {
    expect(resolveMobileRedirect({ ...base, pathname: '/m' })).toBeNull();
    expect(resolveMobileRedirect({ ...base, pathname: '/m/channels' })).toBeNull();
    expect(resolveMobileRedirect({ ...base, pathname: '/settings' })).toBeNull();
    expect(resolveMobileRedirect({ ...base, pathname: '/auth/login' })).toBeNull();
  });

  it('leaves desktops and tablets alone', () => {
    expect(resolveMobileRedirect({ ...base, userAgent: desktop })).toBeNull();
    expect(resolveMobileRedirect({ ...base, userAgent: ipad })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run apps/frontend/src/components/mobile/mobile.detect.spec.ts`
Expected: FAIL, cannot find module `./mobile.detect`.

- [ ] **Step 3: Implement the helper**

Create `apps/frontend/src/components/mobile/mobile.detect.ts`:

```ts
export const DESKTOP_COOKIE = 'vz-desktop';

/** Phones only: tablets keep the desktop layout. */
export const isPhoneUserAgent = (userAgent: string | null | undefined) => {
  if (!userAgent) {
    return false;
  }
  if (/iPad/i.test(userAgent)) {
    return false;
  }
  if (/iPhone|iPod/i.test(userAgent)) {
    return true;
  }
  // Android phones carry "Mobile"; Android tablets do not.
  return /Android/i.test(userAgent) && /Mobile/i.test(userAgent);
};

/** Paths whose mobile counterpart is the /m root. */
const MOBILE_ROOTS = new Set(['/launches']);

export const resolveMobileRedirect = ({
  pathname,
  search,
  userAgent,
  desktopCookie,
  enabled,
}: {
  pathname: string;
  search: string;
  userAgent: string | null | undefined;
  desktopCookie: string | undefined;
  enabled: boolean;
}): string | null => {
  if (!enabled || desktopCookie === '1' || !MOBILE_ROOTS.has(pathname)) {
    return null;
  }
  if (!isPhoneUserAgent(userAgent)) {
    return null;
  }
  return `/m${search || ''}`;
};
```

- [ ] **Step 4: Run the helper tests**

Run: `pnpm vitest run apps/frontend/src/components/mobile/mobile.detect.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the failing proxy tests**

Create `apps/frontend/src/proxy.mobile.spec.ts`:

```ts
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { proxy } from './proxy';

const iphone =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const request = (
  path: string,
  { auth = true, cookie = '' }: { auth?: boolean; cookie?: string } = {}
) =>
  new NextRequest(`https://app.vezdepost.ru${path}`, {
    headers: {
      'user-agent': iphone,
      cookie: [auth ? 'auth=token' : '', cookie].filter(Boolean).join('; '),
    },
  });

describe('proxy mobile redirect', () => {
  const env = process.env.MOBILE_ROUTE_ENABLED;
  beforeEach(() => {
    process.env.MOBILE_ROUTE_ENABLED = 'true';
  });
  afterEach(() => {
    process.env.MOBILE_ROUTE_ENABLED = env;
  });

  it('sends a logged-in phone from /launches to /m and keeps the query string', async () => {
    const response = await proxy(request('/launches?added=telegram&continue=1'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://app.vezdepost.ru/m?added=telegram&continue=1'
    );
  });

  it('auth redirect wins over mobile redirect', async () => {
    const response = await proxy(request('/launches', { auth: false }));
    expect(response.headers.get('location')).toBe('https://app.vezdepost.ru/auth');
  });

  it('respects the desktop opt-out cookie', async () => {
    const response = await proxy(request('/launches', { cookie: 'vz-desktop=1' }));
    expect(response.headers.get('location')).toBeNull();
  });

  it('does nothing when the flag is off', async () => {
    process.env.MOBILE_ROUTE_ENABLED = 'false';
    const response = await proxy(request('/launches'));
    expect(response.headers.get('location')).toBeNull();
  });
});
```

- [ ] **Step 6: Run the proxy tests to verify they fail**

Run: `pnpm vitest run apps/frontend/src/proxy.mobile.spec.ts`
Expected: FAIL on the first test (location is null) and the opt-out/flag-off tests pass trivially. The auth test passes already.

- [ ] **Step 7: Wire the helper into the proxy**

In `apps/frontend/src/proxy.ts` add the import after the i18n import block:

```ts
import {
  DESKTOP_COOKIE,
  resolveMobileRedirect,
} from '@gitroom/frontend/components/mobile/mobile.detect';
```

Inside the `try { ... }` block, replace the final `return topResponse;` (the one right after the `if (nextUrl.pathname === '/')` redirect) with:

```ts
    const mobileTarget = resolveMobileRedirect({
      pathname: nextUrl.pathname,
      search: nextUrl.search,
      userAgent: request.headers.get('user-agent'),
      desktopCookie: request.cookies.get(DESKTOP_COOKIE)?.value,
      enabled: process.env.MOBILE_ROUTE_ENABLED === 'true',
    });
    if (mobileTarget) {
      return NextResponse.redirect(new URL(mobileTarget, nextUrl.href));
    }

    return topResponse;
```

Do not touch any other line of the file.

- [ ] **Step 8: Run both proxy specs**

Run: `pnpm vitest run apps/frontend/src/proxy.mobile.spec.ts apps/frontend/src/proxy.localization.spec.ts`
Expected: PASS, 7 tests.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/components/mobile/mobile.detect.ts apps/frontend/src/components/mobile/mobile.detect.spec.ts apps/frontend/src/proxy.mobile.spec.ts apps/frontend/src/proxy.ts
git commit -m "feat(mobile): phone detection redirect to /m behind MOBILE_ROUTE_ENABLED

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `/m` route group and shell

**Files:**
- Create: `apps/frontend/src/app/(app)/(mobile)/m/layout.tsx`
- Create: `apps/frontend/src/app/(app)/(mobile)/m/page.tsx`
- Create: `apps/frontend/src/app/(app)/(mobile)/m/queue/page.tsx`
- Create: `apps/frontend/src/app/(app)/(mobile)/m/channels/page.tsx`
- Create: `apps/frontend/src/components/mobile/mobile.layout.component.tsx`
- Create: `apps/frontend/src/components/mobile/mobile.tab.bar.tsx`
- Create: `apps/frontend/src/components/mobile/mobile.tab.bar.spec.tsx`
- Create: `apps/frontend/src/components/mobile/desktop.version.link.tsx`
- Create: `apps/frontend/src/components/mobile/desktop.version.link.spec.tsx`
- Create: `apps/frontend/src/components/mobile/use.mobile.user.tsx`

**Interfaces:**
- Consumes: `DESKTOP_COOKIE` from Task 1; `setCookie` from `@gitroom/frontend/components/layout/layout.context`; `ContextWrapper` from `layout/user.context`; `MantineWrapper` from `@gitroom/react/helpers/mantine.wrapper`; `Toaster` from `@gitroom/react/toaster/toaster`; `ContinueProvider` from `layout/continue.provider`; `Logo` from `new-layout/logo`.
- Produces:

```tsx
export const MobileLayoutComponent: FC<{ children: ReactNode }>;   // full shell with providers
export const MobileTabBar: FC;                                      // 3 links, active by pathname
export const DesktopVersionLink: FC<{ className?: string }>;        // sets vz-desktop=1 and goes to /launches
export const useMobileUser: () => SWRResponse<any>;                 // '/user/self'
```

Tab definitions (label key, default, href): `mobile_tab_post` «Пост» `/m`; `mobile_tab_queue` «Очередь» `/m/queue`; `mobile_tab_channels` «Каналы» `/m/channels`. Active rule: `/m` is active only for exact `/m`; others active when pathname starts with their href.

- [ ] **Step 1: Write the failing tab bar test**

Create `apps/frontend/src/components/mobile/mobile.tab.bar.spec.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pathname = vi.hoisted(() => ({ value: '/m' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.value }));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

import { MobileTabBar } from './mobile.tab.bar';

beforeEach(cleanup);

describe('MobileTabBar', () => {
  it('renders the three tabs with their links', () => {
    render(<MobileTabBar />);
    expect(screen.getByRole('link', { name: 'Пост' })).toHaveAttribute('href', '/m');
    expect(screen.getByRole('link', { name: 'Очередь' })).toHaveAttribute('href', '/m/queue');
    expect(screen.getByRole('link', { name: 'Каналы' })).toHaveAttribute('href', '/m/channels');
  });

  it('marks only the current tab as active', () => {
    pathname.value = '/m/channels';
    render(<MobileTabBar />);
    expect(screen.getByRole('link', { name: 'Каналы' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Пост' })).not.toHaveAttribute('aria-current');
  });
});
```

Note: `toHaveAttribute` needs `@testing-library/jest-dom`. Check `grep -rn "jest-dom" apps/frontend/src --include='*.spec.tsx' | head -1`; if no spec imports it, replace the assertions with `expect(link.getAttribute('href')).toBe('/m')` and `expect(link.getAttribute('aria-current')).toBe('page')` / `toBeNull()`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/frontend/src/components/mobile/mobile.tab.bar.spec.tsx`
Expected: FAIL, cannot find module `./mobile.tab.bar`.

- [ ] **Step 3: Implement the tab bar**

Create `apps/frontend/src/components/mobile/mobile.tab.bar.tsx`:

```tsx
'use client';

import { FC } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const tabs = [
  { key: 'mobile_tab_post', fallback: 'Пост', href: '/m', exact: true },
  { key: 'mobile_tab_queue', fallback: 'Очередь', href: '/m/queue', exact: false },
  { key: 'mobile_tab_channels', fallback: 'Каналы', href: '/m/channels', exact: false },
];

/** Bottom navigation for the mobile shell. */
export const MobileTabBar: FC = () => {
  const pathname = usePathname();
  const t = useT();
  return (
    <nav
      aria-label="mobile"
      className="fixed bottom-0 inset-x-0 flex border-t border-newBorder bg-newBgColorInner pb-[env(safe-area-inset-bottom)]"
    >
      {tabs.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={clsx(
              'flex-1 flex items-center justify-center h-[56px] text-[14px] font-[600]',
              active ? 'text-newTextColor' : 'text-textItemBlur'
            )}
          >
            {t(tab.key, tab.fallback)}
          </Link>
        );
      })}
    </nav>
  );
};
```

- [ ] **Step 4: Run the tab bar test**

Run: `pnpm vitest run apps/frontend/src/components/mobile/mobile.tab.bar.spec.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write the failing desktop link test**

Create `apps/frontend/src/components/mobile/desktop.version.link.spec.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

import { DesktopVersionLink } from './desktop.version.link';

beforeEach(() => {
  cleanup();
  document.cookie = 'vz-desktop=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
});

describe('DesktopVersionLink', () => {
  it('points at the desktop calendar and sets the opt-out cookie on click', () => {
    render(<DesktopVersionLink />);
    const link = screen.getByRole('link', { name: 'Полная версия' });
    expect(link.getAttribute('href')).toBe('/launches');
    fireEvent.click(link);
    expect(document.cookie).toContain('vz-desktop=1');
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run apps/frontend/src/components/mobile/desktop.version.link.spec.tsx`
Expected: FAIL, cannot find module `./desktop.version.link`.

- [ ] **Step 7: Implement the link and the user hook**

Create `apps/frontend/src/components/mobile/desktop.version.link.tsx`:

```tsx
'use client';

import { FC } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { setCookie } from '@gitroom/frontend/components/layout/layout.context';
import { DESKTOP_COOKIE } from '@gitroom/frontend/components/mobile/mobile.detect';

/** Full-page link (not next/link) so the proxy sees the fresh cookie. */
export const DesktopVersionLink: FC<{ className?: string }> = ({ className }) => {
  const t = useT();
  return (
    <a
      href="/launches"
      onClick={() => setCookie(DESKTOP_COOKIE, '1', 365)}
      className={clsx('text-[13px] underline text-textItemBlur', className)}
    >
      {t('mobile_full_version', 'Полная версия')}
    </a>
  );
};
```

Create `apps/frontend/src/components/mobile/use.mobile.user.tsx`:

```tsx
'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export const useMobileUser = () => {
  const fetch = useFetch();
  const load = useCallback(
    async (path: string) => (await fetch(path)).json(),
    [fetch]
  );
  return useSWR('/user/self', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenOffline: false,
    refreshWhenHidden: false,
  });
};
```

- [ ] **Step 8: Run the link test**

Run: `pnpm vitest run apps/frontend/src/components/mobile/desktop.version.link.spec.tsx`
Expected: PASS, 1 test.

- [ ] **Step 9: Create the shell and the route files**

Create `apps/frontend/src/components/mobile/mobile.layout.component.tsx`:

```tsx
'use client';

import { FC, ReactNode } from 'react';
import { ContextWrapper } from '@gitroom/frontend/components/layout/user.context';
import { MantineWrapper } from '@gitroom/react/helpers/mantine.wrapper';
import { Toaster } from '@gitroom/react/toaster/toaster';
import { ContinueProvider } from '@gitroom/frontend/components/layout/continue.provider';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';
import { MobileTabBar } from '@gitroom/frontend/components/mobile/mobile.tab.bar';
import { DesktopVersionLink } from '@gitroom/frontend/components/mobile/desktop.version.link';
import { useMobileUser } from '@gitroom/frontend/components/mobile/use.mobile.user';

/** Phone shell: top bar, scrolling content, bottom tabs. Desktop stays untouched. */
export const MobileLayoutComponent: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { data: user } = useMobileUser();
  if (!user) {
    return null;
  }
  return (
    <ContextWrapper user={user}>
      <MantineWrapper>
        <Toaster />
        <ContinueProvider />
        <div className="min-h-screen bg-newBgColor text-newTextColor flex flex-col pt-[env(safe-area-inset-top)]">
          <header className="flex items-center justify-between px-[16px] h-[56px]">
            <div className="scale-50 origin-left -ms-[10px]">
              <Logo />
            </div>
            <DesktopVersionLink />
          </header>
          <main className="flex-1 px-[16px] pb-[80px]">{children}</main>
          <MobileTabBar />
        </div>
      </MantineWrapper>
    </ContextWrapper>
  );
};
```

Create `apps/frontend/src/app/(app)/(mobile)/m/layout.tsx`:

```tsx
export const dynamic = 'force-dynamic';
import { ReactNode } from 'react';
import { Viewport } from 'next';
import { MobileLayoutComponent } from '@gitroom/frontend/components/mobile/mobile.layout.component';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function MobileLayout({ children }: { children: ReactNode }) {
  return <MobileLayoutComponent>{children}</MobileLayoutComponent>;
}
```

Create `apps/frontend/src/app/(app)/(mobile)/m/page.tsx`:

```tsx
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { MobilePostScreen } from '@gitroom/frontend/components/mobile/mobile.post.screen';

export const metadata: Metadata = { title: 'Vezdepost', description: '' };

export default function MobilePostPage() {
  return <MobilePostScreen />;
}
```

Create `apps/frontend/src/app/(app)/(mobile)/m/queue/page.tsx`:

```tsx
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { MobileQueueScreen } from '@gitroom/frontend/components/mobile/mobile.queue.screen';

export const metadata: Metadata = { title: 'Vezdepost — очередь', description: '' };

export default function MobileQueuePage() {
  return <MobileQueueScreen />;
}
```

Create `apps/frontend/src/app/(app)/(mobile)/m/channels/page.tsx`:

```tsx
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { MobileChannelsScreen } from '@gitroom/frontend/components/mobile/mobile.channels.screen';

export const metadata: Metadata = { title: 'Vezdepost — каналы', description: '' };

export default function MobileChannelsPage() {
  return <MobileChannelsScreen />;
}
```

The three screen components are created in Tasks 3 and 4. To keep this task buildable on its own, create temporary stubs now that Tasks 3 and 4 replace:

`apps/frontend/src/components/mobile/mobile.queue.screen.tsx`:

```tsx
'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

/** Stage 3 fills this with the upcoming posts list. */
export const MobileQueueScreen: FC = () => {
  const t = useT();
  return (
    <p className="pt-[24px] text-textItemBlur text-[15px]">
      {t('mobile_queue_soon', 'Очередь постов появится в следующем обновлении.')}
    </p>
  );
};
```

`apps/frontend/src/components/mobile/mobile.post.screen.tsx` and `mobile.channels.screen.tsx`: same shape with keys `mobile_post_soon` / `mobile_channels_soon` and texts «Быстрый пост появится в следующем обновлении.» / «Каналы». They are replaced in Tasks 3 and 4.

- [ ] **Step 10: Build the frontend to prove the route group compiles**

Run: `pnpm run build:frontend > /tmp/claude-build-frontend.log 2>&1; echo $?; grep -nE "error|Error" /tmp/claude-build-frontend.log | head`
Expected: exit 0, `/m`, `/m/queue`, `/m/channels` listed in the route table. If the build needs env vars that are missing locally and fails on them (not on our code), note it in the ledger and rely on `pnpm exec tsc --noEmit -p apps/frontend/tsconfig.json` instead.

- [ ] **Step 11: Commit**

```bash
git add apps/frontend/src/app/\(app\)/\(mobile\) apps/frontend/src/components/mobile/
git commit -m "feat(mobile): /m route group with tab shell and desktop opt-out link

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Каналы screen

**Files:**
- Replace: `apps/frontend/src/components/mobile/mobile.channels.screen.tsx`
- Create: `apps/frontend/src/components/mobile/mobile.channels.screen.spec.tsx`

**Interfaces:**
- Consumes: `useIntegrationList` from `launches/helpers/use.integration.list` (SWR, returns array with `id, name, picture, identifier, disabled, refreshNeeded, inBetweenSteps`); `useAddProvider(update)` from `launches/add.provider.component` (opens the existing add-channel modal; `update` is called after a channel is added); `TelegramAssistantButton` from `layout/telegram.assistant.button`.
- Produces: `export const MobileChannelsScreen: FC`.

Status text per channel: `refreshNeeded` or `inBetweenSteps` → «Нужно переподключить» (amber); `disabled` → «Отключён» (grey); otherwise «Активен» (green). Empty list → «Пока нет каналов» plus the add button.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/components/mobile/mobile.channels.screen.spec.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.hoisted(() => ({ data: [] as any[], mutate: vi.fn() }));
const addProvider = vi.hoisted(() => vi.fn());

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@gitroom/frontend/components/launches/helpers/use.integration.list', () => ({
  useIntegrationList: () => list,
}));
vi.mock('@gitroom/frontend/components/launches/add.provider.component', () => ({
  useAddProvider: () => addProvider,
}));
vi.mock('@gitroom/frontend/components/layout/telegram.assistant.button', () => ({
  TelegramAssistantButton: () => <button type="button">Постить из Telegram</button>,
}));

import { MobileChannelsScreen } from './mobile.channels.screen';

beforeEach(() => {
  cleanup();
  list.data = [];
  addProvider.mockClear();
});

describe('MobileChannelsScreen', () => {
  it('shows the empty state and opens the add-channel flow', () => {
    render(<MobileChannelsScreen />);
    expect(screen.getByText('Пока нет каналов')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить канал' }));
    expect(addProvider).toHaveBeenCalledTimes(1);
  });

  it('lists channels with their status and flags channels that need reconnection', () => {
    list.data = [
      { id: '1', name: 'Мой VK', identifier: 'vk', picture: '/a.jpg', disabled: false, refreshNeeded: false, inBetweenSteps: false },
      { id: '2', name: 'Канал', identifier: 'telegram', picture: '/b.jpg', disabled: false, refreshNeeded: true, inBetweenSteps: false },
      { id: '3', name: 'Старый', identifier: 'x', picture: '/c.jpg', disabled: true, refreshNeeded: false, inBetweenSteps: false },
    ];
    render(<MobileChannelsScreen />);
    expect(screen.getByText('Мой VK')).toBeTruthy();
    expect(screen.getAllByText('Активен')).toHaveLength(1);
    expect(screen.getByText('Нужно переподключить')).toBeTruthy();
    expect(screen.getByText('Отключён')).toBeTruthy();
    expect(screen.queryByText('Пока нет каналов')).toBeNull();
  });

  it('offers the Telegram assistant link', () => {
    render(<MobileChannelsScreen />);
    expect(screen.getByRole('button', { name: 'Постить из Telegram' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/frontend/src/components/mobile/mobile.channels.screen.spec.tsx`
Expected: FAIL: "Пока нет каналов" not found (the stub renders «Каналы»).

- [ ] **Step 3: Implement the screen**

Replace `apps/frontend/src/components/mobile/mobile.channels.screen.tsx` with:

```tsx
'use client';

import { FC, useCallback } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useAddProvider } from '@gitroom/frontend/components/launches/add.provider.component';
import { TelegramAssistantButton } from '@gitroom/frontend/components/layout/telegram.assistant.button';

type Channel = {
  id: string;
  name: string;
  identifier: string;
  picture: string;
  disabled: boolean;
  refreshNeeded: boolean;
  inBetweenSteps: boolean;
};

const statusOf = (channel: Channel) =>
  channel.refreshNeeded || channel.inBetweenSteps
    ? 'reconnect'
    : channel.disabled
      ? 'disabled'
      : 'active';

export const MobileChannelsScreen: FC = () => {
  const t = useT();
  const { data, mutate } = useIntegrationList();
  const refresh = useCallback(() => {
    mutate();
  }, [mutate]);
  const addChannel = useAddProvider(refresh);
  const channels: Channel[] = data || [];

  const statusLabel = {
    active: { text: t('mobile_channel_active', 'Активен'), className: 'text-green-400' },
    reconnect: {
      text: t('mobile_channel_reconnect', 'Нужно переподключить'),
      className: 'text-amber-400',
    },
    disabled: { text: t('mobile_channel_disabled', 'Отключён'), className: 'text-textItemBlur' },
  };

  return (
    <div className="flex flex-col gap-[16px] pt-[16px]">
      <h1 className="text-[22px] font-[600]">{t('mobile_channels_title', 'Каналы')}</h1>

      {channels.length === 0 ? (
        <p className="text-textItemBlur text-[15px]">
          {t('mobile_channels_empty', 'Пока нет каналов')}
        </p>
      ) : (
        <ul className="flex flex-col gap-[8px]">
          {channels.map((channel) => {
            const status = statusLabel[statusOf(channel)];
            return (
              <li
                key={channel.id}
                className="flex items-center gap-[12px] rounded-[12px] bg-newBgColorInner px-[12px] py-[10px]"
              >
                <img
                  src={channel.picture}
                  alt=""
                  className="w-[40px] h-[40px] rounded-full object-cover bg-newBgLineColor"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-[600] truncate">{channel.name}</div>
                  <div className="text-[12px] text-textItemBlur">{channel.identifier}</div>
                </div>
                <div className={clsx('text-[12px] font-[600]', status.className)}>
                  {status.text}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={addChannel}
        className="h-[48px] rounded-[12px] bg-btnPrimary text-btnText text-[15px] font-[600]"
      >
        {t('mobile_add_channel', 'Добавить канал')}
      </button>

      <section className="mt-[16px] flex flex-col gap-[8px] rounded-[12px] bg-newBgColorInner p-[16px]">
        <h2 className="text-[16px] font-[600]">
          {t('mobile_assistant_title', 'Ассистент в мессенджере')}
        </h2>
        <p className="text-[13px] text-textItemBlur">
          {t(
            'mobile_assistant_hint',
            'Отправьте боту фото и текст — он опубликует их в выбранные каналы.'
          )}
        </p>
        <div>
          <TelegramAssistantButton />
        </div>
      </section>
    </div>
  );
};
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run apps/frontend/src/components/mobile/mobile.channels.screen.spec.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/mobile/mobile.channels.screen.tsx apps/frontend/src/components/mobile/mobile.channels.screen.spec.tsx
git commit -m "feat(mobile): channels screen with add channel and Telegram assistant link

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Пост tab first-run state and desktop "Мобильная версия" link

**Files:**
- Replace: `apps/frontend/src/components/mobile/mobile.post.screen.tsx`
- Create: `apps/frontend/src/components/mobile/mobile.post.screen.spec.tsx`
- Create: `apps/frontend/src/components/mobile/mobile.version.link.tsx`
- Modify: `apps/frontend/src/components/new-layout/layout.component.tsx` (one import, one element next to `<TelegramAssistantButton />`)

**Interfaces:**
- Consumes: `useIntegrationList` (same as Task 3).
- Produces: `MobilePostScreen: FC` (no channels → first-run card linking to `/m/channels`; channels present → placeholder text until stage 3); `MobileVersionLink: FC` (plain anchor to `/m`, clears the opt-out cookie on click so the redirect works again).

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/components/mobile/mobile.post.screen.spec.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.hoisted(() => ({ data: [] as any[], isLoading: false }));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@gitroom/frontend/components/launches/helpers/use.integration.list', () => ({
  useIntegrationList: () => list,
}));

import { MobilePostScreen } from './mobile.post.screen';

beforeEach(() => {
  cleanup();
  list.data = [];
});

describe('MobilePostScreen', () => {
  it('asks a new user to connect the first channel', () => {
    render(<MobilePostScreen />);
    const link = screen.getByRole('link', { name: 'Подключить первый канал' });
    expect(link.getAttribute('href')).toBe('/m/channels');
  });

  it('shows the editor placeholder once a channel exists', () => {
    list.data = [{ id: '1', name: 'VK', identifier: 'vk', picture: '', disabled: false, refreshNeeded: false, inBetweenSteps: false }];
    render(<MobilePostScreen />);
    expect(screen.queryByRole('link', { name: 'Подключить первый канал' })).toBeNull();
    expect(screen.getByText('Быстрый пост появится в следующем обновлении.')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/frontend/src/components/mobile/mobile.post.screen.spec.tsx`
Expected: FAIL on the first test (no link in the stub).

- [ ] **Step 3: Implement the screen and the desktop link**

Replace `apps/frontend/src/components/mobile/mobile.post.screen.tsx` with:

```tsx
'use client';

import { FC } from 'react';
import Link from 'next/link';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';

/** Stage 3 replaces the placeholder with the quick post editor. */
export const MobilePostScreen: FC = () => {
  const t = useT();
  const { data } = useIntegrationList();
  const channels = data || [];

  if (channels.length === 0) {
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

  return (
    <p className="pt-[24px] text-textItemBlur text-[15px]">
      {t('mobile_post_soon', 'Быстрый пост появится в следующем обновлении.')}
    </p>
  );
};
```

Create `apps/frontend/src/components/mobile/mobile.version.link.tsx`:

```tsx
'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { setCookie } from '@gitroom/frontend/components/layout/layout.context';
import { DESKTOP_COOKIE } from '@gitroom/frontend/components/mobile/mobile.detect';

/** Desktop top bar link into the phone shell; clears the opt-out cookie. */
export const MobileVersionLink: FC = () => {
  const t = useT();
  return (
    <a
      href="/m"
      onClick={() => setCookie(DESKTOP_COOKIE, '', -1)}
      className="text-[13px] hover:text-newTextColor"
    >
      {t('mobile_version_link', 'Мобильная версия')}
    </a>
  );
};
```

In `apps/frontend/src/components/new-layout/layout.component.tsx`, add the import next to the `TelegramAssistantButton` import:

```tsx
import { MobileVersionLink } from '@gitroom/frontend/components/mobile/mobile.version.link';
```

and render it immediately before `<TelegramAssistantButton />`:

```tsx
                          <MobileVersionLink />
                          <TelegramAssistantButton />
```

- [ ] **Step 4: Run the screen test and every mobile spec**

Run: `pnpm vitest run apps/frontend/src/components/mobile apps/frontend/src/proxy.mobile.spec.ts apps/frontend/src/proxy.localization.spec.ts`
Expected: PASS, 23 tests (8 detect + 4 proxy mobile + 3 proxy localization + 2 tab bar + 1 desktop link + 3 channels + 2 post).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/mobile/ apps/frontend/src/components/new-layout/layout.component.tsx
git commit -m "feat(mobile): first-run state on the post tab and desktop link to /m

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Flag plumbing, docs, spec status

**Files:**
- Modify: `docker-compose.override.yaml` (one env line under `services.postiz.environment`)
- Modify: `.env.example` (one commented line)
- Modify: `deploy/production-config.spec.ts` (one assertion)
- Create: `docs/server-scripts/35-toggle-mobile-route.sh`
- Modify: `docs/PROJECT.md` (short "Мобильная версия /m" section)
- Modify: `docs/superpowers/specs/2026-10-12-mobile-version-design.md` (stage 2 row → done)

- [ ] **Step 1: Write the failing config assertion**

In `deploy/production-config.spec.ts`, add inside the first `it(...)` after the PostHog expectations:

```ts
    expect(override).toContain(
      "MOBILE_ROUTE_ENABLED: '${MOBILE_ROUTE_ENABLED:-false}'"
    );
    expect(example).toContain('MOBILE_ROUTE_ENABLED="false"');
```

Run: `pnpm vitest run deploy/production-config.spec.ts`
Expected: FAIL on the new assertion.

- [ ] **Step 2: Add the env line, the example, and the toggle script**

In `docker-compose.override.yaml`, after the `NEXT_PUBLIC_POSTHOG_HOST` line add:

```yaml
      # Phone user agents are redirected from /launches to /m when 'true'
      MOBILE_ROUTE_ENABLED: '${MOBILE_ROUTE_ENABLED:-false}'
```

In `.env.example`, near the PostHog lines add:

```
# Redirect phones from /launches to the mobile shell /m ("true" to enable)
MOBILE_ROUTE_ENABLED="false"
```

Create `docs/server-scripts/35-toggle-mobile-route.sh` (make it executable):

```bash
#!/usr/bin/env bash
# Enable or disable the mobile shell redirect (MOBILE_ROUTE_ENABLED) in the
# production .env, then restart the app so the proxy picks it up.
# Usage on the server: bash 35-toggle-mobile-route.sh on|off
# From the operator machine:
#   scp -q docs/server-scripts/35-toggle-mobile-route.sh vezdepost:/tmp/vz-mobile.sh
#   ssh vezdepost 'bash /tmp/vz-mobile.sh on; rm -f /tmp/vz-mobile.sh'
set -euo pipefail

REPO_DIR=${REPO_DIR:-/root/postiz-app}
ENV_FILE="$REPO_DIR/.env"
case "${1:-}" in
  on) value=true ;;
  off) value=false ;;
  *) echo 'usage: 35-toggle-mobile-route.sh on|off' >&2; exit 2 ;;
esac

touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
temp_file=$(mktemp "$REPO_DIR/.env.mobile.XXXXXX")
trap 'rm -f "$temp_file"' EXIT
grep -v '^MOBILE_ROUTE_ENABLED=' "$ENV_FILE" > "$temp_file" || true
printf 'MOBILE_ROUTE_ENABLED=%s\n' "$value" >> "$temp_file"
chmod 600 "$temp_file"
mv "$temp_file" "$ENV_FILE"
trap - EXIT

cd "$REPO_DIR"
docker compose up -d postiz
echo "MOBILE_ROUTE_ENABLED=$value applied"
```

Run: `pnpm vitest run deploy/production-config.spec.ts`
Expected: PASS.

- [ ] **Step 3: Document**

Append to `docs/PROJECT.md` after the "Quick post API" section:

```markdown
### Мобильная версия `/m`

Отдельный маршрут для телефонов (`apps/frontend/src/app/(app)/(mobile)/m`,
компоненты в `apps/frontend/src/components/mobile/`). Детект по user-agent
живёт в `apps/frontend/src/proxy.ts` и включается переменной
`MOBILE_ROUTE_ENABLED=true` (compose override; переключатель
`docs/server-scripts/35-toggle-mobile-route.sh on|off`). Cookie `vz-desktop=1`
отключает редирект для пользователя («Полная версия»). Планшеты и десктоп не
редиректятся. Спека: `docs/superpowers/specs/2026-10-12-mobile-version-design.md`.
```

In the spec's stage table, change row 2's "Результат" cell to start with `Готово (коммит <sha of Task 4 commit>).`

- [ ] **Step 4: Full suite**

Run: `pnpm vitest run > /tmp/claude-full-suite.log 2>&1; echo $?; grep -E "Test Files|Tests |FAIL" /tmp/claude-full-suite.log | head`
Expected: exit 0, all files pass.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.override.yaml .env.example deploy/production-config.spec.ts docs/server-scripts/35-toggle-mobile-route.sh docs/PROJECT.md docs/superpowers/specs/2026-10-12-mobile-version-design.md
git commit -m "ops(mobile): MOBILE_ROUTE_ENABLED flag, toggle script and docs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
