// @vitest-environment jsdom

import { act, render, renderHook, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreakComponent } from './streak.component';
import { usePersonalStreak, useUserTimezoneSync } from './use.personal.streak';

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
    const indicator = screen.getByLabelText(
      "You're on a 3 day posting streak! Keep it going!"
    );
    expect(indicator.getAttribute('data-tooltip-content')).toBe(
      "You're on a 3 day posting streak! Keep it going!"
    );
    expect(indicator.getAttribute('tabindex')).toBe('0');
    expect(indicator.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
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

  it('throws non-successful streak responses for SWR retry handling', async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn(),
    });
    mocks.useSWR.mockReturnValue({ data: undefined, mutate: vi.fn() });

    renderHook(() => usePersonalStreak());
    const loadStreak = mocks.useSWR.mock.calls[0][1];

    await expect(loadStreak('/user/streak')).rejects.toThrow(
      'Could not load personal streak (503)'
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
        nextChangeAt: new Date(
          Date.now() + maximumTimeout + 1_000
        ).toISOString(),
      }),
      mutate,
    });

    renderHook(() => usePersonalStreak());

    act(() => vi.advanceTimersByTime(maximumTimeout));
    expect(mutate).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1_000));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('cancels the previous boundary when nextChangeAt changes', () => {
    const mutate = vi.fn();
    let data = streak({ nextChangeAt: '2026-08-10T21:00:00.000Z' });
    mocks.useSWR.mockImplementation(() => ({ data, mutate }));
    const { rerender } = renderHook(() => usePersonalStreak());

    data = streak({ nextChangeAt: '2026-08-10T21:00:01.000Z' });
    rerender();
    act(() => vi.advanceTimersByTime(1_000));
    expect(mutate).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1_000));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('cancels boundary revalidation on unmount', () => {
    const mutate = vi.fn();
    mocks.useSWR.mockReturnValue({
      data: streak({ nextChangeAt: '2026-08-10T21:00:00.000Z' }),
      mutate,
    });
    const { unmount } = renderHook(() => usePersonalStreak());

    unmount();
    act(() => vi.advanceTimersByTime(1_000));

    expect(mutate).not.toHaveBeenCalled();
  });
});

