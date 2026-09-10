# Channel Request Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render backend-catalogued unavailable channels as safe request actions, capture identified per-platform demand, localize the picker and support-email subjects, reset PostHog identity on sign-out, and document the manual PostHog demand-alert workflow.

**Architecture:** Consume the additive `canConnect` catalogue field only in the shared frontend picker, treating only the literal value `false` as unavailable for old-backend compatibility. Extract visual and interaction behavior into a focused card whose local state owns `Request` → `Requested`, while `AddProviderComponent` continues to own enabled-provider connection flows and analytics wiring. Keep PostHog as the sole request event sink, retain the generic email footer, and document a breakdown dashboard plus explicit filtered non-time-series alerts because native breakdown alerts do not provide independent one-shot state.

**Tech Stack:** React 19, Next.js, TypeScript, Tailwind CSS 3, react-i18next/i18next, PostHog JS, Vitest 3, Testing Library, Markdown operations documentation.

## Global Constraints

- Implement only the frontend `canConnect` consumer, extracted card, request analytics, picker/email localization, PostHog identity reset, and PostHog operations documentation approved in `docs/superpowers/specs/2026-08-24-onboarding-channel-availability-and-language-design.md`.
- Do not modify backend catalogue generation, deployment allowlists, Compose, `.env` files, authentication language selectors, shared modal behavior, auth server translation, or locale detection/proxy files.
- The backend interface is `canConnect: boolean`; the frontend type is optional for compatibility and treats only `canConnect === false` as unavailable.
- Preserve enabled-provider markup, tooltip behavior, connection analytics, OAuth/custom-field/extension paths, ordering, and navigation.
- Unavailable card-body clicks do nothing; only the explicit request button emits analytics.
- Emit exactly `platform_request_clicked`; for example, requesting Pinterest emits `{ platform: 'pinterest', source: 'unavailable_channel' }`.
- Never use translated display copy as the analytics `platform` value.
- Request capture must not fetch, navigate, start OAuth, emit connection analytics, open email/Telegram, or call an application notification endpoint.
- Analytics failures must not escape and must still advance the mounted card to `Requested`; one mounted card emits at most one request event.
- Omit unavailable providers from invite mode; show them dimmed without a request button on the embedded mobile provider surface.
- Retain the generic footer email link and its existing `{ platform: 'unspecified', source: 'channel_picker' }` analytics.
- Use only the six exact localization keys `missing_platform_prompt`, `missing_platform_email`, `request_platform`, `platform_requested`, `request_new_platform_email_subject`, and `provider_connection_help_email_subject` in all 14 configured locales: `en`, `he`, `ru`, `zh`, `fr`, `es`, `pt`, `de`, `it`, `ja`, `ko`, `ar`, `tr`, `vi`.
- Use English inline fallbacks; preserve the fixed recipient `fedrbodr@gmail.com` and provider interpolation in the connection-help subject.
- Call `posthog.reset()` before explicit logout and client auth-loss redirects.
- Use `pnpm` only, prefix shell commands with `rtk`, run tests from the repository root, and do not add dependencies.
- Follow TDD: observe each focused test fail before writing its production change.
- When executing this plan in a new worktree, first run `rtk pnpm install --frozen-lockfile` and `rtk pnpm run verify:workspace` as required by `CLAUDE.md`.

---

### Task 1: Add the unavailable-request analytics contract

**Files:**
- Modify: `apps/frontend/src/components/launches/channel-connect.analytics.ts:21-23,89-94`
- Modify: `apps/frontend/src/components/launches/channel-connect.analytics.spec.tsx:92-108`

**Interfaces:**
- Consumes: `useFireEvents(): (name: string, props?: Record<string, unknown>) => void`.
- Produces: `requestClicked(platform: string, source: 'channel_picker' | 'connection_error' | 'unavailable_channel'): void`.

- [ ] **Step 1: Write the failing unavailable-request event test**

Append this test to `channel-connect.analytics.spec.tsx`:

```tsx
it('tracks a stable unavailable-provider request without consuming the terminal guard', () => {
  const { result } = renderHook(() => useChannelConnectAnalytics());

  act(() => {
    result.current.requestClicked('pinterest', 'unavailable_channel');
    result.current.completed('pinterest');
  });

  expect(fireEvents).toHaveBeenNthCalledWith(1, 'platform_request_clicked', {
    platform: 'pinterest',
    source: 'unavailable_channel',
  });
  expect(fireEvents).toHaveBeenNthCalledWith(2, 'channel_connect_completed', {
    platform: 'pinterest',
    onboarding: false,
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
rtk pnpm exec vitest run apps/frontend/src/components/launches/channel-connect.analytics.spec.tsx
```

Expected: TypeScript/Vitest FAIL because `unavailable_channel` is not assignable to `RequestSource`.

- [ ] **Step 3: Extend only the request-source union**

Replace the existing source type with:

```ts
export type RequestSource =
  | 'channel_picker'
  | 'connection_error'
  | 'unavailable_channel';
```

Keep `requestClicked` unchanged so it still emits exactly one normalized event:

```ts
const requestClicked = useCallback(
  (platform: string, source: RequestSource) => {
    fireEvents('platform_request_clicked', { platform, source });
  },
  [fireEvents]
);
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command. Expected: all `channel-connect.analytics.spec.tsx` tests PASS.

- [ ] **Step 5: Commit Task 1**

```bash
rtk git add apps/frontend/src/components/launches/channel-connect.analytics.ts apps/frontend/src/components/launches/channel-connect.analytics.spec.tsx
rtk git commit -m "feat: add unavailable channel request analytics"
```

---

### Task 2: Extract the catalogue card and consume `canConnect`

**Files:**
- Create: `apps/frontend/src/components/launches/channel-picker-card.tsx`
- Create: `apps/frontend/src/components/launches/channel-picker-card.spec.tsx`
- Modify: `apps/frontend/src/components/launches/add.provider.component.tsx:553-578,583-590,925-1015`
- Modify: `apps/frontend/src/components/launches/add.provider.analytics.spec.tsx:1-75`

**Interfaces:**
- Consumes: optional `canConnect?: boolean` from each backend catalogue item, `runAnalyticsSafely(capture: () => void): void`, and Task 1's `requestClicked(identifier, 'unavailable_channel')` callback.
- Produces: `ChannelPickerCard(props: ChannelPickerCardProps)`, plus `isProviderVisibleInPicker(item, invite): boolean` for the invite filter.

- [ ] **Step 1: Write the failing extracted-card tests**

Create `channel-picker-card.spec.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ChannelPickerCard } from './channel-picker-card';

