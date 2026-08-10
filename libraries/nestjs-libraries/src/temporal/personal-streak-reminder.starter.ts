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
    for (const user of users) {
      try {
        await this.startForUser(organizationId, user.id);
      } catch {
        this._logger.error(
          `Failed to start streak reminder organizationId=${organizationId} userId=${user.id}`
        );
      }
    }
  }
}
