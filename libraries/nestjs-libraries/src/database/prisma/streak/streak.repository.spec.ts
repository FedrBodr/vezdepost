import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { UserCalendarZone } from '../users/user-timezone';
import { StreakRepository } from './streak.repository';

type SqlQuery = {
  sql: string;
  values: unknown[];
};

describe('StreakRepository.getDistinctPublicationDates', () => {
  it('parameterizes the IANA zone and selects confirmed organization dates', async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValue([
        { localDate: '2026-07-29' },
        { localDate: '2026-07-28' },
      ]);
    const repository = new StreakRepository({ $queryRaw: queryRaw } as any);
    const timezone: UserCalendarZone = {
      kind: 'iana',
      name: 'Europe/Moscow',
      label: 'Europe/Moscow',
    };

    await expect(
      repository.getDistinctPublicationDates('org-1', timezone)
    ).resolves.toEqual(['2026-07-29', '2026-07-28']);

    const query = queryRaw.mock.calls[0][0] as SqlQuery;
    expect(query.values).toEqual([
      'Europe/Moscow',
      'UTC',
      'org-1',
      'PUBLISHED',
    ]);
    expect(query.sql).toContain('SELECT DISTINCT');
    expect(query.sql).toContain('timezone(?, "publishedAt" AT TIME ZONE ?)');
    expect(query.sql).toContain('"organizationId" = ?');
    expect(query.sql).toContain('"publishedAt" IS NOT NULL');
    expect(query.sql).toContain('"state" = CAST(? AS "State")');
    expect(query.sql).toContain('ORDER BY "localDate" DESC');
    expect(query.sql).not.toContain('Europe/Moscow');
    expect(query.sql).not.toContain('org-1');
  });

  it('parameterizes a fixed offset in make_interval', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ localDate: '2026-07-29' }]);
    const repository = new StreakRepository({ $queryRaw: queryRaw } as any);
    const timezone: UserCalendarZone = {
      kind: 'offset',
      minutes: 330,
      label: 'UTC+05:30',
    };

    await repository.getDistinctPublicationDates('org-offset', timezone);

    const query = queryRaw.mock.calls[0][0] as SqlQuery;
    expect(query.values).toEqual([330, 'org-offset', 'PUBLISHED']);
    expect(query.sql).toContain('make_interval(mins => CAST(? AS int4))');
    expect(query.sql).toContain('::date');
    expect(query.sql).not.toContain('330');
    expect(query.sql).not.toContain('org-offset');
  });
});

describe('StreakRepository.hasPublishedBetween', () => {
  it('uses direct indexed UTC range predicates', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ exists: true }]);
    const repository = new StreakRepository({ $queryRaw: queryRaw } as any);
    const start = new Date('2026-03-08T05:00:00.000Z');
    const end = new Date('2026-03-09T04:00:00.000Z');

    await expect(
      repository.hasPublishedBetween('org-1', start, end)
    ).resolves.toBe(true);

    const query = queryRaw.mock.calls[0][0] as SqlQuery;
    expect(query.values).toEqual(['org-1', 'PUBLISHED', start, end]);
    expect(query.sql).toContain('SELECT EXISTS');
    expect(query.sql).toContain('"publishedAt" >= ?');
    expect(query.sql).toContain('"publishedAt" < ?');
    expect(query.sql).not.toContain('timezone(');
    expect(query.sql).not.toContain('make_interval');
    expect(query.sql).not.toContain('::date');
    expect(query.sql).not.toContain('org-1');
  });
});

describe('StreakRepository.getLatestConfirmedPublication', () => {
  it('uses an indexed LIMIT query instead of scanning historical local dates', async () => {
    const publishedAt = new Date('2026-07-29T20:59:59.900Z');
    const queryRaw = vi.fn().mockResolvedValue([{ publishedAt }]);
    const repository = new StreakRepository({ $queryRaw: queryRaw } as any);

    await expect(
      repository.getLatestConfirmedPublication('org-1')
    ).resolves.toEqual(publishedAt);

    const query = queryRaw.mock.calls[0][0] as SqlQuery;
    expect(query.values).toEqual(['org-1', 'PUBLISHED']);
    expect(query.sql).toContain('ORDER BY "publishedAt" DESC');
    expect(query.sql).toContain('LIMIT 1');
    expect(query.sql).not.toContain('DISTINCT');
  });
});

describe('Post streak query index', () => {
  it('indexes organization, state, and publication timestamp together', () => {
    const schema = readFileSync(new URL('../schema.prisma', import.meta.url), {
      encoding: 'utf8',
    });
    const postModel = schema.match(/model Post \{[\s\S]*?\n\}/)?.[0];

    expect(postModel).toContain(
      '@@index([organizationId, state, publishedAt])'
    );
  });
});
