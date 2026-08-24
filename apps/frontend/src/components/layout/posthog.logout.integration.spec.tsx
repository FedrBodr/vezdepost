// @vitest-environment jsdom
import { act, fireEvent, render } from '@testing-library/react';
import React, { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LayoutContext from './layout.context';
import { LogoutComponent } from './logout.component';

const mocked = vi.hoisted(() => ({
  reset: vi.fn(),
  deleteDialog: vi.fn(),
  variables: {
    backendUrl: 'http://localhost:3000',
    isGeneral: true,
    isSecured: true,
  },
}));

vi.mock('posthog-js/react', () => ({
  usePostHog: () => ({ reset: mocked.reset }),
}));
vi.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: mocked.deleteDialog,
}));
vi.mock('@gitroom/frontend/app/(app)/auth/return.url.component', () => ({
  useReturnUrl: () => ({ getAndClear: vi.fn() }),
}));
vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => mocked.variables,
}));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const navigationWindow = (order: string[]) => {
  let href = 'http://localhost/dashboard';

  return {
    location: {
      get href() {
        return href;
      },
      set href(value: string) {
        href = value;
        order.push('redirect');
      },
      get pathname() {
        return '/dashboard';
      },
    },
  };
};

describe('explicit logout PostHog lifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal('React', React);
    mocked.reset.mockReset();
    mocked.deleteDialog.mockResolvedValue(true);
    mocked.variables = {
      backendUrl: 'http://localhost:3000',
      isGeneral: true,
      isSecured: true,
    };
  });

  afterEach(() => vi.unstubAllGlobals());

  it('resets once before redirect when the wrapped logout response has a logout header', async () => {
    const order: string[] = [];
    const fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 204, headers: { logout: '1' } })
    );
    mocked.reset.mockImplementation(() => order.push('reset'));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('window', navigationWindow(order));

    const { getByText } = render(
      createElement(
        LayoutContext,
        undefined,
        createElement(LogoutComponent)
      )
    );

    await act(async () => {
      fireEvent.click(getByText(/Logout from/));
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/user/logout',
      expect.objectContaining({ method: 'POST' })
    );
    expect(order).toEqual(['reset', 'redirect']);
  });
});
