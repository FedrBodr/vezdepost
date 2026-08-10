import { afterEach, describe, expect, it, vi } from 'vitest';
import { UsersController } from '@gitroom/backend/api/routes/users.controller';
import { StreakService } from './streak.service';

describe('StreakService.getPersonalStreak', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves the authenticated user IANA zone and active organization', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T09:00:00.000Z'));
    const repository = {
      getDistinctPublicationDates: vi
        .fn()
        .mockResolvedValue(['2026-07-29', '2026-07-28']),
    };
    const service = new StreakService(repository as any);

    await expect(
      service.getPersonalStreak(
        { timezoneName: 'Europe/Moscow', timezone: 0 },
        'org-1'
      )
    ).resolves.toMatchObject({
      days: 2,
      timezone: 'Europe/Moscow',
    });
    expect(repository.getDistinctPublicationDates).toHaveBeenCalledWith(
      'org-1',
      {
        kind: 'iana',
        name: 'Europe/Moscow',
        label: 'Europe/Moscow',
      }
    );
  });

  it('falls back to the authenticated user legacy minute offset', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T19:00:00.000Z'));
    const repository = {
      getDistinctPublicationDates: vi.fn().mockResolvedValue(['2026-07-29']),
    };
    const service = new StreakService(repository as any);

    await expect(
      service.getPersonalStreak(
        { timezoneName: null, timezone: 330 },
        'org-offset'
      )
    ).resolves.toMatchObject({
      days: 1,
      timezone: 'UTC+05:30',
    });
    expect(repository.getDistinctPublicationDates).toHaveBeenCalledWith(
      'org-offset',
      {
        kind: 'offset',
        minutes: 330,
        label: 'UTC+05:30',
      }
    );
  });
});

describe('UsersController.getStreak', () => {
  it('passes the authenticated user and organization to the streak service', async () => {
    const result = {
      days: 1,
      timezone: 'UTC',
      lastPublishedLocalDate: '2026-07-29',
      nextChangeAt: '2026-07-31T00:00:00.000Z',
    };
    const streakService = {
      getPersonalStreak: vi.fn().mockResolvedValue(result),
    };
    const controller = new UsersController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      streakService as any
    );
    const user = { id: 'user-1', timezoneName: 'UTC', timezone: 0 };
    const organization = { id: 'org-1' };

    await expect(
      controller.getStreak(user as any, organization as any)
    ).resolves.toBe(result);
    expect(streakService.getPersonalStreak).toHaveBeenCalledWith(user, 'org-1');
  });
});
