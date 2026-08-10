// @vitest-environment jsdom

import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreakComponent } from './streak.component';
import {
  usePersonalStreak,
  useUserTimezoneSync,
} from './use.personal.streak';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getTimezone: vi.fn(),
  mutateCache: vi.fn(),
  useSWR: vi.fn(),
}));

vi.mock('swr', () => ({
  default: mocks.useSWR,
  useSWRConfig: () => ({ mutate: mocks.mutateCache }),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mocks.fetch,
}));

vi.mock('@gitroom/frontend/components/layout/set.timezone', () => ({
  getTimezone: mocks.getTimezone,
}));

const streak = (overrides: Record<string, unknown> = {}) => ({
  days: 3,
  timezone: 'Europe/Moscow',
  lastPublishedLocalDate: '2026-08-10',
  nextChangeAt: '2026-08-10T21:00:00.000Z',
  ...overrides,
});

describe('StreakComponent', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.useSWR.mockReset();
    mocks.useSWR.mockReturnValue({ data: streak(), mutate: vi.fn() });
  });

  it('renders the API day count and its tooltip', () => {
    render(<StreakComponent />);

    expect(screen.getByText('3')).toBeTruthy();
    expect(
      screen.getByText('3').parentElement?.getAttribute('data-tooltip-content')
    ).toBe("You're on a 3 day posting streak! Keep it going!");
  });

  it('renders nothing when the streak is zero', () => {
    mocks.useSWR.mockReturnValue({
      data: streak({ days: 0, lastPublishedLocalDate: null }),
      mutate: vi.fn(),
    });

    const { container } = render(<StreakComponent />);

    expect(container.innerHTML).toBe('');
  });
});

describe('usePersonalStreak', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T20:59:59.000Z'));
    mocks.useSWR.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enables focus, reconnect, and five-minute interval revalidation', () => {
    mocks.useSWR.mockReturnValue({ data: undefined, mutate: vi.fn() });

    renderHook(() => usePersonalStreak());

    expect(mocks.useSWR).toHaveBeenCalledWith(
      '/user/streak',
      expect.any(Function),
      expect.objectContaining({
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
        refreshInterval: 300_000,
      })
    );
  });

  it('revalidates exactly when nextChangeAt is reached', () => {
    const mutate = vi.fn();
    mocks.useSWR.mockReturnValue({
      data: streak({ nextChangeAt: '2026-08-10T21:00:00.000Z' }),
      mutate,
    });

    renderHook(() => usePersonalStreak());

    act(() => vi.advanceTimersByTime(999));
    expect(mutate).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('reschedules boundaries beyond the browser maximum timeout', () => {
    const mutate = vi.fn();
    const maximumTimeout = 2_147_483_647;
    mocks.useSWR.mockReturnValue({
      data: streak({
        nextChangeAt: new Date(Date.now() + maximumTimeout + 1_000).toISOString(),
      }),
      mutate,
    });

    renderHook(() => usePersonalStreak());

    act(() => vi.advanceTimersByTime(maximumTimeout));
    expect(mutate).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1_000));
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});

describe('useUserTimezoneSync', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.fetch.mockReset();
    mocks.getTimezone.mockReset();
    mocks.mutateCache.mockReset();
  });

  it('updates a changed browser zone once and revalidates user and streak', async () => {
    const mutateUser = vi.fn().mockResolvedValue(undefined);
    mocks.getTimezone.mockReturnValue('Europe/Moscow');
    mocks.fetch.mockResolvedValue({ ok: true });

    const { rerender } = renderHook(
      ({ timezoneName }) => useUserTimezoneSync(timezoneName, mutateUser),
      { initialProps: { timezoneName: 'UTC' as string | null } }
    );

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    rerender({ timezoneName: 'UTC' });

    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledWith('/user/timezone', {
        method: 'PUT',
        body: JSON.stringify({ timezoneName: 'Europe/Moscow' }),
      });
      expect(mutateUser).toHaveBeenCalledTimes(1);
      expect(mocks.mutateCache).toHaveBeenCalledWith('/user/streak');
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not update when the stored and browser zones match', async () => {
    const mutateUser = vi.fn();
    mocks.getTimezone.mockReturnValue('Europe/Moscow');

    renderHook(() => useUserTimezoneSync('Europe/Moscow', mutateUser));

    await act(async () => Promise.resolve());
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mutateUser).not.toHaveBeenCalled();
    expect(mocks.mutateCache).not.toHaveBeenCalled();
  });
});
