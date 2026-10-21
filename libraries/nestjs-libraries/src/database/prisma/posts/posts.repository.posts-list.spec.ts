import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostsRepository } from './posts.repository';

const listWhere = async (state: string) => {
  const model = {
    post: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
  const repository = new PostsRepository(
    { model } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  await repository.getPostsList('org-1', { state } as any);
  return model.post.findMany.mock.calls[0][0];
};

describe('PostsRepository.getPostsList', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('past lists sent, failed and overdue posts newest first', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T10:00:00.000Z'));

    const args = await listWhere('past');

    expect(args.where.OR).toEqual([
      { state: { in: ['PUBLISHED', 'ERROR'] } },
      {
        state: 'QUEUE',
        publishDate: { lt: new Date('2026-10-21T10:00:00.000Z') },
      },
    ]);
    expect(args.where.publishDate).toBeUndefined();
    expect(args.orderBy).toEqual([{ publishDate: 'desc' }, { id: 'desc' }]);
  });

  it('scheduled keeps only upcoming queued posts, soonest first', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T10:00:00.000Z'));

    const args = await listWhere('scheduled');

    expect(args.where.state).toBe('QUEUE');
    expect(args.where.publishDate).toEqual({
      gte: new Date('2026-10-21T10:00:00.000Z'),
    });
    expect(args.orderBy).toEqual({ publishDate: 'asc' });
  });
});