const baseProps = {
  identifier: 'pinterest',
  name: 'Pinterest',
  isMobile: false,
  requestLabel: 'Request',
  requestedLabel: 'Requested',
};

describe('ChannelPickerCard', () => {
  it('preserves the enabled card connection action and renders no request button', () => {
    const onConnect = vi.fn();
    render(
      <ChannelPickerCard
        {...baseProps}
        canConnect={true}
        onConnect={onConnect}
        onRequest={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('channel-card-pinterest'));
    expect(onConnect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Request Pinterest' })).toBeNull();
  });

  it('treats an omitted canConnect field as enabled for old backends', () => {
    const onConnect = vi.fn();
    render(
      <ChannelPickerCard
        {...baseProps}
        onConnect={onConnect}
        onRequest={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('channel-card-pinterest'));
    expect(onConnect).toHaveBeenCalledOnce();
  });

  it('preserves the enabled tooltip trigger and desktop card height', () => {
    render(
      <ChannelPickerCard
        {...baseProps}
        canConnect={true}
        toolTip="Requires a business account"
        onConnect={vi.fn()}
        onRequest={vi.fn()}
      />
    );

    const card = screen.getByTestId('channel-card-pinterest');
    expect(card.classList.contains('h-[100px]')).toBe(true);
    expect(card.getAttribute('data-tooltip-id')).toBe('tooltip');
    expect(card.getAttribute('data-tooltip-content')).toBe(
      'Requires a business account'
    );
    expect(card.querySelector('svg')).not.toBeNull();
  });

  it('preserves enabled connection behavior on embedded mobile', () => {
    const onConnect = vi.fn();
    render(
      <ChannelPickerCard
        {...baseProps}
        canConnect={true}
        isMobile={true}
        onConnect={onConnect}
        onRequest={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('channel-card-pinterest'));
    expect(onConnect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('makes an unavailable card body inert and requests only through its button', () => {
    const onConnect = vi.fn();
    const onRequest = vi.fn();
    render(
      <ChannelPickerCard
        {...baseProps}
        canConnect={false}
        onConnect={onConnect}
        onRequest={onRequest}
      />
    );

    fireEvent.click(screen.getByTestId('channel-card-pinterest'));
    expect(onConnect).not.toHaveBeenCalled();
    expect(onRequest).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Request Pinterest' }));
    expect(onRequest).toHaveBeenCalledOnce();
    expect(
      (screen.getByRole('button', {
        name: 'Requested Pinterest',
      }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('suppresses duplicate request events for one mounted card', () => {
    const onRequest = vi.fn();
    render(
      <ChannelPickerCard
        {...baseProps}
        canConnect={false}
        onConnect={vi.fn()}
        onRequest={onRequest}
      />
    );

    const request = screen.getByRole('button', { name: 'Request Pinterest' });
    fireEvent.click(request);
    fireEvent.click(request);

    expect(onRequest).toHaveBeenCalledOnce();
  });

  it('shows Requested even when the analytics callback throws', () => {
    render(
      <ChannelPickerCard
        {...baseProps}
        canConnect={false}
        onConnect={vi.fn()}
        onRequest={() => {
          throw new Error('analytics unavailable');
        }}
      />
    );

    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Request Pinterest' }))
    ).not.toThrow();
    expect(
      (screen.getByRole('button', {
        name: 'Requested Pinterest',
      }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('dims an unavailable mobile card but exposes no request action', () => {
    render(
      <ChannelPickerCard
        {...baseProps}
        canConnect={false}
        isMobile={true}
        onConnect={vi.fn()}
        onRequest={vi.fn()}
      />
    );

    expect(
      screen
        .getByTestId('channel-card-content-pinterest')
        .classList.contains('opacity-50')
    ).toBe(true);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
```

- [ ] **Step 2: Add failing invite and analytics-safety integration tests**

Extend imports in `add.provider.analytics.spec.tsx` with `isProviderVisibleInPicker`, then add:

```tsx
it('omits unavailable providers only in invite mode', () => {
  const unavailable = {
    canConnect: false,
    isExternal: false,
    isWeb3: false,
    isChromeExtension: false,
    customFields: undefined,
  };
  expect(isProviderVisibleInPicker(unavailable, false)).toBe(true);
  expect(isProviderVisibleInPicker(unavailable, true)).toBe(false);
});

it('retains eligible enabled providers in invite mode', () => {
  expect(
    isProviderVisibleInPicker(
      {
        canConnect: true,
        isExternal: false,
        isWeb3: false,
        isChromeExtension: false,
        customFields: undefined,
      },
      true
    )
  ).toBe(true);
});

it('wires unavailable requests to the provider identifier without connection work', () => {
  expect(source).toContain("analytics.requestClicked(item.identifier, 'unavailable_channel')");
  expect(source).toContain('canConnect?: boolean;');
  expect(source).toContain('<ChannelPickerCard');
});
```

- [ ] **Step 3: Run both focused test files and verify RED**

```bash
rtk pnpm exec vitest run apps/frontend/src/components/launches/channel-picker-card.spec.tsx apps/frontend/src/components/launches/add.provider.analytics.spec.tsx
```

Expected: FAIL because `channel-picker-card.tsx` and `isProviderVisibleInPicker` do not exist.

- [ ] **Step 4: Implement the focused card with local requested state**

Create `channel-picker-card.tsx` with this public interface and behavior:

```tsx
'use client';

import clsx from 'clsx';
import React, { useRef, useState } from 'react';

export type ChannelPickerCardProps = {
  identifier: string;
  name: string;
  toolTip?: string;
  canConnect?: boolean;
  isMobile: boolean;
  requestLabel: string;
  requestedLabel: string;
  onConnect?: () => void;
  onRequest: () => void;
};

export const ChannelPickerCard = ({
  identifier,
  name,
  toolTip,
  canConnect,
  isMobile,
  requestLabel,
  requestedLabel,
  onConnect,
  onRequest,
}: ChannelPickerCardProps) => {
  const unavailable = canConnect === false;
  const [requested, setRequested] = useState(false);
  const requestedRef = useRef(false);

  const request = () => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    try {
      onRequest();
    } catch {
      // Analytics must never block local request feedback.
    } finally {
      setRequested(true);
    }
  };

  return (
    <div
      data-testid={`channel-card-${identifier}`}
      onClick={unavailable ? undefined : onConnect}
      {...(toolTip && !unavailable
        ? {
            'data-tooltip-id': 'tooltip',
            'data-tooltip-content': toolTip,
          }
        : {})}
      className={clsx(
        isMobile
          ? 'flex-row h-[72px] p-[16px]'
          : unavailable
            ? 'flex-col min-h-[110px] p-[10px] justify-center'
            : 'flex-col p-[10px] h-[100px] justify-center',
        unavailable ? 'cursor-default' : 'cursor-pointer',
        'w-full text-[14px] rounded-[8px] bg-newTableHeader text-textColor relative items-center flex gap-[8px]'
      )}
    >
      <div
        data-testid={`channel-card-content-${identifier}`}
        className={clsx(
          'flex items-center gap-[10px]',
          isMobile ? 'flex-row' : 'flex-col',
          unavailable && 'opacity-50'
        )}
      >
        <div>
          {identifier === 'youtube' ? (
            <img src="/icons/platforms/youtube.svg" alt="" />
          ) : (
            <img
              className={clsx(
                'w-[32px] h-[32px]',
                identifier !== 'google_my_business' && 'rounded-full'
              )}
              src={`/icons/platforms/${identifier}.png`}
              alt=""
            />
          )}
        </div>
        <div className={clsx(isMobile ? '' : 'whitespace-pre-wrap', 'text-center')}>
          {name}
        </div>
      </div>

      {toolTip && !isMobile && !unavailable ? (
        <svg
          width="15"
          height="15"
          viewBox="0 0 26 26"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="absolute top-[10px] end-[10px]"
          aria-hidden="true"
        >
          <path
            d="M13 0C10.4288 0 7.91543 0.762437 5.77759 2.1909C3.63975 3.61935 1.97351 5.64968 0.989572 8.02512C0.0056327 10.4006 -0.251811 13.0144 0.249797 15.5362C0.751405 18.0579 1.98953 20.3743 3.80762 22.1924C5.6257 24.0105 7.94208 25.2486 10.4638 25.7502C12.9856 26.2518 15.5995 25.9944 17.9749 25.0104C20.3503 24.0265 22.3807 22.3603 23.8091 20.2224C25.2376 18.0846 26 15.5712 26 13C25.9964 9.5533 24.6256 6.24882 22.1884 3.81163C19.7512 1.37445 16.4467 0.00363977 13 0ZM13 21C12.7033 21 12.4133 20.912 12.1667 20.7472C11.92 20.5824 11.7277 20.3481 11.6142 20.074C11.5007 19.7999 11.471 19.4983 11.5288 19.2074C11.5867 18.9164 11.7296 18.6491 11.9393 18.4393C12.1491 18.2296 12.4164 18.0867 12.7074 18.0288C12.9983 17.9709 13.2999 18.0007 13.574 18.1142C13.8481 18.2277 14.0824 18.42 14.2472 18.6666C14.412 18.9133 14.5 19.2033 14.5 19.5C14.5 19.8978 14.342 20.2794 14.0607 20.5607C13.7794 20.842 13.3978 21 13 21ZM14 14.91V15C14 15.2652 13.8946 15.5196 13.7071 15.7071C13.5196 15.8946 13.2652 16 13 16C12.7348 16 12.4804 15.8946 12.2929 15.7071C12.1054 15.5196 12 15.2652 12 15V14C12 13.7348 12.1054 13.4804 12.2929 13.2929C12.4804 13.1054 12.7348 13 13 13C14.6538 13 16 11.875 16 10.5C16 9.125 14.6538 8 13 8C11.3463 8 10 9.125 10 10.5V11C10 11.2652 9.89465 11.5196 9.70711 11.7071C9.51958 11.8946 9.26522 12 9.00001 12C8.73479 12 8.48044 11.8946 8.2929 11.7071C8.10536 11.5196 8.00001 11.2652 8.00001 11V10.5C8.00001 8.01875 10.2425 6 13 6C15.7575 6 18 8.01875 18 10.5C18 12.6725 16.28 14.4913 14 14.91Z"
            fill="currentColor"
          />
        </svg>
      ) : null}

      {unavailable && !isMobile ? (
        <button
          type="button"
          disabled={requested}
          aria-label={`${requested ? requestedLabel : requestLabel} ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            request();
          }}
          className="max-w-full whitespace-normal break-words rounded-[6px] border border-tableBorder px-[8px] py-[4px] text-[11px] leading-[14px] text-textColor disabled:cursor-default"
        >
          {requested ? requestedLabel : requestLabel}
        </button>
      ) : null}
    </div>
  );
};
```

- [ ] **Step 5: Add the optional frontend field and pure invite predicate**

Add `canConnect?: boolean` to the `social` item type. Export this predicate above `AddProviderComponent`:

```ts
type PickerVisibilityItem = {
  canConnect?: boolean;
  isExternal: boolean;
  isWeb3: boolean;
  isChromeExtension?: boolean;
  customFields?: unknown[];
};

export const isProviderVisibleInPicker = (
  item: PickerVisibilityItem,
  invite: boolean
) =>
  !invite ||
  (item.canConnect !== false &&
    !item.isExternal &&
    !item.isWeb3 &&
    !item.isChromeExtension &&
    !item.customFields);
```

Replace the inline filter with:

```ts
.filter((item) => isProviderVisibleInPicker(item, props.invite))
```

- [ ] **Step 6: Replace only the card map with the extracted component**

Add this import to `add.provider.component.tsx`:

```tsx
import { ChannelPickerCard } from './channel-picker-card';
```

Preserve `getSocialLink(...)` exactly and pass it only as the enabled callback:

```tsx
<ChannelPickerCard
  key={item.identifier}
  identifier={item.identifier}
  name={item.name}
  toolTip={item.toolTip}
  canConnect={item.canConnect}
  isMobile={!!isMobile}
  requestLabel={t('request_platform', 'Request')}
  requestedLabel={t('platform_requested', 'Requested')}
  onConnect={
    item.canConnect === false
      ? undefined
      : getSocialLink(
          props.invite,
          item.identifier,
          item.isExternal,
          item.isWeb3,
          item.isChromeExtension,
          item.customFields,
          item.customFieldsInstructions
        )
  }
  onRequest={() =>
    runAnalyticsSafely(() =>
      analytics.requestClicked(item.identifier, 'unavailable_channel')
    )
  }
/>
```

Do not move or alter the generic footer in this task. The unavailable card neither receives nor attaches a connection handler because the caller passes `undefined` and `ChannelPickerCard` omits `onClick` when `canConnect === false`.

- [ ] **Step 7: Run the focused tests and verify GREEN**

Run the Step 3 command. Expected: both files PASS, including enabled compatibility, inert unavailable body, one request per mount, analytics-failure feedback, invite exclusion, and mobile hiding.

- [ ] **Step 8: Run the existing connection regression tests**

```bash
rtk pnpm exec vitest run apps/frontend/src/components/launches/add.provider.analytics.spec.tsx apps/frontend/src/components/launches/channel-connect.analytics.spec.tsx apps/frontend/src/components/launches/channel-support-link.spec.tsx apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx
```

Expected: all tests PASS; enabled connection analytics and the generic footer remain intact.

- [ ] **Step 9: Commit Task 2**

```bash
rtk git add apps/frontend/src/components/launches/channel-picker-card.tsx apps/frontend/src/components/launches/channel-picker-card.spec.tsx apps/frontend/src/components/launches/add.provider.component.tsx apps/frontend/src/components/launches/add.provider.analytics.spec.tsx
rtk git commit -m "feat: render unavailable channel request cards"
```

---

### Task 3: Localize picker copy and both support-email subjects

**Files:**
- Create: `apps/frontend/src/components/launches/channel-picker.localization.spec.ts`
- Modify: `apps/frontend/src/components/launches/add.provider.component.tsx:1007-1014`
- Modify: `apps/frontend/src/components/launches/channel-support-link.tsx:1-35`
- Modify: `apps/frontend/src/components/launches/channel-support-link.spec.tsx:1-69`
- Modify: `libraries/react-shared-libraries/src/translation/locales/en/translation.json`
- Modify: `libraries/react-shared-libraries/src/translation/locales/he/translation.json`
- Modify: `libraries/react-shared-libraries/src/translation/locales/ru/translation.json`
- Modify: `libraries/react-shared-libraries/src/translation/locales/zh/translation.json`
- Modify: `libraries/react-shared-libraries/src/translation/locales/fr/translation.json`
- Modify: `libraries/react-shared-libraries/src/translation/locales/es/translation.json`
- Modify: `libraries/react-shared-libraries/src/translation/locales/pt/translation.json`
- Modify: `libraries/react-shared-libraries/src/translation/locales/de/translation.json`
- Modify: `libraries/react-shared-libraries/src/translation/locales/it/translation.json`
- Modify: `libraries/react-shared-libraries/src/translation/locales/ja/translation.json`
- Modify: `libraries/react-shared-libraries/src/translation/locales/ko/translation.json`
- Modify: `libraries/react-shared-libraries/src/translation/locales/ar/translation.json`
- Modify: `libraries/react-shared-libraries/src/translation/locales/tr/translation.json`
- Modify: `libraries/react-shared-libraries/src/translation/locales/vi/translation.json`

**Interfaces:**
- Consumes: `useT()` from react-i18next and the existing `ChannelSupportLink` props.
- Produces: six non-empty keys in every configured locale and an interpolated `provider_connection_help_email_subject` using `{{platform}}`.

- [ ] **Step 1: Write the failing locale completeness test**

Create `channel-picker.localization.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { languages } from '@gitroom/react/translation/i18n.config';

const keys = [
  'missing_platform_prompt',
  'missing_platform_email',
  'request_platform',
  'platform_requested',
  'request_new_platform_email_subject',
  'provider_connection_help_email_subject',
] as const;

const catalogue = (language: string) => {
  const path = new URL(
    `../../../../../libraries/react-shared-libraries/src/translation/locales/${language}/translation.json`,
    import.meta.url
  );
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
};

describe('channel-picker translations', () => {
  it('defines every reviewed key in all 14 configured locales', () => {
    expect(languages).toEqual([
      'en', 'he', 'ru', 'zh', 'fr', 'es', 'pt',
      'de', 'it', 'ja', 'ko', 'ar', 'tr', 'vi',
    ]);
    for (const language of languages) {
      for (const key of keys) {
        expect(catalogue(language)[key], `${language}.${key}`).toBeTruthy();
      }
      expect(
        catalogue(language).provider_connection_help_email_subject,
        `${language} provider interpolation`
      ).toContain('{{platform}}');
    }
  });

  it('pins the reviewed English and Russian copy', () => {
    expect(keys.map((key) => catalogue('en')[key])).toEqual([
      "Can't find the platform you need?",
      "Email us — we'll try to add it.",
      'Request',
      'Requested',
      'Request a new platform in Vezdepost',
      "Can't connect {{platform}} in Vezdepost",
    ]);
    expect(keys.map((key) => catalogue('ru')[key])).toEqual([
      'Не нашли нужную платформу?',
      'Напишите нам — постараемся добавить.',
      'Запросить',
      'Запрошено',
      'Нужна новая платформа в Вездепосте',
      'Не подключается {{platform}} в Вездепосте',
    ]);
  });
});
```

- [ ] **Step 2: Update the support-link tests for translated subjects**

Add this mock beside the existing analytics mock in `channel-support-link.spec.tsx` so the test translator returns English defaults and interpolates `platform`:

```tsx
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (
      _key: string,
      fallback:
        | string
        | { defaultValue: string; platform?: string }
    ) => {
      if (typeof fallback === 'string') return fallback;
      return fallback.defaultValue.replace(
        '{{platform}}',
        fallback.platform ?? ''
      );
    },
}));
```

Replace the two mail-subject expectations with:

```tsx
expect(link.getAttribute('href')).toBe(
  `mailto:fedrbodr@gmail.com?subject=${encodeURIComponent(
    "Can't connect X in Vezdepost"
  )}`
);

expect(genericLink.getAttribute('href')).toBe(
  `mailto:fedrbodr@gmail.com?subject=${encodeURIComponent(
    'Request a new platform in Vezdepost'
  )}`
);
```

Keep the click assertions exactly `('x', 'connection_error')` and `('unspecified', 'channel_picker')` so localization cannot change analytics.

- [ ] **Step 3: Run localization and support-link tests and verify RED**

```bash
rtk pnpm exec vitest run apps/frontend/src/components/launches/channel-picker.localization.spec.ts apps/frontend/src/components/launches/channel-support-link.spec.tsx
```

Expected: FAIL because all six keys are absent and `ChannelSupportLink` still hard-codes Russian subjects.

- [ ] **Step 4: Add the six reviewed translations to all configured catalogues**

Add these exact JSON values to the corresponding `translation.json` files:

```json
{
  "en": {
    "missing_platform_prompt": "Can't find the platform you need?",
    "missing_platform_email": "Email us — we'll try to add it.",
    "request_platform": "Request",
    "platform_requested": "Requested",
    "request_new_platform_email_subject": "Request a new platform in Vezdepost",
    "provider_connection_help_email_subject": "Can't connect {{platform}} in Vezdepost"
  },
  "he": {
    "missing_platform_prompt": "לא מצאתם את הפלטפורמה שאתם צריכים?",
    "missing_platform_email": "שלחו לנו אימייל — ננסה להוסיף אותה.",
    "request_platform": "בקשה",
    "platform_requested": "התבקש",
    "request_new_platform_email_subject": "בקשה לפלטפורמה חדשה ב-Vezdepost",
    "provider_connection_help_email_subject": "לא ניתן לחבר את {{platform}} ב-Vezdepost"
  },
  "ru": {
    "missing_platform_prompt": "Не нашли нужную платформу?",
    "missing_platform_email": "Напишите нам — постараемся добавить.",
    "request_platform": "Запросить",
    "platform_requested": "Запрошено",
    "request_new_platform_email_subject": "Нужна новая платформа в Вездепосте",
    "provider_connection_help_email_subject": "Не подключается {{platform}} в Вездепосте"
  },
  "zh": {
    "missing_platform_prompt": "找不到您需要的平台吗？",
    "missing_platform_email": "给我们发邮件——我们会尝试添加。",
    "request_platform": "申请",
    "platform_requested": "已申请",
    "request_new_platform_email_subject": "申请在 Vezdepost 中添加新平台",
    "provider_connection_help_email_subject": "无法在 Vezdepost 中连接 {{platform}}"
  },
  "fr": {
    "missing_platform_prompt": "Vous ne trouvez pas la plateforme dont vous avez besoin ?",
    "missing_platform_email": "Envoyez-nous un e-mail — nous essaierons de l'ajouter.",
    "request_platform": "Demander",
    "platform_requested": "Demandée",
    "request_new_platform_email_subject": "Demande d'une nouvelle plateforme dans Vezdepost",
    "provider_connection_help_email_subject": "Impossible de connecter {{platform}} dans Vezdepost"
  },
  "es": {
    "missing_platform_prompt": "¿No encuentras la plataforma que necesitas?",
    "missing_platform_email": "Escríbenos — intentaremos añadirla.",
    "request_platform": "Solicitar",
    "platform_requested": "Solicitada",
    "request_new_platform_email_subject": "Solicitar una nueva plataforma en Vezdepost",
    "provider_connection_help_email_subject": "No se puede conectar {{platform}} en Vezdepost"
  },
  "pt": {
    "missing_platform_prompt": "Não encontra a plataforma de que precisa?",
    "missing_platform_email": "Envie-nos um e-mail — tentaremos adicioná-la.",
    "request_platform": "Solicitar",
    "platform_requested": "Solicitada",
    "request_new_platform_email_subject": "Solicitar uma nova plataforma no Vezdepost",
    "provider_connection_help_email_subject": "Não é possível conectar {{platform}} no Vezdepost"
  },
  "de": {
    "missing_platform_prompt": "Ist die gewünschte Plattform nicht dabei?",
    "missing_platform_email": "Schreiben Sie uns eine E-Mail — wir versuchen, sie hinzuzufügen.",
    "request_platform": "Anfragen",
    "platform_requested": "Angefragt",
    "request_new_platform_email_subject": "Neue Plattform in Vezdepost anfragen",
    "provider_connection_help_email_subject": "{{platform}} kann in Vezdepost nicht verbunden werden"
  },
  "it": {
    "missing_platform_prompt": "Non trovi la piattaforma che ti serve?",
    "missing_platform_email": "Scrivici un'e-mail — proveremo ad aggiungerla.",
    "request_platform": "Richiedi",
    "platform_requested": "Richiesta",
    "request_new_platform_email_subject": "Richiedi una nuova piattaforma in Vezdepost",
    "provider_connection_help_email_subject": "Impossibile connettere {{platform}} in Vezdepost"
  },
  "ja": {
    "missing_platform_prompt": "必要なプラットフォームが見つかりませんか？",
    "missing_platform_email": "メールでお知らせください。追加を検討します。",
    "request_platform": "リクエスト",
    "platform_requested": "リクエスト済み",
    "request_new_platform_email_subject": "Vezdepost に新しいプラットフォームをリクエスト",
    "provider_connection_help_email_subject": "Vezdepost で {{platform}} に接続できません"
  },
  "ko": {
    "missing_platform_prompt": "필요한 플랫폼을 찾을 수 없나요?",
    "missing_platform_email": "이메일로 알려 주세요. 추가를 검토하겠습니다.",
    "request_platform": "요청",
    "platform_requested": "요청됨",
    "request_new_platform_email_subject": "Vezdepost에 새 플랫폼 요청",
    "provider_connection_help_email_subject": "Vezdepost에서 {{platform}}에 연결할 수 없음"
  },
  "ar": {
    "missing_platform_prompt": "ألا تجد المنصة التي تحتاج إليها؟",
    "missing_platform_email": "راسلنا عبر البريد الإلكتروني — سنحاول إضافتها.",
    "request_platform": "طلب",
    "platform_requested": "تم الطلب",
    "request_new_platform_email_subject": "طلب منصة جديدة في Vezdepost",
    "provider_connection_help_email_subject": "تعذر ربط {{platform}} في Vezdepost"
  },
  "tr": {
    "missing_platform_prompt": "İhtiyacınız olan platformu bulamadınız mı?",
    "missing_platform_email": "Bize e-posta gönderin — eklemeye çalışalım.",
    "request_platform": "Talep et",
    "platform_requested": "Talep edildi",
    "request_new_platform_email_subject": "Vezdepost'a yeni platform talebi",
    "provider_connection_help_email_subject": "{{platform}} Vezdepost'a bağlanamıyor"
  },
  "vi": {
    "missing_platform_prompt": "Không tìm thấy nền tảng bạn cần?",
    "missing_platform_email": "Hãy gửi email cho chúng tôi — chúng tôi sẽ cố gắng bổ sung.",
    "request_platform": "Yêu cầu",
    "platform_requested": "Đã yêu cầu",
    "request_new_platform_email_subject": "Yêu cầu nền tảng mới trong Vezdepost",
    "provider_connection_help_email_subject": "Không thể kết nối {{platform}} trong Vezdepost"
  }
}
```

The outer language keys above describe the target files; add only each inner six-key object to that language's existing JSON object. Do not add these keys to dormant `bn` or `ka_ge` catalogues.

- [ ] **Step 5: Switch the footer fallbacks to English**

Keep the generic `ChannelSupportLink` and analytics source unchanged, replacing only inline fallbacks:

```tsx
<p className="mt-[14px] text-[13px] text-textColor/70 text-center">
  {t('missing_platform_prompt', "Can't find the platform you need?")}{' '}
  <ChannelSupportLink source="channel_picker" className="underline">
    {t('missing_platform_email', "Email us — we'll try to add it.")}
  </ChannelSupportLink>
</p>
```

- [ ] **Step 6: Localize both `ChannelSupportLink` subject variants**

Add the translation import to `channel-support-link.tsx`:

```tsx
import { useT } from '@gitroom/react/translation/get.transation.service.client';
```

Then construct subjects with English defaults and interpolation:

```tsx
const t = useT();
const displayPlatform = platform === 'x' ? 'X' : platform;
const subject = platform
  ? t('provider_connection_help_email_subject', {
      defaultValue: "Can't connect {{platform}} in Vezdepost",
      platform: displayPlatform,
    })
  : t(
      'request_new_platform_email_subject',
      'Request a new platform in Vezdepost'
    );
```

Keep `analyticsPlatform`, recipient, `encodeURIComponent`, click safety, and request analytics unchanged.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run the Step 3 command. Expected: all locale and support-link tests PASS.

- [ ] **Step 8: Validate every modified JSON catalogue parses**

```bash
rtk node -e "for (const l of ['en','he','ru','zh','fr','es','pt','de','it','ja','ko','ar','tr','vi']) JSON.parse(require('fs').readFileSync('libraries/react-shared-libraries/src/translation/locales/'+l+'/translation.json','utf8')); console.log('14 locale catalogues valid')"
```

Expected: exactly `14 locale catalogues valid` and exit code 0.

- [ ] **Step 9: Commit Task 3**

```bash
rtk git add apps/frontend/src/components/launches/add.provider.component.tsx apps/frontend/src/components/launches/channel-support-link.tsx apps/frontend/src/components/launches/channel-support-link.spec.tsx apps/frontend/src/components/launches/channel-picker.localization.spec.ts libraries/react-shared-libraries/src/translation/locales/en/translation.json libraries/react-shared-libraries/src/translation/locales/he/translation.json libraries/react-shared-libraries/src/translation/locales/ru/translation.json libraries/react-shared-libraries/src/translation/locales/zh/translation.json libraries/react-shared-libraries/src/translation/locales/fr/translation.json libraries/react-shared-libraries/src/translation/locales/es/translation.json libraries/react-shared-libraries/src/translation/locales/pt/translation.json libraries/react-shared-libraries/src/translation/locales/de/translation.json libraries/react-shared-libraries/src/translation/locales/it/translation.json libraries/react-shared-libraries/src/translation/locales/ja/translation.json libraries/react-shared-libraries/src/translation/locales/ko/translation.json libraries/react-shared-libraries/src/translation/locales/ar/translation.json libraries/react-shared-libraries/src/translation/locales/tr/translation.json libraries/react-shared-libraries/src/translation/locales/vi/translation.json
rtk git commit -m "feat: localize channel request copy"
```

---

### Task 4: Reset PostHog identity before logout and auth-loss redirects

**Files:**
- Create: `libraries/helpers/src/utils/posthog.identity.ts`
- Create: `libraries/helpers/src/utils/posthog.identity.spec.ts`
- Create: `apps/frontend/src/components/layout/posthog.identity.integration.spec.ts`
- Modify: `apps/frontend/src/components/layout/logout.component.tsx:1-35`
- Modify: `apps/frontend/src/components/layout/layout.context.tsx:1-101`

**Interfaces:**
- Consumes: `usePostHog(): { reset(): void }` and redirect callbacks already owned by the two layout components.
- Produces: `resetPostHogBeforeRedirect(reset: () => void, redirect: () => void): void`, guaranteeing reset-before-navigation order.

- [ ] **Step 1: Write the failing reset-order unit test**

Create `posthog.identity.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { resetPostHogBeforeRedirect } from './posthog.identity';

describe('resetPostHogBeforeRedirect', () => {
  it('resets the distinct id before navigation', () => {
    const order: string[] = [];
    const reset = vi.fn(() => order.push('reset'));
    const redirect = vi.fn(() => order.push('redirect'));

    resetPostHogBeforeRedirect(reset, redirect);

    expect(reset).toHaveBeenCalledOnce();
    expect(redirect).toHaveBeenCalledOnce();
    expect(order).toEqual(['reset', 'redirect']);
  });

  it('does not let a reset failure block sign-out navigation', () => {
    const redirect = vi.fn();

    expect(() =>
      resetPostHogBeforeRedirect(() => {
        throw new Error('PostHog unavailable');
      }, redirect)
    ).toThrow('PostHog unavailable');
    expect(redirect).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Write the failing integration-source test for every redirect path**

Create `posthog.identity.integration.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const logoutSource = readFileSync(
  new URL('./logout.component.tsx', import.meta.url),
  'utf8'
);
const layoutSource = readFileSync(
  new URL('./layout.context.tsx', import.meta.url),
  'utf8'
);

describe('PostHog identity lifecycle wiring', () => {
  it('resets before explicit logout redirect', () => {
    expect(logoutSource).toContain('usePostHog()');
    expect(logoutSource).toContain('resetPostHogBeforeRedirect(');
  });

  it('resets before insecure logout-header and general auth-loss redirects', () => {
    expect(layoutSource).toContain('usePostHog()');
    expect(layoutSource.match(/resetPostHogBeforeRedirect\(/g)).toHaveLength(2);
    expect(layoutSource).toContain("response.status === 401 || response?.headers?.get('logout')");
  });
});
```

- [ ] **Step 3: Run both identity tests and verify RED**

```bash
rtk pnpm exec vitest run libraries/helpers/src/utils/posthog.identity.spec.ts apps/frontend/src/components/layout/posthog.identity.integration.spec.ts
```

Expected: FAIL because the helper is absent and neither component uses PostHog reset.

- [ ] **Step 4: Implement the reset-before-redirect helper**

Create `posthog.identity.ts`:

```ts
export const resetPostHogBeforeRedirect = (
  reset: () => void,
  redirect: () => void
) => {
  try {
    reset();
  } finally {
    redirect();
  }
};
```

- [ ] **Step 5: Wire explicit logout through the helper**

Add these imports to `logout.component.tsx`:

```tsx
import { usePostHog } from 'posthog-js/react';
import { resetPostHogBeforeRedirect } from '@gitroom/helpers/utils/posthog.identity';
```

Then add:

```ts
const posthog = usePostHog();
```

Replace the existing direct root assignment after the auth cookie/session has been cleared with:

```ts
resetPostHogBeforeRedirect(
  () => posthog.reset(),
  () => {
    window.location.href = '/';
  }
);
```

Replace the existing direct `window.location.href = '/'`. Add `fetch`, `isSecured`, `posthog`, and `t` to the logout callback dependency list so the callback never closes over a stale analytics client.

- [ ] **Step 6: Wire both authenticated layout auth-loss branches**

Add these imports to `layout.context.tsx`:

```tsx
import { usePostHog } from 'posthog-js/react';
import { resetPostHogBeforeRedirect } from '@gitroom/helpers/utils/posthog.identity';
```

In `LayoutContextInner`, add:

```ts
const posthog = usePostHog();
```

Replace each of the two direct root redirects caused by auth loss with:

```ts
resetPostHogBeforeRedirect(
  () => posthog.reset(),
  () => {
    window.location.href = '/';
  }
);
```

The two required sites are:

1. the early `logout && !isSecured` branch after clearing `auth`, `showorg`, and `impersonate` cookies;
2. the general `response.status === 401 || response.headers.get('logout')` branch after its cookie cleanup.

Do not reset on onboarding redirects, ordinary reloads, payment redirects, `/p/`, or `/provider/` early returns. Add `isGeneral`, `isSecured`, `posthog`, and `returnUrl` to the `afterRequest` callback dependencies.

- [ ] **Step 7: Run the focused identity tests and verify GREEN**

Run the Step 3 command. Expected: both test files PASS and the helper order is `reset`, then `redirect`.

- [ ] **Step 8: Run existing event identity tests**

```bash
rtk pnpm exec vitest run libraries/helpers/src/utils/use.fire.events.spec.tsx libraries/helpers/src/utils/posthog.identity.spec.ts apps/frontend/src/components/layout/posthog.identity.integration.spec.ts
```

Expected: all tests PASS; signed-in capture still identifies `user.id` before the event, while sign-out resets it.

- [ ] **Step 9: Commit Task 4**

```bash
rtk git add libraries/helpers/src/utils/posthog.identity.ts libraries/helpers/src/utils/posthog.identity.spec.ts apps/frontend/src/components/layout/posthog.identity.integration.spec.ts apps/frontend/src/components/layout/logout.component.tsx apps/frontend/src/components/layout/layout.context.tsx
rtk git commit -m "fix: reset PostHog identity on auth loss"
```

---

### Task 5: Document PostHog demand monitoring and perform final verification

**Files:**
- Modify: `deploy/README.md:35-52`
- Test: all focused files created or modified in Tasks 1-4

**Interfaces:**
- Consumes: `platform_request_clicked`, event property `source = unavailable_channel`, stable `platform` identifiers, and identified `user.id` distinct IDs.
- Produces: a manual operations procedure for one breakdown dashboard and up to five independent filtered aggregate alerts.

- [ ] **Step 1: Write the failing runbook-content check**

Run:

```bash
rtk rg -n "Unavailable channel demand — all-time unique users|source = unavailable_channel|aggregation = Unique users|breakdown = platform|upper bound = 9|non-time-series|five alerts per organization|disable the alert immediately" deploy/README.md
```

Expected: exit code 1 because the PostHog section contains configuration only and no demand dashboard/alert procedure.

- [ ] **Step 2: Add the exact PostHog dashboard procedure**

Append this subsection under `## PostHog` in `deploy/README.md`:

```markdown
### Unavailable-channel demand

Create a PostHog dashboard named `Unavailable channel demand`. Create the
saved Trends insight `Unavailable channel demand — all-time unique users`, add
it to that dashboard, and configure it with:

- event `platform_request_clicked`;
- event-property filter `source = unavailable_channel`;
- aggregation `Unique users`;
- event-property breakdown `platform`;
- date range `All time`.

This breakdown is the demand dashboard only. Do not attach one alert to the
breakdown and assume it tracks each platform independently: PostHog keeps one
alert state for the insight and can report only the first breaching breakdown.
```

- [ ] **Step 3: Add the exact filtered-alert and rotation procedure**

Continue the same subsection with:

```markdown
For each platform selected for monitoring, create an explicit
platform-filtered non-time-series Trends aggregate using the same event,
`source = unavailable_channel`, `aggregation = Unique users`, and `All time`
date range. Add an event-property filter named `platform` and select the exact
stable identifier displayed for that provider in the saved breakdown dashboard.
Use a Bold number or another non-time-series aggregate; a time-series alert
evaluates an interval rather than lifetime cumulative demand.

Attach one absolute `has value` alert to each explicit platform aggregate:

1. set the upper bound to `9` because PostHog uses strict `>` comparison and
   must fire when the value becomes 10;
2. select the desired hourly or daily check cadence;
3. subscribe the Vezdepost owner's existing PostHog user so the owner receives
   email and in-app notification;
4. when the first threshold email arrives, disable the alert immediately,
   because a cumulative breached insight re-notifies on each scheduled check;
5. use the breakdown dashboard to assign the freed slot to the next candidate.

The free tier permits five alerts per organization, not per project. Alert
checks are asynchronous and do not fire synchronously on the tenth click.
Exact automatic one-shot notification for every platform requires external
state or automation and is intentionally not part of this deployment.
```

The operator must copy the literal identifier displayed by the saved breakdown when creating each PostHog filter. Do not add Telegram, application email, or webhook automation.

- [ ] **Step 4: Verify the runbook content**

Run the Step 1 command. Expected: all required phrases are printed and exit code is 0.

- [ ] **Step 5: Run the complete focused frontend suite**

```bash
rtk pnpm exec vitest run apps/frontend/src/components/launches/channel-connect.analytics.spec.tsx apps/frontend/src/components/launches/channel-picker-card.spec.tsx apps/frontend/src/components/launches/add.provider.analytics.spec.tsx apps/frontend/src/components/launches/channel-support-link.spec.tsx apps/frontend/src/components/launches/channel-picker.localization.spec.ts apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx libraries/helpers/src/utils/use.fire.events.spec.tsx libraries/helpers/src/utils/posthog.identity.spec.ts apps/frontend/src/components/layout/posthog.identity.integration.spec.ts
```

Expected: all listed test files PASS with no unhandled analytics, navigation, or React warnings.

- [ ] **Step 6: Verify workspace bootstrap and build the frontend**

```bash
rtk pnpm run verify:workspace
rtk pnpm run build:frontend
```

Expected: both commands exit 0. The frontend build completes without TypeScript, translation JSON, hook dependency, or Tailwind errors.

- [ ] **Step 7: Inspect the narrow and onboarding picker layouts**

Run the existing frontend locally:

```bash
rtk pnpm run dev:frontend
```

In an authenticated development session, open the normal Add Channel modal and the onboarding picker. At 375 CSS pixels and desktop width, verify an unavailable card dims only icon/name content, keeps the localized request button legible and focusable, wraps without horizontal overflow, does nothing when its body is clicked, and changes once to `Requested`. Verify enabled cards retain their 5-column/9-column placement and embedded mobile hides unavailable request controls. Stop the development server after inspection.

- [ ] **Step 8: Verify scope and whitespace**

```bash
rtk git diff --check
rtk git status --short
```

Expected: `git diff --check` exits 0. Status contains only the frontend picker/analytics/layout files, the 14 configured locale catalogues, `deploy/README.md`, and their focused tests; it contains no backend, deployment allowlist, Compose, auth-language-selector, modal, auth translation, or proxy changes.

- [ ] **Step 9: Commit Task 5**

```bash
rtk git add deploy/README.md
rtk git commit -m "docs: add channel demand alert runbook"
```

---

## Completion Criteria

- Enabled catalogue items behave exactly as before, including an omitted `canConnect` field.
- Unavailable desktop/onboarding cards expose one safe request action per mount and no connection side effect.
- Invite mode omits unavailable providers; embedded mobile shows them dimmed without request actions.
- The generic footer email and unspecified-platform event remain present.
- All six reviewed strings exist in exactly the 14 configured locales, with English fallbacks and localized/interpolated email subjects.
- PostHog identifies request events with the signed-in internal `user.id` and resets identity before logout/auth-loss navigation.
- The operations runbook distinguishes the breakdown dashboard from independent filtered non-time-series alerts, uses upper bound `9`, states the five-alert organization limit, and requires manual disable after the first email.
- Focused tests, workspace verification, frontend build, visual checks, and `git diff --check` all pass with fresh output.
