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
