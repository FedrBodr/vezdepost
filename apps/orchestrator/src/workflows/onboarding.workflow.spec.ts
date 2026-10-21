import { beforeEach, describe, expect, it, vi } from 'vitest';

const stateActivities = vi.hoisted(() => ({ getOnboardingState: vi.fn() }));
const sendActivities = vi.hoisted(() => ({ sendOnboardingStep: vi.fn() }));
const proxyOptions = vi.hoisted(() => [] as Array<Record<string, any>>);
const sleep = vi.hoisted(() => vi.fn());

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
        : stateActivities;
    }),
    sleep,
  };
});

import { onboardingWorkflow } from './onboarding.workflow';
import type { OnboardingState } from '@gitroom/nestjs-libraries/onboarding/onboarding.state';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SIGNUP = Date.parse('2026-10-21T10:00:00.000Z');

const baseState: OnboardingState = {
  email: 'person@example.test',
  activated: true,
  disabled: false,
  deleted: false,
  sendOnboardingEmails: true,
  organizationId: 'org-1',
  channelCount: 0,
  postCount: 0,
  firstChannelAt: null,
  assistantLinks: [],
};

/** State as a function of the elapsed time since sign-up. */
function stateOverTime(build: (elapsed: number) => Partial<OnboardingState>) {
  stateActivities.getOnboardingState.mockImplementation(async () => ({
    ...baseState,
    ...build(Date.now() - SIGNUP),
  }));
}

const sentSteps = () =>
  sendActivities.sendOnboardingStep.mock.calls.map(([, step]) => step);

describe('onboardingWorkflow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(SIGNUP));
    stateActivities.getOnboardingState.mockReset();
    sendActivities.sendOnboardingStep.mockReset();
    sleep.mockReset();
    sleep.mockImplementation(async (milliseconds: number) => {
      vi.setSystemTime(new Date(Date.now() + milliseconds));
    });
    sendActivities.sendOnboardingStep.mockResolvedValue(['email']);
    stateOverTime(() => ({}));
  });

  it('sends the welcome after 10 minutes and both reminders without channels', async () => {
    await onboardingWorkflow({ userId: 'user-1' });

    expect(sleep).toHaveBeenNthCalledWith(1, 10 * 60 * 1000);
    expect(sentSteps()).toEqual([
      'welcome',
      'no_channel_day1',
      'no_channel_day3',
    ]);
    expect(sendActivities.sendOnboardingStep).toHaveBeenCalledWith(
      'user-1',
      'welcome'
    );
    // keeps looking for a first channel no longer than two weeks
    expect(Date.now() - SIGNUP).toBeLessThanOrEqual(14 * DAY);
  });

  it('skips the no-channel reminders and sends first_post a day after the channel', async () => {
    const channelAt = new Date(SIGNUP + 2 * HOUR).toISOString();
    stateOverTime((elapsed) =>
      elapsed >= 2 * HOUR ? { channelCount: 1, firstChannelAt: channelAt } : {}
    );

    await onboardingWorkflow({ userId: 'user-1' });

    expect(sentSteps()).toEqual(['welcome', 'first_post']);
    expect(Date.now()).toBe(SIGNUP + 2 * HOUR + DAY);
  });

  it('sends day1, then first_post once a channel appears later', async () => {
    const channelAt = new Date(SIGNUP + 5 * DAY + 3 * HOUR).toISOString();
    stateOverTime((elapsed) =>
      elapsed >= 5 * DAY + 3 * HOUR
        ? { channelCount: 1, firstChannelAt: channelAt }
        : {}
    );

    await onboardingWorkflow({ userId: 'user-1' });

    expect(sentSteps()).toEqual([
      'welcome',
      'no_channel_day1',
      'no_channel_day3',
      'first_post',
    ]);
    expect(Date.now()).toBeGreaterThanOrEqual(Date.parse(channelAt) + DAY);
  });

  it('stops as soon as the organization has a post', async () => {
    stateOverTime((elapsed) => (elapsed >= DAY ? { postCount: 1 } : {}));

    await onboardingWorkflow({ userId: 'user-1' });

    expect(sentSteps()).toEqual(['welcome']);
  });

  it.each([
    ['unsubscribed', { sendOnboardingEmails: false }],
    ['disabled', { disabled: true }],
    ['deleted', { deleted: true }],
  ])('stops when the user is %s', async (_, change) => {
    stateOverTime((elapsed) => (elapsed >= DAY ? change : {}));

    await onboardingWorkflow({ userId: 'user-1' });

    expect(sentSteps()).toEqual(['welcome']);
  });

  it('sends nothing when the user is gone before the welcome', async () => {
    stateActivities.getOnboardingState.mockResolvedValue(null);

    await onboardingWorkflow({ userId: 'user-1' });

    expect(sendActivities.sendOnboardingStep).not.toHaveBeenCalled();
  });

  it('does not end the chain when a send fails', async () => {
    sendActivities.sendOnboardingStep
      .mockRejectedValueOnce(new Error('SMTP down'))
      .mockResolvedValue(['email']);

    await onboardingWorkflow({ userId: 'user-1' });

    expect(sentSteps()).toEqual([
      'welcome',
      'no_channel_day1',
      'no_channel_day3',
    ]);
  });

  it('configures the send activity for at most one attempt', () => {
    expect(proxyOptions).toContainEqual(
      expect.objectContaining({ retry: { maximumAttempts: 1 } })
    );
  });
});
