import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserCalendarZone } from '../users/user-timezone';
import { calculatePersonalStreak } from './streak.calculator';

const moscow: UserCalendarZone = {
  kind: 'iana',
  name: 'Europe/Moscow',
  label: 'Europe/Moscow',
};

describe('calculatePersonalStreak', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts consecutive local dates through today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T09:00:00.000Z'));

    expect(
      calculatePersonalStreak(
        ['2026-07-29', '2026-07-28', '2026-07-27'],
        new Date(),
        moscow
      )
    ).toEqual({
      days: 3,
      timezone: 'Europe/Moscow',
      lastPublishedLocalDate: '2026-07-29',
      nextChangeAt: '2026-07-30T21:00:00.000Z',
    });
  });

  it('keeps a streak ending yesterday active until the end of today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T09:00:00.000Z'));

    expect(
      calculatePersonalStreak(['2026-07-28', '2026-07-27'], new Date(), moscow)
    ).toEqual({
      days: 2,
      timezone: 'Europe/Moscow',
      lastPublishedLocalDate: '2026-07-28',
      nextChangeAt: '2026-07-29T21:00:00.000Z',
    });
  });

  it('returns zero when the latest local date is older than yesterday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T09:00:00.000Z'));

    expect(calculatePersonalStreak(['2026-07-27'], new Date(), moscow)).toEqual(
      {
        days: 0,
        timezone: 'Europe/Moscow',
        lastPublishedLocalDate: '2026-07-27',
        nextChangeAt: null,
      }
    );
  });

  it('normalizes unsorted duplicate dates and stops at the first gap', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T09:00:00.000Z'));

    expect(
      calculatePersonalStreak(
        ['2026-07-28', '2026-07-29', '2026-07-26', '2026-07-29'],
        new Date(),
        moscow
      ).days
    ).toBe(2);
  });

  it('uses each user zone on opposite sides of UTC midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T00:30:00.000Z'));

    const tokyo = calculatePersonalStreak(['2026-07-29'], new Date(), {
      kind: 'iana',
      name: 'Asia/Tokyo',
      label: 'Asia/Tokyo',
    });
    const losAngeles = calculatePersonalStreak(['2026-07-28'], new Date(), {
      kind: 'iana',
      name: 'America/Los_Angeles',
      label: 'America/Los_Angeles',
    });

    expect(tokyo).toMatchObject({
      days: 1,
      lastPublishedLocalDate: '2026-07-29',
      nextChangeAt: '2026-07-30T15:00:00.000Z',
    });
    expect(losAngeles).toMatchObject({
      days: 1,
      lastPublishedLocalDate: '2026-07-28',
      nextChangeAt: '2026-07-30T07:00:00.000Z',
    });
  });

  it('computes the next local midnight across a DST transition', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-08T16:00:00.000Z'));

    expect(
      calculatePersonalStreak(['2026-03-07', '2026-03-06'], new Date(), {
        kind: 'iana',
        name: 'America/New_York',
        label: 'America/New_York',
      })
    ).toEqual({
      days: 2,
      timezone: 'America/New_York',
      lastPublishedLocalDate: '2026-03-07',
      nextChangeAt: '2026-03-09T04:00:00.000Z',
    });
  });

  it('uses the first actual instant of a local date when midnight is skipped', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T16:00:00.000Z'));

    expect(
      calculatePersonalStreak(['2026-09-04'], new Date(), {
        kind: 'iana',
        name: 'America/Santiago',
        label: 'America/Santiago',
      })
    ).toEqual({
      days: 1,
      timezone: 'America/Santiago',
      lastPublishedLocalDate: '2026-09-04',
      nextChangeAt: '2026-09-06T04:00:00.000Z',
    });
  });

  it('supports a legacy fractional fixed offset', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T19:00:00.000Z'));

    expect(
      calculatePersonalStreak(['2026-07-29'], new Date(), {
        kind: 'offset',
        minutes: 330,
        label: 'UTC+05:30',
      })
    ).toEqual({
      days: 1,
      timezone: 'UTC+05:30',
      lastPublishedLocalDate: '2026-07-29',
      nextChangeAt: '2026-07-30T18:30:00.000Z',
    });
  });
});
