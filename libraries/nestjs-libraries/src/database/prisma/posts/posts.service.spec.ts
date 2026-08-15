import axios from 'axios';
import { getPlatformCapabilities } from '@gitroom/helpers/utils/platform.capabilities';
import { describe, expect, it, vi } from 'vitest';
import { PostsService } from './posts.service';

const createService = ({
  repository = {},
  integrationManager = {},
  integrationService = {},
  mediaService = {},
}: {
  repository?: object;
  integrationManager?: object;
  integrationService?: object;
  mediaService?: object;
} = {}) =>
  new PostsService(
    repository as any,
    integrationManager as any,
    integrationService as any,
    mediaService as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );

describe('PostsService.validatePosts', () => {
  it('passes the compose media type to provider validation', async () => {
    const provider = {
      checkValidity: vi.fn().mockResolvedValue(true),
      maxLength: vi.fn().mockReturnValue(1_000),
    };
    const service = createService({
      integrationManager: {
        getSocialIntegration: vi.fn().mockReturnValue(provider),
        getCapabilities: vi
          .fn()
          .mockReturnValue(getPlatformCapabilities('vk-group')),
      },
      integrationService: {
        getIntegrationById: vi.fn().mockResolvedValue({
          id: 'integration-1',
          providerIdentifier: 'vk-group',
          name: 'VK Group',
          additionalSettings: '[]',
        }),
      },
    });

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

  it('uses registry limits instead of duplicated frontend limits', async () => {
    const provider = {
      checkValidity: vi.fn().mockResolvedValue(true),
      maxLength: vi.fn().mockReturnValue(16384),
      editor: 'normal',
    };
    const service = createService({
      integrationManager: {
        getSocialIntegration: vi.fn().mockReturnValue(provider),
        getCapabilities: vi.fn().mockReturnValue(getPlatformCapabilities('vk')),
      },
      integrationService: {
        getIntegrationById: vi.fn().mockResolvedValue({
          id: 'vk-1',
          providerIdentifier: 'vk',
          name: 'VK',
          additionalSettings: '[]',
        }),
      },
    });
    const [result] = await service.validatePosts('org-1', [
      {
        integration: { id: 'vk-1' },
        value: [{ content: `<p>${'a'.repeat(3000)}</p>`, image: [] }],
      },
    ]);
    expect(result.tooLong).toBe(false);
    expect(result.contentError).toBe('');
  });

  it('returns a blocking Pinterest media error', async () => {
    const provider = {
      checkValidity: vi.fn().mockResolvedValue('Requires at least one media'),
      maxLength: vi.fn().mockReturnValue(500),
      editor: 'normal',
    };
    const service = createService({
      integrationManager: {
        getSocialIntegration: vi.fn().mockReturnValue(provider),
        getCapabilities: vi
          .fn()
          .mockReturnValue(getPlatformCapabilities('pinterest')),
      },
      integrationService: {
        getIntegrationById: vi.fn().mockResolvedValue({
          id: 'pin-1',
          providerIdentifier: 'pinterest',
          name: 'Pinterest',
          additionalSettings: '[]',
        }),
      },
    });
    const [result] = await service.validatePosts('org-1', [
      {
        integration: { id: 'pin-1' },
        value: [{ content: '<p>Pin</p>', image: [] }],
      },
    ]);
    expect(result.contentError).toBe('This platform requires media.');
  });
});

describe('PostsService.updateMedia', () => {
  it('preserves video type through the worker media normalization path', async () => {
    const repository = { updateImages: vi.fn() };
    const mediaService = {
      getMediaById: vi.fn().mockResolvedValue({
        id: 'stored-video',
        path: 'https://media.test/clip.mp4',
        type: 'video',
      }),
    };
    const service = createService({ repository, mediaService });

    const normalized = await service.updateMedia('post-1', [
      {
        id: 'inline-video',
        path: 'https://media.test/inline.mp4',
        type: 'video',
      },
      { id: 'stored-video' },
    ]);

    expect(
      normalized.map(({ id, path, type }) => ({ id, path, type }))
    ).toEqual([
      {
        id: 'inline-video',
        path: 'https://media.test/inline.mp4',
        type: 'video',
      },
      {
        id: 'stored-video',
        path: 'https://media.test/clip.mp4',
        type: 'video',
      },
    ]);
    expect(repository.updateImages).toHaveBeenCalledOnce();
  });

  it('infers only missing legacy media types from their paths', async () => {
    const service = createService();

    const normalized = await service.updateMedia('post-1', [
      { path: 'https://media.test/legacy.mp4' },
      { path: 'https://media.test/legacy.jpg' },
    ]);

    expect(normalized.map(({ type }) => type)).toEqual(['video', 'image']);
  });

  it('does not fetch or convert media declared as video', async () => {
    const axiosMock = vi.spyOn(axios, 'get');
    const service = createService();

    const normalized = await service.updateMedia(
      'post-1',
      [{ path: 'https://media.test/video-with-png-name.png', type: 'video' }],
      true
    );

    expect(normalized[0].type).toBe('video');
    expect(axiosMock).not.toHaveBeenCalled();
  });
});
