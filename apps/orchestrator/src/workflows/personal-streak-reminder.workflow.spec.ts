import { beforeEach, describe, expect, it, vi } from 'vitest';

const activities = vi.hoisted(() => ({
  getStreakReminderContext: vi.fn(),
  hasPublishedOnLocalDate: vi.fn(),
  sendStreakReminder: vi.fn(),
}));

const sleep = vi.hoisted(() => vi.fn());

vi.mock('@temporalio/workflow', async (importOriginal) => {
  const temporal = await importOriginal<
    typeof import('@temporalio/workflow')
  >();

  return {
    ...temporal,
    proxyActivities: vi.fn(() => activities),
    sleep,
  };
});

import { personalStreakReminderWorkflow } from './personal-streak-reminder.workflow';

const moscowContext = {
  enabled: true,
  hasActiveStreak: true,
  timezone: {
    kind: 'iana' as const,
    name: 'Europe/Moscow',
    label: 'Europe/Moscow',
  },
};

describe('personalStreakReminderWorkflow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T10:00:00.000Z'));
    activities.getStreakReminderContext.mockReset();
    activities.hasPublishedOnLocalDate.mockReset();
    activities.sendStreakReminder.mockReset();
    sleep.mockReset();
    sleep.mockImplementation(async (milliseconds: number) => {
      vi.setSystemTime(new Date(Date.now() + milliseconds));
    });
    activities.getStreakReminderContext.mockResolvedValue(moscowContext);
    activities.hasPublishedOnLocalDate.mockResolvedValue(false);
    activities.sendStreakReminder.mockResolvedValue(true);
  });

  it('targets 22:00 on the next local day after a confirmed post', async () => {
    await personalStreakReminderWorkflow({
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(sleep).toHaveBeenNthCalledWith(1, 118_800_000);
    expect(activities.hasPublishedOnLocalDate).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      '2026-07-30'
    );
  });

  it('sends one reminder when the streak is active and the local day is empty', async () => {
    await personalStreakReminderWorkflow({
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(activities.sendStreakReminder).toHaveBeenCalledTimes(1);
    expect(activities.sendStreakReminder).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      '2026-07-30'
    );
  });

  it('sends nothing when the user disabled streak emails', async () => {
    activities.getStreakReminderContext.mockResolvedValue({
      ...moscowContext,
      enabled: false,
    });

    await personalStreakReminderWorkflow({
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(activities.sendStreakReminder).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('sends nothing when the user already published on that local day', async () => {
    activities.hasPublishedOnLocalDate.mockResolvedValue(true);

    await personalStreakReminderWorkflow({
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(activities.sendStreakReminder).not.toHaveBeenCalled();
  });

  it('uses an updated timezone when a replacement workflow starts', async () => {
    activities.getStreakReminderContext.mockResolvedValue({
      ...moscowContext,
      timezone: {
        kind: 'iana',
        name: 'America/New_York',
        label: 'America/New_York',
      },
    });

    await personalStreakReminderWorkflow({
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(sleep).toHaveBeenNthCalledWith(1, 144_000_000);
  });

  it('exits after the local day ends without a publication', async () => {
    await personalStreakReminderWorkflow({
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(2, 7_200_000);
    expect(activities.hasPublishedOnLocalDate).toHaveBeenCalledTimes(2);
  });

  it('handles a legacy fixed-offset timezone with fractional hours', async () => {
    activities.getStreakReminderContext.mockResolvedValue({
      ...moscowContext,
      timezone: {
        kind: 'offset',
        minutes: 330,
        label: 'UTC+05:30',
      },
    });

    await personalStreakReminderWorkflow({
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(sleep).toHaveBeenNthCalledWith(1, 109_800_000);
  });

  it('targets local 22:00 across an IANA daylight-saving transition', async () => {
    vi.setSystemTime(new Date('2026-03-07T15:00:00.000Z'));
    activities.getStreakReminderContext.mockResolvedValue({
      ...moscowContext,
      timezone: {
        kind: 'iana',
        name: 'America/New_York',
        label: 'America/New_York',
      },
    });

    await personalStreakReminderWorkflow({
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(sleep).toHaveBeenNthCalledWith(1, 126_000_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 7_200_000);
  });
});
