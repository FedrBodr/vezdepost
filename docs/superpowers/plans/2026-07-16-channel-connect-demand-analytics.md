# Channel Connection Demand Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the channel-connection funnel in PostHog, give users a provider-aware support email link, and make the existing X OAuth credentials available to the Vezdepost production container.

**Architecture:** Keep analytics in the frontend's existing PostHog/Plausible adapter, but remove its unrelated Stripe gate. A focused channel-connect analytics hook owns the event names, normalized properties, and exactly-once terminal capture; a reusable support-link component owns safe `mailto:` construction and request-click tracking. Existing provider and callback components wire these units into the connection flow, while Compose only forwards optional deployment configuration.

**Tech Stack:** React 19, Next.js, TypeScript, PostHog, Plausible, Vitest 3, Testing Library, Docker Compose.

## Global Constraints

- Use `pnpm` only and run lint/tests from the repository root.
- Follow test-driven development: every production behavior starts with a failing test that is observed before implementation.
- Do not add a database table, internal analytics dashboard, dependency, or new social provider.
- Never capture credentials, OAuth codes, tokens, response bodies, email contents, or stack traces in analytics.
- PostHog must remain optional and must never block connection or email navigation.
- Preserve the existing `channel_added` event.
- Public support email is exactly `fedrbodr@gmail.com`.
- Production X callback URL is exactly `https://app.vezdepost.ru/integrations/social/x`.

---

### Task 1: Deliver analytics without requiring Stripe

**Files:**
- Modify: `libraries/helpers/src/utils/use.fire.events.ts`
- Create: `libraries/helpers/src/utils/use.fire.events.spec.tsx`

**Interfaces:**
- Consumes: `usePostHog()` and `usePlausible()` from the existing providers.
- Produces: `useFireEvents(): (name: string, props?: Record<string, unknown>) => void`, with no billing dependency.

- [ ] **Step 1: Write the failing hook test**

Create a jsdom Vitest test that mocks `usePostHog`, `usePlausible`, and
`useUser`, renders `useFireEvents`, invokes it with
`channel_connect_clicked`, and asserts that both analytics clients receive the
event even though no Stripe/billing context is provided. Add a second test
asserting that an existing user is identified before capture.

```tsx
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFireEvents } from './use.fire.events';

const capture = vi.fn();
const identify = vi.fn();
const plausible = vi.fn();
let currentUser: any = null;

vi.mock('posthog-js/react', () => ({
  usePostHog: () => ({ capture, identify }),
}));
vi.mock('next-plausible', () => ({
  usePlausible: () => plausible,
}));
vi.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => currentUser,
}));

describe('useFireEvents', () => {
  beforeEach(() => {
    capture.mockReset();
    identify.mockReset();
    plausible.mockReset();
    currentUser = null;
  });

  it('captures an event without Stripe billing', () => {
    const { result } = renderHook(() => useFireEvents());
    act(() => result.current('channel_connect_clicked', { platform: 'x' }));
    expect(capture).toHaveBeenCalledWith('channel_connect_clicked', {
      platform: 'x',
    });
    expect(plausible).toHaveBeenCalledWith('channel_connect_clicked', {
      props: { platform: 'x' },
    });
  });

  it('identifies the signed-in user before capture', () => {
    currentUser = { id: 'user-1', email: 'a@example.com', name: 'A' };
    const { result } = renderHook(() => useFireEvents());
    act(() => result.current('channel_connect_clicked'));
    expect(identify).toHaveBeenCalledWith('user-1', {
      email: 'a@example.com',
      name: 'A',
    });
    expect(identify.mock.invocationCallOrder[0]).toBeLessThan(
      capture.mock.invocationCallOrder[0]
    );
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
rtk pnpm exec vitest run libraries/helpers/src/utils/use.fire.events.spec.tsx
```

Expected: FAIL because `useFireEvents` returns before capture when
`billingEnabled` is false.

- [ ] **Step 3: Remove only the billing gate**

