import { Injectable, Logger } from '@nestjs/common';
import { TypedSearchAttributes } from '@temporalio/common';
import { TemporalService } from 'nestjs-temporal-core';
import { organizationId as organizationIdSearchAttribute } from './temporal.search.attribute';

/** Starts the onboarding email chain for a freshly created user. */
@Injectable()
export class OnboardingStarter {
  private readonly _logger = new Logger(OnboardingStarter.name);

  constructor(private _temporalService: TemporalService) {}

  /** Never throws: a sign-up must not fail because Temporal is unavailable. */
  async startForNewUser(organizationId: string, userId: string) {
    try {
      await this._temporalService.client
        .getRawClient()
        .workflow.start('onboardingWorkflow', {
          args: [{ userId }],
          workflowId: `onboarding_${userId}`,
          taskQueue: 'main',
          workflowIdConflictPolicy: 'USE_EXISTING',
          typedSearchAttributes: new TypedSearchAttributes([
            {
              key: organizationIdSearchAttribute,
              value: organizationId,
            },
          ]),
        });
    } catch (error) {
      this._logger.error(
        `Failed to start onboarding organizationId=${organizationId} userId=${userId}`,
        error
      );
    }
  }
}
