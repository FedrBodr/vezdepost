import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const scheduleActivities = vi.hoisted(() => ({
  getStreakReminderSchedule: vi.fn(),
  hasPublishedOnLocalDate: vi.fn(),
}));
const sendActivities = vi.hoisted(() => ({ sendStreakReminder: vi.fn() }));
const proxyOptions = vi.hoisted(() => [] as Array<Record<string, any>>);
const sleep = vi.hoisted(() => vi.fn());
const continueAsNew = vi.hoisted(() => vi.fn());

vi.mock('@temporalio/workflow', async (importOriginal) => {
  const temporal = await importOriginal<
    typeof import('@temporalio/workflow')
  >();

  return {
    ...temporal,
    proxyActivities: vi.fn((options: Record<string, any>) => {
      proxyOptions.push(options);
      return options.retry?.maximumAttempts === 1
        ? sendActivities
        : scheduleActivities;
    }),
    sleep,
    continueAsNew,
  };
});

import { personalStreakReminderWorkflow } from './personal-streak-reminder.workflow';

const activeSchedule = {
  enabled: true,
  active: true,
  targetLocalDate: '2026-07-30',
  reminderAt: '2026-07-30T19:00:00.000Z',
  midnightAt: '2026-07-30T21:00:00.000Z',
};

describe('personalStreakReminderWorkflow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T10:00:00.000Z'));
    scheduleActivities.getStreakReminderSchedule.mockReset();
    scheduleActivities.hasPublishedOnLocalDate.mockReset();
    sendActivities.sendStreakReminder.mockReset();
    sleep.mockReset();
    continueAsNew.mockReset();
    sleep.mockImplementation(async (milliseconds: number) => {
      vi.setSystemTime(new Date(Date.now() + milliseconds));
    });
    scheduleActivities.getStreakReminderSchedule.mockResolvedValue(
      activeSchedule
    );
    scheduleActivities.hasPublishedOnLocalDate.mockResolvedValue(false);
    sendActivities.sendStreakReminder.mockResolvedValue(true);
  });

  it('uses the fully serialized activity schedule without workflow ICU calculations', async () => {
    await personalStreakReminderWorkflow({
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(sleep).toHaveBeenNthCalledWith(1, 118_800_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 7_200_000);
    expect(scheduleActivities.hasPublishedOnLocalDate).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      '2026-07-30'
    );

    const source = readFileSync(
      new URL('./personal-streak-reminder.workflow.ts', import.meta.url),
      'utf8'
    );
    expect(source).not.toContain('Intl');
    expect(source).not.toContain('streak.calculator');
    expect(source).not.toContain('getUtcAtLocalTime');
  });

  it('sends one reminder while the active target day is still empty', async () => {
    await personalStreakReminderWorkflow({
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(sendActivities.sendStreakReminder).toHaveBeenCalledTimes(1);
    expect(sendActivities.sendStreakReminder).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      '2026-07-30'
    );
  });

  it('exits at midnight when the target local day remained empty', async () => {
    scheduleActivities.hasPublishedOnLocalDate.mockResolvedValue(false);

    await personalStreakReminderWorkflow({
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(scheduleActivities.hasPublishedOnLocalDate).toHaveBeenCalledTimes(2);
    expect(continueAsNew).not.toHaveBeenCalled();
  });

  it('continues as new when a confirmed post exists but replacement startup failed', async () => {
    scheduleActivities.hasPublishedOnLocalDate
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await personalStreakReminderWorkflow({
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(continueAsNew).toHaveBeenCalledWith({
      organizationId: 'org-1',
      userId: 'user-1',
    });
  });

  it('does nothing when the freshly loaded schedule is disabled or inactive', async () => {
    scheduleActivities.getStreakReminderSchedule.mockResolvedValue({
      enabled: false,
      active: false,
      targetLocalDate: null,
      reminderAt: null,
      midnightAt: null,
    });

    await personalStreakReminderWorkflow({
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(sleep).not.toHaveBeenCalled();
    expect(sendActivities.sendStreakReminder).not.toHaveBeenCalled();
  });

  it('does not send when a post already exists on the target day', async () => {
    scheduleActivities.hasPublishedOnLocalDate.mockResolvedValue(true);

    await personalStreakReminderWorkflow({
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(sendActivities.sendStreakReminder).not.toHaveBeenCalled();
  });

  it('configures the email send activity for at most one attempt', () => {
    expect(proxyOptions).toContainEqual(
      expect.objectContaining({ retry: { maximumAttempts: 1 } })
    );
  });
});
