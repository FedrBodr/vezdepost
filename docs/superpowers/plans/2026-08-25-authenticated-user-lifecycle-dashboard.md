# Authenticated User Lifecycle Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit a safe PostHog event whenever a known user opens the protected Vezdepost application, deploy it, and build a PostHog dashboard that separates new and returning authenticated users.

**Architecture:** A null-rendering client component reads the existing authenticated `UserContext`, identifies the PostHog person, and captures `authenticated_app_opened` once per mounted user. `LayoutComponent` mounts it inside `ContextWrapper`; PostHog Lifecycle and Trends insights consume the event after production deployment.

**Tech Stack:** React, TypeScript, PostHog JS, Vitest, Testing Library, Next.js, PostHog EU Cloud.

## Global Constraints

- Count protected-application opens by authenticated users, not login-form submissions or anonymous pageviews.
- Use internal user ID for PostHog identity and only the already-established email and name person properties.
- Never attach secrets, tokens, full URLs, or additional personal data to `authenticated_app_opened`.
- Analytics failures must not block rendering, authentication, navigation, or product behavior.
- Capture once per authenticated layout mount; duplicate opens do not inflate dashboard counts because insights aggregate Unique users.
- Preserve existing PostHog reset behavior on logout and authentication loss.
- Do not change the backend, database, environment configuration, Telegram, application email delivery, or the existing demand dashboard and alert.
- The lifecycle metric is valid only from the production deployment onward; do not imply historical backfill.

---

### Task 1: Authenticated application-open tracker

**Files:**
- Create: `apps/frontend/src/components/layout/authenticated.app.opened.tsx`
- Create: `apps/frontend/src/components/layout/authenticated.app.opened.spec.tsx`
- Modify: `apps/frontend/src/components/new-layout/layout.component.tsx`

**Interfaces:**
- Consumes: `useUser(): User | undefined` and `usePostHog()` from existing providers.
- Produces: `AuthenticatedAppOpened: FC`, which renders `null` and captures the constant event name `authenticated_app_opened`.

- [ ] **Step 1: Write the failing component tests**

Create `authenticated.app.opened.spec.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticatedAppOpened } from './authenticated.app.opened';

const mocked = vi.hoisted(() => ({
  capture: vi.fn(),
  identify: vi.fn(),
  user: undefined as
    | { id: string; email: string; name: string | null }
    | undefined,
}));

vi.mock('posthog-js/react', () => ({
  usePostHog: () => ({ capture: mocked.capture, identify: mocked.identify }),
}));
vi.mock('@gitroom/frontend/components/layout/user.context', () => ({
  useUser: () => mocked.user,
}));

describe('AuthenticatedAppOpened', () => {
  beforeEach(() => {
    mocked.capture.mockReset();
    mocked.identify.mockReset();
    mocked.user = undefined;
  });

  it('does not capture without an authenticated user', () => {
    render(<AuthenticatedAppOpened />);
    expect(mocked.identify).not.toHaveBeenCalled();
    expect(mocked.capture).not.toHaveBeenCalled();
  });

  it('identifies the user before capturing the authenticated app open', () => {
    mocked.user = { id: 'user-1', email: 'a@example.com', name: 'A' };
    render(<AuthenticatedAppOpened />);
    expect(mocked.identify).toHaveBeenCalledWith('user-1', {
      email: 'a@example.com',
      name: 'A',
    });
    expect(mocked.capture).toHaveBeenCalledWith('authenticated_app_opened');
    expect(mocked.identify.mock.invocationCallOrder[0]).toBeLessThan(
      mocked.capture.mock.invocationCallOrder[0]
    );
  });

  it('captures only once for the same user during one mount', () => {
    mocked.user = { id: 'user-1', email: 'a@example.com', name: 'A' };
    const view = render(<AuthenticatedAppOpened />);
    mocked.user = { id: 'user-1', email: 'a@example.com', name: 'Renamed' };
    view.rerender(<AuthenticatedAppOpened />);
    expect(mocked.capture).toHaveBeenCalledTimes(1);
  });

  it('does not let an analytics exception escape', () => {
    mocked.user = { id: 'user-1', email: 'a@example.com', name: 'A' };
    mocked.identify.mockImplementation(() => {
      throw new Error('analytics unavailable');
    });
    expect(() => render(<AuthenticatedAppOpened />)).not.toThrow();
    expect(mocked.capture).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
rtk pnpm exec vitest run apps/frontend/src/components/layout/authenticated.app.opened.spec.tsx
```

Expected: FAIL because `./authenticated.app.opened` does not exist.

- [ ] **Step 3: Implement the minimal tracker**

Create `authenticated.app.opened.tsx`:

