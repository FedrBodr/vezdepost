import { describe, expect, it, vi } from 'vitest';
import { EmailActivity } from './email.activity';

function createActivity() {
  const emailService = { sendEmail: vi.fn().mockResolvedValue(undefined) };
  const usersService = {
    getStreakReminderUser: vi.fn().mockResolvedValue({
      id: 'user-1',
      email: 'person@example.test',
      activated: true,
      sendStreakEmails: true,
      disabled: false,
      timezone: 0,
      timezoneName: 'UTC',
    }),
  };
  const streakService = {
    getStreakReminderSchedule: vi.fn().mockResolvedValue({
      enabled: true,
      active: true,
      targetLocalDate: '2026-07-30',
      reminderAt: '2026-07-30T22:00:00.000Z',
      midnightAt: '2026-07-31T00:00:00.000Z',
    }),
    hasPublishedOnLocalDate: vi.fn().mockResolvedValue(false),
  };
  const activity = new EmailActivity(
    emailService as any,
    {} as any,
    usersService as any,
    streakService as any
  );

  return { activity, emailService, usersService, streakService };
}

describe('EmailActivity personal streak reminders', () => {
  it('reloads current state and sends the existing reminder copy', async () => {
    const { activity, emailService, usersService, streakService } =
      createActivity();

    await expect(
      activity.sendStreakReminder('org-1', 'user-1', '2026-07-30')
    ).resolves.toBe(true);

    expect(streakService.getStreakReminderSchedule).toHaveBeenCalledWith(
      'org-1',
      'user-1'
    );
    expect(streakService.hasPublishedOnLocalDate).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      '2026-07-30'
    );
    expect(usersService.getStreakReminderUser).toHaveBeenCalledWith(
      'org-1',
      'user-1'
    );
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      'person@example.test',
      'Streak Reminder',
      '<p>You are about to lose your streak in two hours! schedule a post now to keep it!</p>',
      'bottom',
      undefined
    );
  });

  it('rechecks confirmed publication state immediately before sending', async () => {
    const { activity, emailService, streakService } = createActivity();
    streakService.hasPublishedOnLocalDate.mockResolvedValue(true);

    await expect(
      activity.sendStreakReminder('org-1', 'user-1', '2026-07-30')
    ).resolves.toBe(false);

    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });
});
