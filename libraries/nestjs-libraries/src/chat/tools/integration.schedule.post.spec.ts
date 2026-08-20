import { describe, expect, it, vi } from 'vitest';
import { IntegrationSchedulePostTool } from './integration.schedule.post';

const baseValidation = {
  identifier: 'pinterest',
  name: 'Pinterest',
  contentError: 'This platform requires media.',
  emptyContent: false,
  valid: true,
  errors: true,
  tooLong: false,
  maximumCharacters: 500,
};

const socialPost = {
  integrationId: 'integration-1',
  isPremium: false,
  date: '2026-08-16T12:00:00Z',
  shortLink: false,
  type: 'schedule' as const,
  postsAndComments: [{ content: '<p>Pin</p>', attachments: [] }],
  settings: [],
};

function createTool(validation: any) {
  const postsService = {
    validatePosts: vi.fn().mockResolvedValue([validation]),
    mapTypeToPost: vi.fn().mockImplementation(async (body) => body),
    createPost: vi
      .fn()
      .mockResolvedValue([{ postId: 'post-1', integration: 'integration-1' }]),
  };
  const integrationService = {
    getIntegrationById: vi.fn().mockResolvedValue({
      id: 'integration-1',
      providerIdentifier: 'pinterest',
    }),
  };
  const tool = new IntegrationSchedulePostTool(
    postsService as any,
    integrationService as any
  ).run();

  return { tool, postsService };
}

async function execute(
  tool: ReturnType<IntegrationSchedulePostTool['run']>,
  post = socialPost
) {
  return tool.execute!({ socialPost: [post] }, {
    requestContext: new Map([
      ['organization', JSON.stringify({ id: 'org-1' })],
    ]),
  } as any);
}

describe('IntegrationSchedulePostTool validation', () => {
  it('returns shared content errors without creating a post', async () => {
    const { tool, postsService } = createTool(baseValidation);

    await expect(execute(tool)).resolves.toEqual({
      errors:
        'Pinterest: This platform requires media., please fix it, and try integrationSchedulePostTool again.',
    });
    expect(postsService.createPost).not.toHaveBeenCalled();
  });

  it('keeps the legacy too-long message ahead of shared content errors', async () => {
    const { tool, postsService } = createTool({
      ...baseValidation,
      tooLong: true,
      contentError: 'Your post exceeds 500 characters.',
    });

    await expect(execute(tool)).resolves.toEqual({
      errors:
        'Pinterest: The maximum characters is 500, please fix it, and try integrationSchedulePostTool again.',
    });
    expect(postsService.createPost).not.toHaveBeenCalled();
  });

  it('continues to allow non-empty drafts with platform errors', async () => {
    const { tool, postsService } = createTool(baseValidation);

    await expect(
      execute(tool, { ...socialPost, type: 'draft' })
    ).resolves.toEqual({
      output: [{ postId: 'post-1', integration: 'integration-1' }],
    });
    expect(postsService.createPost).toHaveBeenCalledOnce();
  });

  it('DTO-sanitizes the chat shape before the shared persistence guard', async () => {
    const { tool, postsService } = createTool({
      ...baseValidation,
      contentError: '',
    });
    postsService.mapTypeToPost.mockImplementationOnce(async (body) => ({
      ...body,
      posts: body.posts.map((post: any) => ({
        ...post,
        value: post.value.map((value: any) => ({
          ...value,
          content: '<p>sanitized chat content</p>',
        })),
      })),
    }));

    await execute(tool);

    expect(postsService.mapTypeToPost).toHaveBeenCalledOnce();
    expect(postsService.createPost).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        posts: [
          expect.objectContaining({
            value: [
              expect.objectContaining({
                content: '<p>sanitized chat content</p>',
              }),
            ],
          }),
        ],
      }),
      'MCP'
    );
  });
});
