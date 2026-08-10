import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { resolveUserCalendarZone } from '../users/user-timezone';
import {
  calculatePersonalStreak,
  getLocalCalendarDate,
  getUtcAtLocalTime,
  shiftCalendarDate,
} from './streak.calculator';
import { StreakRepository } from './streak.repository';
import { UsersService } from '../users/users.service';
import type { StreakReminderSchedule } from './streak.types';

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

  async getStreakReminderSchedule(
    orgId: string,
    userId: string
  ): Promise<StreakReminderSchedule> {
    const user = await this._usersService.getStreakReminderUser(orgId, userId);
    if (!user) {
      return {
        enabled: false,
        active: false,
        targetLocalDate: null,
        reminderAt: null,
        midnightAt: null,
        timezone: null,
      };
    }

    const timezone = resolveUserCalendarZone(user.timezoneName, user.timezone);
    const latestPublishedAt =
      await this._streakRepository.getLatestConfirmedPublication(orgId);
    const enabled = user.activated && !user.disabled && user.sendStreakEmails;
    if (!latestPublishedAt) {
      return {
        enabled,
        active: false,
        targetLocalDate: null,
        reminderAt: null,
        midnightAt: null,
        timezone: timezone.label,
      };
    }

    const now = new Date();
    const latestLocalDate = getLocalCalendarDate(latestPublishedAt, timezone);
    const today = getLocalCalendarDate(now, timezone);
    const active =
      latestLocalDate === today ||
      latestLocalDate === shiftCalendarDate(today, -1);
    const targetLocalDate = shiftCalendarDate(latestLocalDate, 1);
    const reminderAt = getUtcAtLocalTime(targetLocalDate, 22, 0, timezone);
    const midnightAt = getUtcAtLocalTime(
      shiftCalendarDate(targetLocalDate, 1),
      0,
      0,
      timezone
    );

    return {
      enabled,
      active,
      targetLocalDate,
      reminderAt: reminderAt.toISOString(),
      midnightAt: midnightAt.toISOString(),
      timezone: timezone.label,
    };
  }

  async hasPublishedOnLocalDate(
    orgId: string,
    userId: string,
    localDate: string
  ) {
    const user = await this._usersService.getStreakReminderUser(orgId, userId);
    if (!user) {
      return false;
    }

    const timezone = resolveUserCalendarZone(user.timezoneName, user.timezone);

    const start = getUtcAtLocalTime(localDate, 0, 0, timezone);
    const end = getUtcAtLocalTime(
      shiftCalendarDate(localDate, 1),
      0,
      0,
      timezone
    );

    return this._streakRepository.hasPublishedBetween(orgId, start, end);
  }
}
