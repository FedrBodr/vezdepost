import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendAssistantText = vi.hoisted(() => vi.fn());
vi.mock('@gitroom/nestjs-libraries/onboarding/onboarding.bot', () => ({
  sendAssistantText,
}));

import { OnboardingActivity } from './onboarding.activity';
import type { OnboardingState } from '@gitroom/nestjs-libraries/onboarding/onboarding.state';

const state: OnboardingState = {
  email: 'person@example.test',
  activated: true,
  disabled: false,
  deleted: false,
  sendOnboardingEmails: true,
  organizationId: 'org-1',
  channelCount: 0,
  postCount: 0,
  firstChannelAt: null,
  assistantLinks: [{ transport: 'telegram', telegramUserId: '42' }],
};

function createActivity(current: any = state) {
  const onboardingService = {
    getOnboardingState: vi.fn().mockResolvedValue(current),
  };
  const emailService = {
    hasProvider: vi.fn().mockReturnValue(true),
    sendEmailSync: vi.fn().mockResolvedValue(undefined),
  };
  const activity = new OnboardingActivity(
    onboardingService as any,
    emailService as any
  );
  return { activity, onboardingService, emailService };
}

describe('OnboardingActivity', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
    process.env.EMAIL_REPLY_TO = 'author@example.test';
    sendAssistantText.mockReset();
    sendAssistantText.mockResolvedValue('telegram');
  });

  it('emails the step with the reply-to address and mirrors it to the bot', async () => {
    const { activity, emailService } = createActivity();

    await expect(
      activity.sendOnboardingStep('user-1', 'welcome')
    ).resolves.toEqual(['email', 'telegram']);

    expect(emailService.sendEmailSync).toHaveBeenCalledWith(
      'person@example.test',
      'Привет! Я Дмитрий, автор Vezdepost',
      expect.stringContaining('/public/onboarding/unsubscribe?token='),
      'author@example.test'
    );
    expect(sendAssistantText).toHaveBeenCalledWith(
      'telegram',
      '42',
      expect.not.stringContaining('unsubscribe')
    );
  });

  it('re-checks the state and sends nothing once the user has posted', async () => {
    const { activity, emailService } = createActivity({
      ...state,
      postCount: 1,
    });

    await expect(
      activity.sendOnboardingStep('user-1', 'first_post')
    ).resolves.toEqual([]);
    expect(emailService.sendEmailSync).not.toHaveBeenCalled();
    expect(sendAssistantText).not.toHaveBeenCalled();
  });

  it('keeps the email delivery when the bot send fails', async () => {
    sendAssistantText.mockRejectedValue(new Error('blocked by user'));
    const { activity } = createActivity();
    (activity as any)._logger.error = vi.fn();

    await expect(
      activity.sendOnboardingStep('user-1', 'no_channel_day1')
    ).resolves.toEqual(['email']);
  });
});