Delete the `useVariables` import, `billingEnabled` read, and early return from
`use.fire.events.ts`. Type `props` as `Record<string, unknown>`. Keep user
identification, PostHog capture, and Plausible capture unchanged.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command. Expected: both tests PASS.

- [ ] **Step 5: Commit Task 1**

```bash
rtk git add libraries/helpers/src/utils/use.fire.events.ts libraries/helpers/src/utils/use.fire.events.spec.tsx
rtk git commit -m "fix: decouple product analytics from billing"
```

---

### Task 2: Add normalized funnel tracking and support mail links

**Files:**
- Create: `apps/frontend/src/components/launches/channel-connect.analytics.ts`
- Create: `apps/frontend/src/components/launches/channel-connect.analytics.spec.tsx`
- Create: `apps/frontend/src/components/launches/channel-support-link.tsx`
- Create: `apps/frontend/src/components/launches/channel-support-link.spec.tsx`

**Interfaces:**
- Produces: `ConnectionType`, `ConnectionStage`, `useChannelConnectAnalytics()`, and `ChannelSupportLink`.
- `useChannelConnectAnalytics()` returns `clicked`, `started`, `failed`, `completed`, and `requestClicked` callbacks.
- `ChannelSupportLink` accepts `{ platform?: string; source: 'channel_picker' | 'connection_error'; className?: string; children: ReactNode }`.

- [ ] **Step 1: Write failing analytics-hook tests**

Mock `useFireEvents`, render `useChannelConnectAnalytics`, and specify these
behaviors:

```tsx
it('normalizes provider click properties', () => {
  const { result } = renderHook(() => useChannelConnectAnalytics());
  act(() =>
    result.current.clicked({
      platform: 'x',
      connectionType: 'oauth',
      invite: false,
      onboarding: true,
      mobile: false,
    })
  );
  expect(fireEvents).toHaveBeenCalledWith('channel_connect_clicked', {
    platform: 'x',
    connection_type: 'oauth',
    invite: false,
    onboarding: true,
    mobile: false,
  });
});

it('captures a terminal event only once', () => {
  const { result } = renderHook(() => useChannelConnectAnalytics());
  act(() => {
    result.current.failed('x', 'callback', 'Authentication failed');
    result.current.failed('x', 'callback', 'Authentication failed');
    result.current.completed('x', false);
  });
  expect(fireEvents).toHaveBeenCalledTimes(1);
  expect(fireEvents).toHaveBeenCalledWith('channel_connect_failed', {
    platform: 'x',
    stage: 'callback',
    error: 'Authentication failed',
    onboarding: false,
    mobile: false,
  });
});
```

The hook must expose a separate `resetTerminal()` callback so a component can
start a fresh attempt without remounting.

- [ ] **Step 2: Write failing mail-link tests**

Use Testing Library to render the link with a mocked analytics hook. Assert:

```tsx
expect(link).toHaveAttribute(
  'href',
  'mailto:fedrbodr@gmail.com?subject=%D0%9D%D0%B5%20%D0%BF%D0%BE%D0%B4%D0%BA%D0%BB%D1%8E%D1%87%D0%B0%D0%B5%D1%82%D1%81%D1%8F%20X%20%D0%B2%20%D0%92%D0%B5%D0%B7%D0%B4%D0%B5%D0%BF%D0%BE%D1%81%D1%82%D0%B5'
);
fireEvent.click(link);
expect(requestClicked).toHaveBeenCalledWith('x', 'connection_error');
```

Also assert that an omitted platform produces the subject
`Нужна новая платформа в Вездепосте` and tracks platform `unspecified`.

- [ ] **Step 3: Run both tests and verify RED**

```bash
rtk pnpm exec vitest run apps/frontend/src/components/launches/channel-connect.analytics.spec.tsx apps/frontend/src/components/launches/channel-support-link.spec.tsx
```

Expected: FAIL because both modules are absent.

- [ ] **Step 4: Implement the minimal analytics hook**

