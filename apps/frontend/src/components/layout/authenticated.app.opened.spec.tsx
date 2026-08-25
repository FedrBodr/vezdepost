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
