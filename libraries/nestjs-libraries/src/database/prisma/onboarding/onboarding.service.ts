import { Injectable } from '@nestjs/common';
import { OnboardingRepository } from '@gitroom/nestjs-libraries/database/prisma/onboarding/onboarding.repository';
import { verifyOnboardingUnsubscribeToken } from '@gitroom/nestjs-libraries/onboarding/onboarding.token';
import { OnboardingState } from '@gitroom/nestjs-libraries/onboarding/onboarding.state';

@Injectable()
export class OnboardingService {
  constructor(private _onboardingRepository: OnboardingRepository) {}

  /** Null when the user no longer exists. */
  async getOnboardingState(userId: string): Promise<OnboardingState | null> {
    const user = await this._onboardingRepository.getUser(userId);
    if (!user) {
      return null;
    }

    const membership = user.organizations[0];
    const organizationId = membership?.organizationId ?? null;
    const [channelCount, firstChannel, postCount, assistantLinks] =
      organizationId
        ? await Promise.all([
            this._onboardingRepository.countChannels(organizationId),
            this._onboardingRepository.getFirstChannel(organizationId),
            this._onboardingRepository.countPosts(organizationId),
            this._onboardingRepository.getAssistantLinks(userId),
          ])
        : [0, null, 0, []];

    return {
      email: user.email,
      activated: user.activated,
      // a user without a live organization has nothing to onboard into
      disabled: !membership || membership.disabled,
      deleted: !!user.deletedAt,
      sendOnboardingEmails: user.sendOnboardingEmails,
      organizationId,
      channelCount,
      postCount,
      firstChannelAt: firstChannel?.createdAt.toISOString() ?? null,
      assistantLinks,
    };
  }

  async unsubscribeOnboarding(userId: string) {
    await this._onboardingRepository.unsubscribe(userId);
  }

  /** False for an invalid or foreign token. */
  async unsubscribeByToken(token?: string) {
    const userId = verifyOnboardingUnsubscribeToken(token);
    if (!userId) {
      return false;
    }
    await this.unsubscribeOnboarding(userId);
    return true;
  }
}
