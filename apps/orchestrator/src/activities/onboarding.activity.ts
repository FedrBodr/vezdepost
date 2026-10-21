import { Injectable, Logger } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { OnboardingService } from '@gitroom/nestjs-libraries/database/prisma/onboarding/onboarding.service';
import { isOnboardingFinished } from '@gitroom/nestjs-libraries/onboarding/onboarding.state';
import {
  onboardingMessage,
  OnboardingStep,
} from '@gitroom/nestjs-libraries/onboarding/onboarding.emails';
import { onboardingUnsubscribeUrl } from '@gitroom/nestjs-libraries/onboarding/onboarding.token';
import { sendAssistantText } from '@gitroom/nestjs-libraries/onboarding/onboarding.bot';

export type OnboardingDelivery = Array<'email' | 'telegram' | 'max'>;

@Injectable()
@Activity()
export class OnboardingActivity {
  private readonly _logger = new Logger(OnboardingActivity.name);

  constructor(
    private _onboardingService: OnboardingService,
    private _emailService: EmailService
  ) {}

  @ActivityMethod()
  async getOnboardingState(userId: string) {
    return this._onboardingService.getOnboardingState(userId);
  }

  @ActivityMethod()
  async sendOnboardingStep(
    userId: string,
    step: OnboardingStep
  ): Promise<OnboardingDelivery> {
    const state = await this._onboardingService.getOnboardingState(userId);
    if (isOnboardingFinished(state)) {
      return [];
    }

    const message = onboardingMessage(step, {
      unsubscribeUrl: onboardingUnsubscribeUrl(userId),
    });
    const delivered: OnboardingDelivery = [];

    if (this._emailService.hasProvider()) {
      try {
        await this._emailService.sendEmailSync(
          state!.email,
          message.subject,
          message.html,
          process.env.EMAIL_REPLY_TO || undefined
        );
        delivered.push('email');
      } catch (error) {
        this._logger.error(
          `Failed to email onboarding step=${step} userId=${userId}`,
          error
        );
      }
    }

    for (const link of state!.assistantLinks) {
      try {
        const sent = await sendAssistantText(
          link.transport,
          link.telegramUserId,
          message.botText
        );
        if (sent) {
          delivered.push(sent);
        }
      } catch (error) {
        this._logger.error(
          `Failed to send onboarding step=${step} via ${link.transport} userId=${userId}`,
          error
        );
      }
    }

    return delivered;
  }
}
