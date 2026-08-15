import { describe, expect, it, vi } from 'vitest';
import { PublicIntegrationsController } from './public.integrations.controller';

const org = { id: 'org-1' } as any;

const sharedInvalidItem = {
  identifier: 'pinterest',
  name: 'Pinterest',
  contentError: 'This platform requires media.',
  emptyContent: false,
  valid: true,
  errors: true,
  tooLong: false,
  maximumCharacters: 500,
};

function createController(validation: any[]) {
  const postsService = {
    mapTypeToPost: vi.fn().mockImplementation(async (body) => body),
    validatePosts: vi.fn().mockResolvedValue(validation),
    createPost: vi.fn().mockResolvedValue([{ postId: 'post-1' }]),
  };
  const controller = new PublicIntegrationsController(
    {} as any,
    postsService as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );

  return { controller, postsService };
}

describe('PublicIntegrationsController.createPost validation', () => {
  it('rejects a non-draft shared content error before creating', async () => {
    const { controller, postsService } = createController([sharedInvalidItem]);

    await expect(
      controller.createPost(org, {
        type: 'schedule',
        posts: [{ content: 'Pin' }],
      })
    ).rejects.toMatchObject({
      response: {
        provider: 'pinterest',
        name: 'Pinterest',
        error: 'This platform requires media.',
      },
    });
    expect(postsService.createPost).not.toHaveBeenCalled();
  });

  it('keeps the legacy too-long error ahead of shared content errors', async () => {
    const { controller, postsService } = createController([
      {
        ...sharedInvalidItem,
        tooLong: true,
        contentError: 'Your post exceeds 500 characters.',
      },
    ]);

    await expect(
      controller.createPost(org, {
        type: 'schedule',
        posts: [{ content: 'Pin' }],
      })
    ).rejects.toMatchObject({
      response: {
        error: 'post is too long, please fix it',
      },
    });
    expect(postsService.createPost).not.toHaveBeenCalled();
  });

  it('continues to allow non-empty drafts with platform errors', async () => {
    const { controller, postsService } = createController([sharedInvalidItem]);

    await expect(
      controller.createPost(org, {
        type: 'draft',
        posts: [{ content: 'Pin' }],
      })
    ).resolves.toEqual([{ postId: 'post-1' }]);
    expect(postsService.createPost).toHaveBeenCalledOnce();
  });
});
