import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { resolveUserCalendarZone } from '../users/user-timezone';
import { calculatePersonalStreak } from './streak.calculator';
import { StreakRepository } from './streak.repository';

type StreakUser = Pick<User, 'timezoneName' | 'timezone'>;

@Injectable()
export class StreakService {
  constructor(private _streakRepository: StreakRepository) {}

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
}
