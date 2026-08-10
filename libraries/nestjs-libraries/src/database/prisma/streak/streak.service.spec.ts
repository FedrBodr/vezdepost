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
    const service = new StreakService(repository as any, {} as any);

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
    const service = new StreakService(repository as any, {} as any);

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

describe('StreakService reminder checks', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives the target day from publishedAt even when startup crosses midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T21:00:00.100Z'));
    const repository = {
      getLatestConfirmedPublication: vi
        .fn()
        .mockResolvedValue(new Date('2026-07-29T20:59:59.900Z')),
    };
    const usersService = {
      getStreakReminderUser: vi.fn().mockResolvedValue({
        id: 'user-1',
        email: 'person@example.test',
        activated: true,
        disabled: false,
        sendStreakEmails: true,
        timezone: 0,
        timezoneName: 'Europe/Moscow',
      }),
    };
    const service = new StreakService(repository as any, usersService as any);

    await expect(
      service.getStreakReminderSchedule('org-1', 'user-1')
    ).resolves.toEqual({
      enabled: true,
      active: true,
      targetLocalDate: '2026-07-30',
      reminderAt: '2026-07-30T19:00:00.000Z',
      midnightAt: '2026-07-30T21:00:00.000Z',
    });
    expect(usersService.getStreakReminderUser).toHaveBeenCalledWith(
      'org-1',
      'user-1'
    );
    expect(repository.getLatestConfirmedPublication).toHaveBeenCalledWith(
      'org-1'
    );
    expect(repository.getDistinctPublicationDates).toBeUndefined();
  });

  it('serializes IANA DST reminder and midnight instants in the activity', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-07T15:00:00.000Z'));
    const repository = {
      getLatestConfirmedPublication: vi
        .fn()
        .mockResolvedValue(new Date('2026-03-07T15:00:00.000Z')),
    };
    const usersService = {
      getStreakReminderUser: vi.fn().mockResolvedValue({
        activated: true,
        disabled: false,
        sendStreakEmails: true,
        timezone: 0,
        timezoneName: 'America/New_York',
      }),
    };
    const service = new StreakService(repository as any, usersService as any);

    await expect(
      service.getStreakReminderSchedule('org-1', 'user-1')
    ).resolves.toMatchObject({
      targetLocalDate: '2026-03-08',
      reminderAt: '2026-03-09T02:00:00.000Z',
      midnightAt: '2026-03-09T04:00:00.000Z',
    });
  });

  it('serializes a legacy fractional fixed-offset schedule', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T10:00:00.000Z'));
    const repository = {
      getLatestConfirmedPublication: vi
        .fn()
        .mockResolvedValue(new Date('2026-07-29T10:00:00.000Z')),
    };
    const usersService = {
      getStreakReminderUser: vi.fn().mockResolvedValue({
        activated: true,
        disabled: false,
        sendStreakEmails: true,
        timezone: 330,
        timezoneName: null,
      }),
    };
    const service = new StreakService(repository as any, usersService as any);

    await expect(
      service.getStreakReminderSchedule('org-1', 'user-1')
    ).resolves.toMatchObject({
      targetLocalDate: '2026-07-30',
      reminderAt: '2026-07-30T16:30:00.000Z',
      midnightAt: '2026-07-30T18:30:00.000Z',
    });
  });

  it('uses the freshly loaded user zone for the local-date publication check', async () => {
    const repository = {
      hasPublishedOnLocalDate: vi.fn().mockResolvedValue(true),
    };
    const usersService = {
      getStreakReminderUser: vi.fn().mockResolvedValue({
        activated: true,
        disabled: false,
        sendStreakEmails: true,
        timezone: 330,
        timezoneName: null,
      }),
    };
    const service = new StreakService(repository as any, usersService as any);

    await expect(
      service.hasPublishedOnLocalDate('org-1', 'user-1', '2026-07-29')
    ).resolves.toBe(true);
    expect(repository.hasPublishedOnLocalDate).toHaveBeenCalledWith(
      'org-1',
      '2026-07-29',
      { kind: 'offset', minutes: 330, label: 'UTC+05:30' }
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
      streakService as any,
      {} as any
    );
    const user = { id: 'user-1', timezoneName: 'UTC', timezone: 0 };
    const organization = { id: 'org-1' };

    await expect(
      controller.getStreak(user as any, organization as any)
    ).resolves.toBe(result);
    expect(streakService.getPersonalStreak).toHaveBeenCalledWith(user, 'org-1');
  });
});
