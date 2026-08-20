import { describe, expect, it, vi } from 'vitest';
import { PostsController } from './posts.controller';

const org = { id: 'org-1' } as any;

function createController(validation: any[]) {
  const postsService = {
    validatePosts: vi.fn().mockResolvedValue(validation),
    mapTypeToPost: vi.fn().mockImplementation(async (body) => ({
      ...body,
      mapped: true,
    })),
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
  it('maps and sanitizes before rejecting non-draft shared content errors', async () => {
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
    expect(postsService.mapTypeToPost).toHaveBeenCalledOnce();
    expect(postsService.validatePosts).toHaveBeenCalledWith('org-1', [
      { content: 'Pin' },
    ]);
    expect(postsService.mapTypeToPost.mock.invocationCallOrder[0]).toBeLessThan(
      postsService.validatePosts.mock.invocationCallOrder[0]
    );
    expect(postsService.createPost).not.toHaveBeenCalled();
  });

  it('preserves the legacy too-long error when the shared diagnostic also reports it', async () => {
    const { controller, postsService } = createController([
      {
        ...sharedInvalidItem,
        contentError: 'Your post exceeds 500 characters.',
        tooLong: true,
      },
    ]);

    await expect(
      controller.createPost(org, { type: 'post', posts: [{ content: 'Pin' }] })
    ).rejects.toMatchObject({
      response: {
        provider: 'pinterest',
        name: 'Pinterest',
        error: 'post is too long, please fix it',
      },
    });
    expect(postsService.mapTypeToPost).toHaveBeenCalledOnce();
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
      expect.objectContaining({ mapped: true }),
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
