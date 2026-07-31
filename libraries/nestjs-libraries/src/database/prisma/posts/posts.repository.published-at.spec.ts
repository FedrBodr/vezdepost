import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostsRepository } from './posts.repository';
import { PostsService } from './posts.service';

describe('PostsRepository.updatePost', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists publication identity, state, and timestamp atomically', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T07:00:00.000Z'));
    const model = { post: { update: vi.fn() } };
    const repository = new PostsRepository(
      { model } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    repository.updatePost('post-1', '77', 'https://vk.test/wall1_77');

    expect(model.post.update).toHaveBeenCalledWith({
      where: { id: 'post-1' },
      data: {
        state: 'PUBLISHED',
        releaseId: '77',
        releaseURL: 'https://vk.test/wall1_77',
        publishedAt: new Date('2026-07-29T07:00:00.000Z'),
      },
    });
  });
});

describe('PostsService.updatePost', () => {
  it.each([undefined, '', '  '])(
    'rejects an invalid provider post ID: %s',
    (postId) => {
      const repository = { updatePost: vi.fn() };
      const service = new PostsService(
        repository as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      );

      expect(() =>
        service.updatePost(
          'post-1',
          postId as string,
          'https://vk.test/wall1_77'
        )
      ).toThrow(BadRequestException);
      expect(repository.updatePost).not.toHaveBeenCalled();
    }
  );
});