Use a `useRef(false)` terminal guard. `failed` and `completed` consult and set
the guard; `clicked`, `started`, and `requestClicked` do not. Only accept the
enum-like unions from the approved spec. Default absent `onboarding` and
`mobile` values to `false`. Pass only the safe error string supplied by the
calling UI.

- [ ] **Step 5: Implement the support link**

Build the subject with `encodeURIComponent`, use the fixed support address,
and call `requestClicked` in `onClick` without preventing default navigation.
Use an ordinary accessible `<a>` and accept children so both picker and error
screens can supply translated copy. Normalize the `x` provider identifier to
the public display name `X` in the email subject; use the supplied identifier
for analytics.

- [ ] **Step 6: Run both tests and verify GREEN**

Run the Step 3 command. Expected: all tests PASS.

- [ ] **Step 7: Commit Task 2**

```bash
rtk git add apps/frontend/src/components/launches/channel-connect.analytics.ts apps/frontend/src/components/launches/channel-connect.analytics.spec.tsx apps/frontend/src/components/launches/channel-support-link.tsx apps/frontend/src/components/launches/channel-support-link.spec.tsx
rtk git commit -m "feat: add channel connection funnel helpers"
```

---

### Task 3: Instrument the provider picker and start failures

**Files:**
- Modify: `apps/frontend/src/components/launches/add.provider.component.tsx`
- Create: `apps/frontend/src/components/launches/add.provider.analytics.spec.tsx`

**Interfaces:**
- Consumes: `useChannelConnectAnalytics()` and `ChannelSupportLink` from Task 2.
- Produces: tracked provider tile clicks/starts and a support CTA in the picker/start-error modal.

- [ ] **Step 1: Write failing behavior tests**

Extract and export a small `getConnectionType` pure function from the component
module, then test the five precedence cases:

```tsx
expect(getConnectionType({ isWeb3: true })).toBe('web3');
expect(getConnectionType({ isChromeExtension: true })).toBe('browser_extension');
expect(getConnectionType({ isExternal: true })).toBe('external');
expect(getConnectionType({ customFields: [] })).toBe('custom_fields');
expect(getConnectionType({})).toBe('oauth');
```

Add a source contract test that reads `add.provider.component.tsx` and asserts
that the provider-card handler calls `analytics.clicked`, successful start
paths call `analytics.started`, and the start-failure path calls
`analytics.failed(identifier, 'start', safeMessage)` and renders
`<ChannelSupportLink platform={identifier} source="connection_error">`.
Assert that the picker footer renders `source="channel_picker"` with no
platform prop.

- [ ] **Step 2: Run the test and verify RED**

```bash
rtk pnpm exec vitest run apps/frontend/src/components/launches/add.provider.analytics.spec.tsx
```

Expected: FAIL because the helper, events, and support CTAs do not exist.

- [ ] **Step 3: Add provider click and start tracking**

Instantiate the Task 2 hook once in `AddProviderComponent`. At the beginning of
each tile handler, reset the terminal guard and capture `clicked` using the
provider identifier, derived connection type, invite/onboarding/mobile flags.
Capture `started` only after the backend returned a usable URL or the selected
local connection UI opened. Do not capture secrets or the URL.

- [ ] **Step 4: Replace the generic start toast with an actionable modal**

Check `response.ok`, `{ err: true }`, and a missing `url` before navigation.
Capture `failed(identifier, 'start', safeMessage)` and open a compact modal
that shows the translated safe error plus:

```tsx
<ChannelSupportLink platform={identifier} source="connection_error">
  {t('channel_connection_email_help', 'Напишите нам — поможем с настройкой.')}
</ChannelSupportLink>
```

Keep extension-specific setup warnings unchanged because those already tell the
user how to install or log in; still capture their start-stage failure.

- [ ] **Step 5: Add the picker footer CTA**

Below the provider grid render the translated Russian fallback:

```tsx
<p className="text-[13px] text-textColor/70 text-center">
  {t('missing_platform_prompt', 'Не нашли нужную платформу?')}{' '}
  <ChannelSupportLink source="channel_picker" className="underline">
    {t('missing_platform_email', 'Напишите нам — постараемся добавить.')}
  </ChannelSupportLink>
</p>
```

