import { describe, expect, it, vi } from 'vitest';
import { PostsRepository } from './posts.repository';

describe('PostsRepository.changeDate draft scheduling audit', () => {
  it('does not promote a draft when the scheduling action changes its date', async () => {
    const update = vi.fn().mockResolvedValue({
      id: 'post-1',
      state: 'DRAFT',
    });
    const repository = new PostsRepository(
      { model: { post: { update } } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await expect(
      repository.changeDate(
        'org-1',
        'post-1',
        '2026-08-16T12:00:00Z',
        true,
        'schedule'
      )
    ).resolves.toEqual({ id: 'post-1', state: 'DRAFT' });

    expect(update).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        id: 'post-1',
      },
      data: {
        publishDate: new Date('2026-08-16T12:00:00.000Z'),
        state: 'DRAFT',
        releaseId: null,
        releaseURL: null,
      },
    });
  });
});