describe('useUserTimezoneSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.fetch.mockReset();
    mocks.getTimezone.mockReset();
    mocks.mutateCache.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('updates a changed browser zone once and revalidates user and streak', async () => {
    const mutateUser = vi.fn().mockResolvedValue(undefined);
    mocks.getTimezone.mockReturnValue('Europe/Moscow');
    mocks.fetch.mockResolvedValue({ ok: true });

    const { rerender } = renderHook(
      ({ timezoneName }) => useUserTimezoneSync(timezoneName, mutateUser),
      { initialProps: { timezoneName: 'UTC' as string | null } }
    );

    await act(async () => Promise.resolve());
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    rerender({ timezoneName: 'UTC' });

    await act(async () => Promise.resolve());
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/user/timezone',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ timezoneName: 'Europe/Moscow' }),
      })
    );
    expect(mutateUser).toHaveBeenCalledTimes(1);
    expect(mocks.mutateCache).toHaveBeenCalledWith('/user/streak');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries a transient update failure without another render', async () => {
    const mutateUser = vi.fn().mockResolvedValue(undefined);
    mocks.getTimezone.mockReturnValue('Europe/Moscow');
    mocks.fetch
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: true });

    renderHook(() => useUserTimezoneSync('UTC', mutateUser));
    await act(async () => Promise.resolve());
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mutateUser).toHaveBeenCalledTimes(1);
    expect(mocks.mutateCache).toHaveBeenCalledWith('/user/streak');
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

  it('does not update when stored and browser zones are equivalent aliases', async () => {
    mocks.getTimezone.mockReturnValue('US/Eastern');

    renderHook(() => useUserTimezoneSync('America/New_York', vi.fn()));
    await act(async () => Promise.resolve());

    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('sends the canonical browser zone and does not repeat after revalidation', async () => {
    const mutateUser = vi.fn().mockResolvedValue(undefined);
    mocks.getTimezone.mockReturnValue('US/Eastern');
    mocks.fetch.mockResolvedValue({ ok: true });

    const { rerender } = renderHook(
      ({ timezoneName }) => useUserTimezoneSync(timezoneName, mutateUser),
      { initialProps: { timezoneName: 'UTC' as string | null } }
    );
    await act(async () => Promise.resolve());

    expect(mocks.fetch.mock.calls[0][1].body).toBe(
      JSON.stringify({ timezoneName: 'America/New_York' })
    );

    rerender({ timezoneName: 'America/New_York' });
    await act(async () => Promise.resolve());
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['+05:30', '-05:30'])(
    'does not send raw offset identifiers: %s',
    async (browserTimezone) => {
      mocks.getTimezone.mockReturnValue(browserTimezone);

      renderHook(() => useUserTimezoneSync('UTC', vi.fn()));
      await act(async () => Promise.resolve());

      expect(mocks.fetch).not.toHaveBeenCalled();
    }
  );

  it('aborts an older zone request and only applies the latest result', async () => {
    let resolveFirstRequest: (response: { ok: boolean }) => void = () => {};
    const firstRequest = new Promise<{ ok: boolean }>((resolve) => {
      resolveFirstRequest = resolve;
    });
    const mutateUser = vi.fn().mockResolvedValue(undefined);
    mocks.getTimezone.mockReturnValue('Europe/Moscow');
    mocks.fetch
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce({ ok: true });

    const { rerender } = renderHook(() =>
      useUserTimezoneSync('UTC', mutateUser)
    );
    await act(async () => Promise.resolve());
    const firstSignal = mocks.fetch.mock.calls[0][1].signal as AbortSignal;

    mocks.getTimezone.mockReturnValue('America/New_York');
    rerender();
    await act(async () => Promise.resolve());

    expect(firstSignal.aborted).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[1][1].body).toBe(
      JSON.stringify({ timezoneName: 'America/New_York' })
    );

    resolveFirstRequest({ ok: true });
    await act(async () => Promise.resolve());
    expect(mutateUser).toHaveBeenCalledTimes(1);
    expect(mocks.mutateCache).toHaveBeenCalledTimes(1);
  });

  it('clears a pending timezone retry on unmount', async () => {
    mocks.getTimezone.mockReturnValue('Europe/Moscow');
    mocks.fetch.mockRejectedValue(new Error('network down'));
    const { unmount } = renderHook(() => useUserTimezoneSync('UTC', vi.fn()));
    await act(async () => Promise.resolve());

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('clears an older retry when the browser zone changes', async () => {
    mocks.getTimezone.mockReturnValue('Europe/Moscow');
    mocks.fetch
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: true });
    const { rerender } = renderHook(() =>
      useUserTimezoneSync('UTC', vi.fn().mockResolvedValue(undefined))
    );
    await act(async () => Promise.resolve());

    mocks.getTimezone.mockReturnValue('America/New_York');
    rerender();
    await act(async () => Promise.resolve());
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-retryable client response', async () => {
    mocks.getTimezone.mockReturnValue('Europe/Moscow');
    mocks.fetch.mockResolvedValue({ ok: false, status: 400 });

    renderHook(() => useUserTimezoneSync('UTC', vi.fn()));
    await act(async () => Promise.resolve());
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('stops retrying after the configured attempt limit', async () => {
    mocks.getTimezone.mockReturnValue('Europe/Moscow');
    mocks.fetch.mockRejectedValue(new Error('network down'));

    renderHook(() => useUserTimezoneSync('UTC', vi.fn()));
    await act(async () => Promise.resolve());
    for (const delay of [1_000, 2_000, 4_000, 8_000]) {
      await act(async () => {
        vi.advanceTimersByTime(delay);
        await Promise.resolve();
      });
    }
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(5);
  });
});