- [ ] **Step 6: Run the focused test and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 7: Commit Task 3**

```bash
rtk git add apps/frontend/src/components/launches/add.provider.component.tsx apps/frontend/src/components/launches/add.provider.analytics.spec.tsx
rtk git commit -m "feat: track channel connection attempts"
```

---

### Task 4: Track callback completion and make callback errors actionable

**Files:**
- Modify: `apps/frontend/src/components/launches/continue.integration.tsx`
- Create: `apps/frontend/src/components/launches/continue.integration.analytics.spec.tsx`

**Interfaces:**
- Consumes: `useChannelConnectAnalytics()` and `ChannelSupportLink` from Task 2.
- Produces: exactly one `channel_connect_completed` or `channel_connect_failed` terminal event per callback attempt.

- [ ] **Step 1: Write failing callback contract tests**

Create a focused source contract test that scopes the callback effect and
`onSave` blocks, then asserts:

- callback errors call `analytics.failed(provider, 'callback', safeMessage)`;
- callback success calls `analytics.completed(provider, onboarding)` before navigation;
- two-step save errors call `analytics.failed(provider, 'two_step_save', safeMessage)`;
- two-step success calls `analytics.completed(provider, twoStepState.onboarding)`;
- the error render contains `ChannelSupportLink`, `platform={provider}` and `source="connection_error"`;
- the error render no longer contains `<Redirect url="/launches" delay={3000} />` and contains an explicit `/launches` action.

- [ ] **Step 2: Run the test and verify RED**

```bash
rtk pnpm exec vitest run apps/frontend/src/components/launches/continue.integration.analytics.spec.tsx
```

Expected: FAIL on every new funnel/error-screen contract.

- [ ] **Step 3: Wire terminal callback events**

Instantiate `useChannelConnectAnalytics`. On callback and two-step errors,
derive one safe message from the already parsed `message`/`msg` fields, set the
UI state, then capture `failed`. On success, capture `completed` immediately
before `navigateOrShow`. The Task 2 ref guard prevents duplicate terminal
events.

- [ ] **Step 4: Add the callback support and return actions**

In the existing error state, preserve the provider-safe message, add:

```tsx
<ChannelSupportLink platform={provider} source="connection_error">
  {t('channel_connection_email_help', 'Напишите нам — поможем с настройкой.')}
</ChannelSupportLink>
```

Replace the timed redirect with an ordinary link/button to `/launches` using
existing button styling and the fallback `Вернуться к каналам`.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 6: Commit Task 4**

```bash
rtk git add apps/frontend/src/components/launches/continue.integration.tsx apps/frontend/src/components/launches/continue.integration.analytics.spec.tsx
rtk git commit -m "feat: track channel connection outcomes"
```

---

### Task 5: Forward X and PostHog production configuration

**Files:**
- Modify: `docker-compose.override.yaml`
- Modify: `.env.example`
- Modify: `deploy/README.md`
- Create: `deploy/production-config.spec.ts`

**Interfaces:**
- Consumes: server `.env` values `X_API_KEY`, `X_API_SECRET`, `NEXT_PUBLIC_POSTHOG_KEY`, and `NEXT_PUBLIC_POSTHOG_HOST`.
- Produces: the same variables in the `postiz` container; documents X OAuth 1.0a callback and permissions.

- [ ] **Step 1: Write the failing configuration contract test**

Read the three configuration/documentation files and assert:

```ts
expect(override).toContain("X_API_KEY: '${X_API_KEY:-}'");
expect(override).toContain("X_API_SECRET: '${X_API_SECRET:-}'");
expect(override).toContain(
  "NEXT_PUBLIC_POSTHOG_KEY: '${NEXT_PUBLIC_POSTHOG_KEY:-}'"
);
expect(override).toContain(
  "NEXT_PUBLIC_POSTHOG_HOST: '${NEXT_PUBLIC_POSTHOG_HOST:-}'"
);
expect(example).toContain('NEXT_PUBLIC_POSTHOG_KEY=""');
expect(example).toContain('NEXT_PUBLIC_POSTHOG_HOST="https://eu.i.posthog.com"');
expect(readme).toContain('https://app.vezdepost.ru/integrations/social/x');
expect(readme).toContain('OAuth 1.0a');
expect(readme).toContain('Read and write');
```

