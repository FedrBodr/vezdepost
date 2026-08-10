import { Injectable, Logger } from '@nestjs/common';
import { TypedSearchAttributes } from '@temporalio/common';
import { TemporalService } from 'nestjs-temporal-core';
import { UsersService } from '../database/prisma/users/users.service';
import { organizationId as organizationIdSearchAttribute } from './temporal.search.attribute';

@Injectable()
export class PersonalStreakReminderStarter {
  private readonly _logger = new Logger(PersonalStreakReminderStarter.name);

  constructor(
    private _temporalService: TemporalService,
    private _usersService: UsersService
  ) {}

  startForUser(organizationId: string, userId: string) {
    return this._temporalService.client
      .getRawClient()
      .workflow.start('personalStreakReminderWorkflow', {
        args: [{ organizationId, userId }],
        workflowId: `streak_${organizationId}_${userId}`,
        taskQueue: 'main',
        workflowIdConflictPolicy: 'TERMINATE_EXISTING',
        typedSearchAttributes: new TypedSearchAttributes([
          {
            key: organizationIdSearchAttribute,
            value: organizationId,
          },
        ]),
      });
  }

  async startForOrganization(organizationId: string) {
    const users = await this._usersService.getEnabledOrganizationUsers(
      organizationId
    );
    await this.startAll(
      users.map(({ id: userId }) => ({ organizationId, userId }))
    );
  }

  async startForUserOrganizations(userId: string) {
    const organizations =
      await this._usersService.getEnabledReminderOrganizations(userId);
    await this.startAll(
      organizations.map(({ organizationId }) => ({ organizationId, userId }))
    );
  }

  private async startAll(
    targets: Array<{ organizationId: string; userId: string }>
  ) {
    const results = await Promise.allSettled(
      targets.map(({ organizationId, userId }) => {
        try {
          return Promise.resolve(this.startForUser(organizationId, userId));
        } catch (error) {
          return Promise.reject(error);
        }
      })
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const { organizationId, userId } = targets[index];
        this._logger.error(
          `Failed to start streak reminder organizationId=${organizationId} userId=${userId}`
        );
      }
    });
  }
}
