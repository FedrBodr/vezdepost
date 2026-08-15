import { describe, expect, it, vi } from 'vitest';
import { PostsController } from './posts.controller';

const org = { id: 'org-1' } as any;

function createController(validation: any[]) {
  const postsService = {
    validatePosts: vi.fn().mockResolvedValue(validation),
    mapTypeToPost: vi.fn().mockResolvedValue({ mapped: true }),
    createPost: vi.fn().mockResolvedValue({ created: true }),
  };
  const controller = new PostsController(
    postsService as any,
    {} as any,
    {} as any
  );

  return { controller, postsService };
}

const sharedInvalidItem = {
  identifier: 'pinterest',
  name: 'Pinterest',
  contentError: 'This platform requires media.',
  emptyContent: false,
  valid: true,
  errors: true,
  tooLong: false,
};

describe('PostsController.createPost shared content validation', () => {
  it('rejects non-draft shared content errors before mapping or creating', async () => {
    const { controller, postsService } = createController([sharedInvalidItem]);

    await expect(
      controller.createPost(org, { type: 'post', posts: [{ content: 'Pin' }] })
    ).rejects.toMatchObject({
      response: {
        provider: 'pinterest',
        name: 'Pinterest',
        error: 'This platform requires media.',
      },
    });
    expect(postsService.mapTypeToPost).not.toHaveBeenCalled();
    expect(postsService.createPost).not.toHaveBeenCalled();
  });

  it('allows drafts with shared content errors under the existing draft policy', async () => {
    const { controller, postsService } = createController([sharedInvalidItem]);

    await expect(
      controller.createPost(org, { type: 'draft', posts: [{ content: 'Pin' }] })
    ).resolves.toEqual({ created: true });

    expect(postsService.mapTypeToPost).toHaveBeenCalledTimes(1);
    expect(postsService.createPost).toHaveBeenCalledWith(
      'org-1',
      { mapped: true },
      'WEB'
    );
  });

  it('allows clean non-draft posts to proceed', async () => {
    const cleanItem = { ...sharedInvalidItem, contentError: '' };
    const { controller, postsService } = createController([cleanItem]);

    await expect(
      controller.createPost(org, { type: 'post', posts: [{ content: 'Pin' }] })
    ).resolves.toEqual({ created: true });

    expect(postsService.mapTypeToPost).toHaveBeenCalledTimes(1);
    expect(postsService.createPost).toHaveBeenCalledTimes(1);
  });
});
