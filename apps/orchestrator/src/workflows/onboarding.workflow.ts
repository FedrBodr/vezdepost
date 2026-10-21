import { proxyActivities, sleep } from '@temporalio/workflow';
import type { OnboardingActivity } from '@gitroom/orchestrator/activities/onboarding.activity';
import type { OnboardingStep } from '@gitroom/nestjs-libraries/onboarding/onboarding.emails';
import { isOnboardingFinished } from '@gitroom/nestjs-libraries/onboarding/onboarding.state';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const WELCOME_DELAY = 10 * MINUTE;
const NO_CHANNEL_DAY1 = DAY;
const NO_CHANNEL_DAY3 = 3 * DAY;
const FIRST_POST_AFTER_CHANNEL = DAY;
const CHAIN_LENGTH = 14 * DAY;

const { getOnboardingState } = proxyActivities<OnboardingActivity>({
  startToCloseTimeout: '10 minute',
  taskQueue: 'main',
  cancellationType: 'ABANDON',
});

const { sendOnboardingStep } = proxyActivities<OnboardingActivity>({
  startToCloseTimeout: '10 minute',
  taskQueue: 'main',
  cancellationType: 'ABANDON',
  retry: { maximumAttempts: 1 },
});

/** A failed step is skipped, it never ends the chain. */
async function send(userId: string, step: OnboardingStep) {
  try {
    await sendOnboardingStep(userId, step);
  } catch {
    // the next step re-reads the state and carries on
  }
}

/**
 * Onboarding emails for one new user, see
 * docs/superpowers/specs/2026-10-21-onboarding-activation-design.md.
 * Each wake-up re-reads the state; the chain stops as soon as the
 * organization has a post or the user opted out or lost access.
 */
export async function onboardingWorkflow({
  userId,
}: {
  userId: string;
}): Promise<void> {
  const startedAt = Date.now();
  const deadline = startedAt + CHAIN_LENGTH;

  await sleep(WELCOME_DELAY);
  let state = await getOnboardingState(userId);
  if (isOnboardingFinished(state)) {
    return;
  }
  await send(userId, 'welcome');

  let day1Done = false;
  let day3Done = false;

  while (true) {
    const now = Date.now();
    const wakeAt: number[] = [];

    if (state!.channelCount === 0) {
      if (!day3Done && now >= startedAt + NO_CHANNEL_DAY3) {
        // day 1 is stale once day 3 is due
        day1Done = day3Done = true;
        await send(userId, 'no_channel_day3');
      } else if (!day1Done && now >= startedAt + NO_CHANNEL_DAY1) {
        day1Done = true;
        await send(userId, 'no_channel_day1');
      }

      if (!day1Done) {
        wakeAt.push(startedAt + NO_CHANNEL_DAY1);
      } else if (!day3Done) {
        wakeAt.push(startedAt + NO_CHANNEL_DAY3);
      } else {
        // look for the first channel once a day
        wakeAt.push(now + DAY);
      }
    } else {
      const firstPostAt =
        (state!.firstChannelAt
          ? Date.parse(state!.firstChannelAt)
          : startedAt) + FIRST_POST_AFTER_CHANNEL;
      if (now >= firstPostAt) {
        await send(userId, 'first_post');
        return;
      }
      wakeAt.push(firstPostAt);
    }

    const next = Math.min(...wakeAt);
    if (next > deadline) {
      return;
    }
    await sleep(Math.max(0, next - Date.now()));

    state = await getOnboardingState(userId);
    if (isOnboardingFinished(state)) {
      return;
    }
  }
}
