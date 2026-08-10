import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { resolveUserCalendarZone } from '../users/user-timezone';
import { calculatePersonalStreak } from './streak.calculator';
import { StreakRepository } from './streak.repository';
import { UsersService } from '../users/users.service';
import type { StreakReminderContext } from './streak.types';

type StreakUser = Pick<User, 'timezoneName' | 'timezone'>;

@Injectable()
export class StreakService {
  constructor(
    private _streakRepository: StreakRepository,
    private _usersService: UsersService
  ) {}

  async getPersonalStreak(user: StreakUser, orgId: string) {
    const timezone = resolveUserCalendarZone(user.timezoneName, user.timezone);
    const localDates = await this._streakRepository.getDistinctPublicationDates(
      orgId,
      timezone
    );
    const sortedDates = [...localDates].sort((left, right) =>
      right.localeCompare(left)
    );

    return calculatePersonalStreak(sortedDates, new Date(), timezone);
  }

  async getStreakReminderContext(
    orgId: string,
    userId: string
  ): Promise<StreakReminderContext> {
    const user = await this._usersService.getStreakReminderUser(orgId, userId);
    if (!user) {
      return {
        enabled: false,
        hasActiveStreak: false,
        timezone: { kind: 'iana', name: 'UTC', label: 'UTC' },
      };
    }

    const timezone = resolveUserCalendarZone(user.timezoneName, user.timezone);
    const dates = await this._streakRepository.getDistinctPublicationDates(
      orgId,
      timezone
    );
    const streak = calculatePersonalStreak(dates, new Date(), timezone);

    return {
      enabled: user.activated && !user.disabled && user.sendStreakEmails,
      hasActiveStreak: streak.days > 0,
      timezone,
    };
  }

  async hasPublishedOnLocalDate(
    orgId: string,
    userId: string,
    localDate: string
  ) {
    const context = await this.getStreakReminderContext(orgId, userId);
    if (!context.enabled) {
      return false;
    }

    return this._streakRepository.hasPublishedOnLocalDate(
      orgId,
      localDate,
      context.timezone
    );
  }
}
