import { describe, expect, it, vi } from 'vitest';
import { PostsService } from './posts.service';

describe('PostsService.validatePosts', () => {
  it('passes the compose media type to provider validation', async () => {
    const provider = {
      checkValidity: vi.fn().mockResolvedValue(true),
      maxLength: vi.fn().mockReturnValue(1_000),
    };
    const service = new PostsService(
      {} as any,
      { getSocialIntegration: vi.fn().mockReturnValue(provider) } as any,
      {
        getIntegrationById: vi.fn().mockResolvedValue({
          id: 'integration-1',
          providerIdentifier: 'vk-group',
          name: 'VK Group',
          additionalSettings: '[]',
        }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await service.validatePosts('org-1', [
      {
        integration: { id: 'integration-1' },
        value: [
          {
            content: 'Post with a photograph',
            image: [
              { path: 'photo.jpg', thumbnail: 'thumb.jpg', type: 'image' },
            ],
          },
        ],
      },
    ]);

    expect(provider.checkValidity).toHaveBeenCalledWith(
      [[{ path: 'photo.jpg', thumbnail: 'thumb.jpg', type: 'image' }]],
      {},
      []
    );
  });
});
