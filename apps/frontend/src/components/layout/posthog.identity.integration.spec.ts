// @vitest-environment jsdom
import { act, fireEvent, render } from '@testing-library/react';
import React, { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LayoutContext from './layout.context';
import { LogoutComponent } from './logout.component';

const mocked = vi.hoisted(() => ({
  reset: vi.fn(),
  deleteDialog: vi.fn(),
  fetch: vi.fn(),
  afterRequest: undefined as
    | ((
        url: string,
        options: RequestInit,
        response: Response
      ) => Promise<boolean>)
    | undefined,
  variables: {
    backendUrl: 'http://localhost:3000',
    isGeneral: true,
    isSecured: false,
  },
}));

vi.mock('posthog-js/react', () => ({
  usePostHog: () => ({ reset: mocked.reset }),
}));
vi.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: mocked.deleteDialog,
}));
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  FetchWrapperComponent: (props: any) => {
    mocked.afterRequest = props.afterRequest;
    return props.children;
  },
  useFetch: () => mocked.fetch,
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

const response = (status: number, headers?: Record<string, string>) =>
  ({ status, headers: new Headers(headers) }) as Response;

describe('PostHog identity lifecycle wiring', () => {
  beforeEach(() => {
    vi.stubGlobal('React', React);
    mocked.reset.mockReset();
    mocked.deleteDialog.mockResolvedValue(true);
    mocked.fetch.mockReset();
    mocked.afterRequest = undefined;
    mocked.variables = {
      backendUrl: 'http://localhost:3000',
      isGeneral: true,
      isSecured: false,
    };
  });

  afterEach(() => vi.unstubAllGlobals());

  it('resets before explicit logout navigation', async () => {
    const order: string[] = [];
    mocked.reset.mockImplementation(() => order.push('reset'));
    const { getByText } = render(createElement(LogoutComponent));
    vi.stubGlobal('window', navigationWindow(order));

    await act(async () => {
      fireEvent.click(getByText(/Logout from/));
      await Promise.resolve();
    });

    expect(order).toEqual(['reset', 'redirect']);
  });

  it('resets before 401 auth-loss navigation', async () => {
    const order: string[] = [];
    mocked.reset.mockImplementation(() => order.push('reset'));
    render(createElement(LayoutContext, undefined, 'content'));
    vi.stubGlobal('window', navigationWindow(order));

    await mocked.afterRequest?.('/api', {}, response(401));

    expect(order).toEqual(['reset', 'redirect']);
  });

  it('resets before realtime disconnect auth-loss navigation', async () => {
    const order: string[] = [];
    mocked.reset.mockImplementation(() => order.push('reset'));
    render(createElement(LayoutContext, undefined, 'content'));
    vi.stubGlobal('window', navigationWindow(order));

    await mocked.afterRequest?.('/api', {}, response(200, { logout: '1' }));

    expect(order).toEqual(['reset', 'redirect']);
  });
});