```tsx
'use client';

import { useEffect, useRef } from 'react';
import { usePostHog } from 'posthog-js/react';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

export const AuthenticatedAppOpened = () => {
  const user = useUser();
  const posthog = usePostHog();
  const capturedUserId = useRef<string>();

  useEffect(() => {
    if (!user?.id || capturedUserId.current === user.id) {
      return;
    }
    capturedUserId.current = user.id;
    try {
      posthog.identify(user.id, { email: user.email, name: user.name });
      posthog.capture('authenticated_app_opened');
    } catch {
      // Analytics must never interrupt the authenticated application.
    }
  }, [posthog, user?.email, user?.id, user?.name]);

  return null;
};
```

Import the component in `layout.component.tsx` and mount it as the first child of `ContextWrapper`:

```tsx
import { AuthenticatedAppOpened } from '@gitroom/frontend/components/layout/authenticated.app.opened';

return (
  <ContextWrapper user={user}>
    <AuthenticatedAppOpened />
    <CopilotKit
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
rtk pnpm exec vitest run \
  apps/frontend/src/components/layout/authenticated.app.opened.spec.tsx \
  apps/frontend/src/components/layout/posthog.identity.integration.spec.ts \
  libraries/helpers/src/utils/use.fire.events.spec.tsx
```

Expected: all focused tests PASS with no uncaught analytics error.

- [ ] **Step 5: Verify the frontend build and diff**

Run:

```bash
rtk pnpm build:frontend
rtk git diff --check
```

Expected: frontend build succeeds and `git diff --check` prints no errors.

- [ ] **Step 6: Commit the tracker**

```bash
rtk git add \
  apps/frontend/src/components/layout/authenticated.app.opened.tsx \
  apps/frontend/src/components/layout/authenticated.app.opened.spec.tsx \
  apps/frontend/src/components/new-layout/layout.component.tsx
rtk git commit -m "feat: track authenticated app opens"
```

### Task 2: Production rollout

**Files:**
- Verify only: `deploy/README.md`

**Interfaces:**
- Consumes: the tested commit containing `authenticated_app_opened`.
- Produces: the tracker commit reachable from `main` and `prod`, with the exact
  deployed `prod` revision recorded separately because `prod` contains
  deployment-only configuration.

- [ ] **Step 1: Recheck repository state and revision**

Run:

```bash
rtk git status --short
rtk git log -3 --oneline
```

Expected: clean worktree and the tracker commit at HEAD.

- [ ] **Step 2: Fast-forward the tested change through deployment branches**

Use non-interactive Git operations to merge the task branch into `main`, then
merge `main` into `prod` while preserving its deployment-only configuration and
push both branches. Preserve unrelated work and stop if either merge is not a
clean fast-forward or ordinary non-conflicting merge.

Expected: `origin/main` and `origin/prod` contain the tracker commit; record the
exact 40-character `prod` head SHA.

- [ ] **Step 3: Wait for and verify autodeploy**

Use the documented `vezdepost` SSH host and inspect `/var/log/vezdepost-autodeploy.log` without printing environment values. Verify the server checkout SHA, container readiness, and the public Vezdepost application.

Expected: production checkout matches the recorded SHA, readiness is healthy, and the public application responds successfully.

- [ ] **Step 4: Generate the first production event**

Open the protected application using the existing authenticated browser session. Do not expose session cookies or tokens.

Expected: one `authenticated_app_opened` event appears in PostHog for the known user and contains no event properties added by this feature.

### Task 3: PostHog lifecycle dashboard

**Files:**
- No repository files.

**Interfaces:**
- Consumes: production event `authenticated_app_opened` associated with an identified person.
- Produces: one dashboard and two saved PostHog insights.

- [ ] **Step 1: Create the dashboard**

In project `232935`, create `Authenticated users — new and returning`. Do not copy filters or alerts from `Unavailable channel demand`.

- [ ] **Step 2: Create the Lifecycle insight**

Create and save `Authenticated users — lifecycle` with event `authenticated_app_opened`, interval `Day`, date range `Last 30 days`, and the native New, Returning, Resurrecting, and Dormant lifecycle categories. Add it to the new dashboard.

Expected: the insight uses identified unique users and shows lifecycle categories without anonymous `$pageview` data.

- [ ] **Step 3: Create the activity baseline**

Create and save `Authenticated users — daily unique users` as a Trends insight for `authenticated_app_opened`, aggregation `Unique users`, interval `Day`, and date range `Last 30 days`. Add it to the same dashboard.

Expected: the dashboard contains exactly the lifecycle view and daily unique-user baseline created by this task.

- [ ] **Step 4: Verify saved configuration and report links**

Reopen the dashboard and each insight from their saved URLs. Verify the event, interval, date range, aggregation, dashboard membership, and absence of alerts. Report the dashboard URL, both insight URLs, production SHA, and the metric-valid-from deployment date.
