// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChannelConnectAnalytics } from './channel-connect.analytics';

const fireEvents = vi.fn();

vi.mock('@gitroom/helpers/utils/use.fire.events', () => ({
  useFireEvents: () => fireEvents,
}));

describe('useChannelConnectAnalytics', () => {
  beforeEach(() => {
    fireEvents.mockReset();
  });

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

  it('normalizes provider start properties and defaults context flags', () => {
    const { result } = renderHook(() => useChannelConnectAnalytics());
    act(() =>
      result.current.started({
        platform: 'linkedin',
        connectionType: 'external',
        invite: true,
      })
    );
    expect(fireEvents).toHaveBeenCalledWith('channel_connect_started', {
      platform: 'linkedin',
      connection_type: 'external',
      invite: true,
      onboarding: false,
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

  it('allows a new terminal event after reset', () => {
    const { result } = renderHook(() => useChannelConnectAnalytics());
    act(() => {
      result.current.completed('x', true);
      result.current.resetTerminal();
      result.current.failed('x', 'two_step_save', 'Could not save', true, true);
    });
    expect(fireEvents).toHaveBeenNthCalledWith(1, 'channel_connect_completed', {
      platform: 'x',
      onboarding: true,
    });
    expect(fireEvents).toHaveBeenNthCalledWith(2, 'channel_connect_failed', {
      platform: 'x',
      stage: 'two_step_save',
      error: 'Could not save',
      onboarding: true,
      mobile: true,
    });
  });

  it('tracks support requests without consuming the terminal guard', () => {
    const { result } = renderHook(() => useChannelConnectAnalytics());
    act(() => {
      result.current.requestClicked('x', 'connection_error');
      result.current.completed('x');
    });
    expect(fireEvents).toHaveBeenNthCalledWith(1, 'platform_request_clicked', {
      platform: 'x',
      source: 'connection_error',
    });
    expect(fireEvents).toHaveBeenNthCalledWith(2, 'channel_connect_completed', {
      platform: 'x',
      onboarding: false,
    });
  });
});
