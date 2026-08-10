import { Injectable } from '@nestjs/common';
import { Prisma, State } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import type { UserCalendarZone } from '../users/user-timezone';

@Injectable()
export class StreakRepository {
  constructor(private _prisma: PrismaService) {}

  async getDistinctPublicationDates(
    orgId: string,
    timezone: UserCalendarZone
  ): Promise<string[]> {
    const localTimestamp =
      timezone.kind === 'iana'
        ? Prisma.sql`timezone(${
            timezone.name
          }, "publishedAt" AT TIME ZONE ${'UTC'})`
        : Prisma.sql`"publishedAt" + make_interval(mins => CAST(${timezone.minutes} AS int4))`;
    const dates = await this._prisma.$queryRaw<Array<{ localDate: string }>>(
      Prisma.sql`
        SELECT DISTINCT (${localTimestamp})::date::text AS "localDate"
        FROM "Post"
        WHERE "organizationId" = ${orgId}
          AND "publishedAt" IS NOT NULL
          AND "state" = CAST(${State.PUBLISHED} AS "State")
        ORDER BY "localDate" DESC
      `
    );

    return dates.map(({ localDate }) => localDate);
  }

  async hasPublishedOnLocalDate(
    orgId: string,
    localDate: string,
    timezone: UserCalendarZone
  ) {
    const localTimestamp =
      timezone.kind === 'iana'
        ? Prisma.sql`timezone(${
            timezone.name
          }, "publishedAt" AT TIME ZONE ${'UTC'})`
        : Prisma.sql`"publishedAt" + make_interval(mins => CAST(${timezone.minutes} AS int4))`;
    const [result] = await this._prisma.$queryRaw<Array<{ exists: boolean }>>(
      Prisma.sql`
        SELECT EXISTS (
          SELECT 1
          FROM "Post"
          WHERE "organizationId" = ${orgId}
            AND "publishedAt" IS NOT NULL
            AND "state" = CAST(${State.PUBLISHED} AS "State")
            AND (${localTimestamp})::date = CAST(${localDate} AS date)
        ) AS "exists"
      `
    );

    return result?.exists === true;
  }
}