- [ ] **Step 2: Run the test and verify RED**

```bash
rtk pnpm exec vitest run deploy/production-config.spec.ts
```

Expected: FAIL because the production override and runbook lack the four
variables and X setup instructions.

- [ ] **Step 3: Add optional Compose environment forwarding**

Under `services.postiz.environment`, add the four exact optional
interpolations from Step 1. Extend the header comment to list those variable
names without values. Do not use required (`:?`) interpolation for X or
PostHog.

- [ ] **Step 4: Update the environment example and runbook**

Keep the existing empty X placeholders. Add the PostHog placeholders under a
new Product Analytics comment. In `deploy/README.md`, add an X section stating:

- create the app in X Developer Console;
- enable OAuth 1.0a with Read and write permission;
- set callback URL exactly to `https://app.vezdepost.ru/integrations/social/x`;
- put API Key in `X_API_KEY` and API Key Secret in `X_API_SECRET`;
- purchase credits and set a spending limit in the X console;
- never commit or paste the real values into chat/logs.

Add a PostHog section naming the two public frontend values and noting that
analytics remains disabled safely when either is absent.

- [ ] **Step 5: Run the contract test and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 6: Validate Compose without exposing secrets**

```bash
rtk env JWT_SECRET=x TELEGRAM_TOKEN=x MAX_TOKEN=x VK_ID=x docker compose config --quiet
```

Expected: exit code 0 both with X/PostHog absent and, in a second run, with
dummy values supplied via:

```bash
rtk env JWT_SECRET=x TELEGRAM_TOKEN=x MAX_TOKEN=x VK_ID=x X_API_KEY=x X_API_SECRET=x NEXT_PUBLIC_POSTHOG_KEY=x NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com docker compose config --quiet
```

- [ ] **Step 7: Commit Task 5**

```bash
rtk git add docker-compose.override.yaml .env.example deploy/README.md deploy/production-config.spec.ts
rtk git commit -m "feat: configure X and PostHog for production"
```

---

### Task 6: Full verification and review

**Files:**
- Verify only; fix only files already in scope if a check exposes a defect.

**Interfaces:**
- Consumes: all deliverables from Tasks 1–5.
- Produces: evidence that the feature is test-clean, type-safe, and Compose-valid.

- [ ] **Step 1: Run all focused tests together**

```bash
rtk pnpm exec vitest run libraries/helpers/src/utils/use.fire.events.spec.tsx apps/frontend/src/components/launches/channel-connect.analytics.spec.tsx apps/frontend/src/components/launches/channel-support-link.spec.tsx apps/frontend/src/components/launches/add.provider.analytics.spec.tsx apps/frontend/src/components/launches/continue.integration.analytics.spec.tsx deploy/production-config.spec.ts
```

Expected: all test files PASS with no unhandled errors.

- [ ] **Step 2: Run repository lint**

```bash
rtk pnpm run lint
```

Expected: exit code 0. If the repository exposes pre-existing unrelated
warnings, record them separately and ensure no new warning points to changed
files.

- [ ] **Step 3: Run the frontend build**

```bash
rtk pnpm build:frontend
```

Expected: exit code 0.

- [ ] **Step 4: Verify Compose quietly in both optional-config states**

Run both Task 5 Step 6 commands. Expected: exit code 0 with no rendered
configuration or secrets printed.

- [ ] **Step 5: Inspect the final diff and request code review**

```bash
rtk git status --short
rtk git diff --check
rtk git log --oneline --decorate -8
```

Use `superpowers:requesting-code-review`, address any findings, and rerun the
relevant focused/full checks before claiming completion.
