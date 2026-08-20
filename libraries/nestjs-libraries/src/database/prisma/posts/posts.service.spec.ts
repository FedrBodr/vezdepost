import * as safeRemoteFetch from '@gitroom/helpers/utils/ssrf.safe.fetch';
import * as mediaReader from '@gitroom/helpers/utils/read.or.fetch';
import { getPlatformCapabilities } from '@gitroom/helpers/utils/platform.capabilities';
import { resolvePlatformCapabilityV2 } from '@gitroom/helpers/utils/platform.capability.resolver';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { selectPostValidationFailure } from './post.validation';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostsService } from './posts.service';

afterEach(() => {
  vi.unstubAllEnvs();
});

const createService = ({
  repository = {},
  integrationManager = {},
  integrationService = {},
  mediaService = {},
  shortLinkService = {},
}: {
  repository?: object;
  integrationManager?: object;
  integrationService?: object;
  mediaService?: object;
  shortLinkService?: object;
} = {}) =>
  new PostsService(
    repository as any,
    integrationManager as any,
    integrationService as any,
    mediaService as any,
    shortLinkService as any,
    {} as any,
    {} as any,
    {} as any
  );

const createCapabilityManager = (
  provider: any,
  capabilities: ReturnType<typeof getPlatformCapabilities>
) => ({
  getSocialIntegration: vi.fn().mockReturnValue(provider),
  getCapabilities: vi.fn().mockReturnValue(capabilities),
  resolveCapabilitiesV2: vi.fn(async ({ providerName, settings, media }: any) =>
    resolvePlatformCapabilityV2({
      identifier: providerName,
      settings,
      media,
      adapter: {
        editor: provider.editor,
        maximum: capabilities.text.max,
        stripRawUrls: capabilities.delivery.stripRawUrls,
      },
    })
  ),
});

describe('PostsService.validatePosts', () => {
  it('ignores forged Slack capability metadata and enforces the trusted V2 limit', async () => {
    const integration = {
      id: 'slack-1',
      providerIdentifier: 'slack',
      name: 'Slack',
      additionalSettings: '[]',
    } as any;
    const provider = {
      checkValidity: vi.fn().mockResolvedValue(true),
      maxLength: vi.fn().mockReturnValue(40_000),
      editor: 'normal' as const,
    };
    const integrationManager = new IntegrationManager();
    vi.spyOn(integrationManager, 'getSocialIntegration').mockReturnValue(
      provider as any
    );
    const resolveCapabilitiesV2 = vi.spyOn(
      integrationManager,
      'resolveCapabilitiesV2'
    );
    const service = createService({
      integrationManager,
      integrationService: {
        getIntegrationById: vi.fn().mockResolvedValue(integration),
      },
    });
    const forgedCapabilities = {
      verification: 'verified',
      evidenceDate: '2099-01-01',
      runtimeOverlay: {
        observedAt: new Date().toISOString(),
        textLimits: {
          body: {
            max: 1_000_000,
            unit: 'utf16-code-units',
            source: 'runtime',
          },
        },
      },
    };

    const [result] = await service.validatePosts('org-1', [
      {
        integration: { id: 'slack-1' },
        settings: { capabilitiesV2: forgedCapabilities },
        value: [{ content: 'a'.repeat(40_001), image: [] }],
      },
    ]);

    expect(resolveCapabilitiesV2).toHaveBeenCalledWith({
      providerName: 'slack',
      settings: { capabilitiesV2: forgedCapabilities },
      media: [],
      integration,
    });
    expect(result.maximumCharacters).toBe(40_000);
    expect(result.tooLong).toBe(false);
    expect(result.contentError).toBe(
      'Body exceeds the 40000-UTF-16-code-unit limit.'
    );
  });

  it('selects TikTok variants from persisted paths and ID-only stored media', async () => {
    const integration = {
      id: 'tiktok-1',
      providerIdentifier: 'tiktok',
      name: 'TikTok',
      additionalSettings: '[]',
    } as any;
    const provider = {
      checkValidity: vi.fn().mockResolvedValue(true),
      maxLength: vi.fn().mockReturnValue(2_200),
      editor: 'normal' as const,
    };
    const integrationManager = new IntegrationManager();
    vi.spyOn(integrationManager, 'getSocialIntegration').mockReturnValue(
      provider as any
    );
    const mediaService = {
      getMediaById: vi.fn(async (id: string) =>
        id === 'stored-photo'
          ? {
              id,
              path: 'https://media.test/actual-photo.jpg',
              type: 'video',
            }
          : {
              id,
              path: 'https://media.test/actual-video.mp4',
              type: 'image',
            }
      ),
    };
    const service = createService({
      integrationManager,
      integrationService: {
        getIntegrationById: vi.fn().mockResolvedValue(integration),
      },
      mediaService,
    });

    const [persistedVideo, persistedPhoto, storedVideo] =
      await service.validatePosts('org-1', [
        {
          integration: { id: 'tiktok-1' },
          settings: {},
          value: [
            {
              content: 'a'.repeat(3_000),
              image: [
                {
                  id: 'stored-photo',
                  path: 'https://client.test/forged-video.mp4',
                  type: 'video',
                },
              ],
            },
          ],
        },
        {
          integration: { id: 'tiktok-1' },
          settings: {},
          value: [
            {
              content: 'a'.repeat(3_000),
              image: [
                {
                  id: 'stored-video',
                  path: 'https://client.test/forged-photo.jpg',
                  type: 'image',
                },
              ],
            },
          ],
        },
        {
          integration: { id: 'tiktok-1' },
          settings: {},
          value: [
            {
              content: 'a'.repeat(3_000),
              image: [{ id: 'stored-video', type: 'image' } as any],
            },
          ],
        },
      ]);

    expect(mediaService.getMediaById).toHaveBeenCalledExactlyOnceWith(
      'stored-video'
    );
    expect(persistedVideo.maximumCharacters).toBe(2_200);
    expect(persistedVideo.contentError).toBe(
      'Caption exceeds the 2200-UTF-16-code-unit limit.'
    );
    expect(persistedPhoto.maximumCharacters).toBe(4_000);
    expect(persistedPhoto.contentError).toBe('');
    expect(storedVideo.maximumCharacters).toBe(2_200);
    expect(storedVideo.contentError).toBe(
      'Caption exceeds the 2200-UTF-16-code-unit limit.'
    );
  });

  it('returns the V2 Pinterest media diagnostic before persistence', async () => {
    const integration = {
      id: 'pin-1',
      providerIdentifier: 'pinterest',
      name: 'Pinterest',
      additionalSettings: '[]',
    } as any;
    const provider = {
      checkValidity: vi.fn().mockResolvedValue(true),
      maxLength: vi.fn().mockReturnValue(500),
      editor: 'normal' as const,
    };
    const integrationManager = new IntegrationManager();
    vi.spyOn(integrationManager, 'getSocialIntegration').mockReturnValue(
      provider as any
    );
    const service = createService({
      integrationManager,
      integrationService: {
        getIntegrationById: vi.fn().mockResolvedValue(integration),
      },
    });

    const [result] = await service.validatePosts('org-1', [
      {
        integration: { id: 'pin-1' },
        settings: { board: 'board-1' },
        value: [{ content: '<p>Pin</p>', image: [] }],
      },
    ]);

    expect(result.tooLong).toBe(false);
    expect(result.contentError).toBe(
      'Attached media does not match the pin variant requirements.'
    );
    expect(selectPostValidationFailure([result], false)?.category).toBe(
      'content-error'
    );
  });

  it('uses trusted Mastodon runtime data to lower the limit and ignores a forged raise', async () => {
    const integration = {
      id: 'mastodon-1',
      providerIdentifier: 'mastodon',
      name: 'Mastodon',
      additionalSettings: '[]',
    } as any;
    const trustedRuntime = {
      observedAt: new Date().toISOString(),
      textLimits: {
        body: {
          max: 100,
          unit: 'graphemes' as const,
          source: 'runtime' as const,
        },
      },
    };
    const provider = {
      checkValidity: vi.fn().mockResolvedValue(true),
      maxLength: vi.fn().mockReturnValue(500),
      editor: 'normal' as const,
      fetchCapabilityRuntime: vi.fn().mockResolvedValue(trustedRuntime),
    };
    const integrationManager = new IntegrationManager();
    vi.spyOn(integrationManager, 'getSocialIntegration').mockReturnValue(
      provider as any
    );
    const service = createService({
      integrationManager,
      integrationService: {
        getIntegrationById: vi.fn().mockResolvedValue(integration),
      },
    });
    const forgedRuntime = {
      observedAt: new Date().toISOString(),
      textLimits: {
        body: {
          max: 50_000,
          unit: 'graphemes',
          source: 'runtime',
        },
      },
    };

    const [result] = await service.validatePosts('org-1', [
      {
        integration: { id: 'mastodon-1' },
        settings: { runtimeOverlay: forgedRuntime },
        value: [{ content: 'a'.repeat(101), image: [] }],
      },
    ]);

    expect(provider.fetchCapabilityRuntime).toHaveBeenCalledExactlyOnceWith(
      integration
    );
    expect(result.maximumCharacters).toBe(100);
    expect(result.tooLong).toBe(false);
    expect(result.contentError).toBe('Body exceeds the 100-grapheme limit.');
  });

  it('passes the compose media type to provider validation', async () => {
    const provider = {
      checkValidity: vi.fn().mockResolvedValue(true),
      maxLength: vi.fn().mockReturnValue(1_000),
    };
    const service = createService({
      integrationManager: createCapabilityManager(
        provider,
        getPlatformCapabilities('vk-group')
      ),
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
      integrationManager: createCapabilityManager(
        provider,
        getPlatformCapabilities('vk')
      ),
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
      integrationManager: createCapabilityManager(
        provider,
        getPlatformCapabilities('pinterest')
      ),
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
        settings: { board: 'board-1' },
        value: [{ content: '<p>Pin</p>', image: [] }],
      },
    ]);
    expect(result.contentError).toBe(
      'Attached media does not match the pin variant requirements.'
    );
  });

  it('uses the premium X limit from integration settings', async () => {
    const service = createService({
      integrationManager: new IntegrationManager(),
      integrationService: {
        getIntegrationById: vi.fn().mockResolvedValue({
          id: 'x-1',
          providerIdentifier: 'x',
          name: 'X Premium',
          additionalSettings: JSON.stringify([
            { title: 'Verified', value: true },
          ]),
        }),
      },
    });

    const [result] = await service.validatePosts('org-1', [
      {
        integration: { id: 'x-1' },
        value: [{ content: `<p>${'a'.repeat(300)}</p>`, image: [] }],
      },
    ]);

    expect(result.maximumCharacters).toBe(4000);
    expect(result.tooLong).toBe(false);
    expect(result.contentError).toBe('');
  });

  it('returns a nonblocking warning when X strips raw URLs', async () => {
    vi.stubEnv('STRIP_LINKS_FROM_X_POSTS', 'true');
    const service = createService({
      integrationManager: new IntegrationManager(),
      integrationService: {
        getIntegrationById: vi.fn().mockResolvedValue({
          id: 'x-1',
          providerIdentifier: 'x',
          name: 'X',
          additionalSettings: '[]',
        }),
      },
    });

    const [result] = await service.validatePosts('org-1', [
      {
        integration: { id: 'x-1' },
        value: [
          { content: '<p>Read https://example.com/path.</p>', image: [] },
        ],
      },
    ]);

    expect(result.contentMessages).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'raw-url-removed',
      })
    );
    expect(result.contentError).toBe('');
  });

  it('authoritatively rejects an effective URL-only X post without media', async () => {
    vi.stubEnv('STRIP_LINKS_FROM_X_POSTS', 'true');
    const service = createService({
      integrationManager: new IntegrationManager(),
      integrationService: {
        getIntegrationById: vi.fn().mockResolvedValue({
          id: 'x-1',
          providerIdentifier: 'x',
          name: 'X',
          additionalSettings: '[]',
        }),
      },
    });

    const [result] = await service.validatePosts('org-1', [
      {
        integration: { id: 'x-1' },
        value: [{ content: '<p>https://example.com/path</p>', image: [] }],
      },
    ]);

    expect(result.emptyContent).toBe(true);
    expect(selectPostValidationFailure([result], false)?.category).toBe(
      'empty-content'
    );
  });

  it('allows effective empty text when media remains and keeps surrounding text non-empty', async () => {
    vi.stubEnv('STRIP_LINKS_FROM_X_POSTS', 'true');
    const service = createService({
      integrationManager: new IntegrationManager(),
      integrationService: {
        getIntegrationById: vi.fn().mockResolvedValue({
          id: 'x-1',
          providerIdentifier: 'x',
          name: 'X',
          additionalSettings: '[]',
        }),
      },
    });

    const [withMedia, withText] = await service.validatePosts('org-1', [
      {
        integration: { id: 'x-1' },
        value: [
          {
            content: '<p>https://example.com/path</p>',
            image: [{ path: 'image.jpg', type: 'image' }],
          },
        ],
      },
      {
        integration: { id: 'x-1' },
        value: [
          {
            content: '<p>Before https://example.com/path after</p>',
            image: [],
          },
        ],
      },
    ]);

    expect(withMedia.emptyContent).toBe(false);
    expect(withText.emptyContent).toBe(false);
  });
});

describe('PostsService.updateMedia', () => {
  it('normalizes a legacy null media list to an empty array', async () => {
    const service = createService();

    await expect(service.updateMedia('post-1', null as any)).resolves.toEqual(
      []
    );
  });

  it.each([
    { label: 'non-array list', media: { path: 'photo.jpg' } },
    { label: 'null item', media: [null] },
    { label: 'missing path and id', media: [{ type: 'video' }] },
  ])('rejects malformed media: $label', async ({ media }) => {
    const service = createService();

    await expect(service.updateMedia('post-1', media as any)).rejects.toThrow(
      /invalid media/i
    );
  });

  it('fails closed when an ID-only legacy lookup fails', async () => {
    const service = createService({
      mediaService: {
        getMediaById: vi.fn().mockRejectedValue(new Error('database details')),
      },
    });

    await expect(
      service.updateMedia('post-1', [{ id: 'missing-media', type: 'video' }])
    ).rejects.toThrow('Unable to prepare media safely.');
  });

  it('confines a legacy relative media path beneath the upload root', async () => {
    vi.stubEnv('UPLOAD_DIRECTORY', '/var/postiz/uploads');
    const service = createService();

    const [normalized] = await service.updateMedia('post-1', [
      { path: '2026/08/20/photo.png' },
    ]);

    expect(normalized.path).toBe('/var/postiz/uploads/2026/08/20/photo.png');
  });

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
      { path: 'https://media.test/legacy.MP4?download=1' },
      { path: 'https://media.test/legacy.JPG?download=1' },
    ]);

    expect(normalized.map(({ type }) => type)).toEqual(['video', 'image']);
  });

  it('derives a forged video declaration from its PNG path and converts it', async () => {
    const repository = { updateImages: vi.fn() };
    const service = createService({ repository });
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    );
    const remoteFetch = vi
      .spyOn(safeRemoteFetch, 'fetchRemoteBuffer')
      .mockResolvedValue(png);
    const uploadFile = vi
      .spyOn((service as any).storage, 'uploadFile')
      .mockResolvedValue({
        path: 'https://media.test/converted.jpg',
        originalname: 'converted.jpg',
      });

    const normalized = await service.updateMedia(
      'post-1',
      [{ path: 'https://media.test/forged-video.PNG', type: 'video' }],
      true
    );

    expect(normalized[0]).toMatchObject({
      type: 'image',
      path: 'https://media.test/converted.jpg',
    });
    expect(remoteFetch).toHaveBeenCalledWith(
      'https://media.test/forged-video.PNG',
      {
        maxBytes: safeRemoteFetch.SAFE_REMOTE_IMAGE_FETCH_MAX_BYTES,
        bodyTimeoutMs: safeRemoteFetch.SAFE_REMOTE_IMAGE_FETCH_BODY_TIMEOUT_MS,
      }
    );
    expect(uploadFile).toHaveBeenCalledOnce();
    expect(repository.updateImages).toHaveBeenCalledOnce();
  });

  it('reads an app-owned local-storage PNG from the confined upload root', async () => {
    vi.stubEnv('STORAGE_PROVIDER', 'local');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:4007');
    vi.stubEnv('UPLOAD_DIRECTORY', '/uploads');
    const repository = { updateImages: vi.fn() };
    const service = createService({ repository });
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    );
    const localRead = vi
      .spyOn(mediaReader, 'readOrFetch')
      .mockResolvedValue(png);
    const remoteFetch = vi
      .spyOn(safeRemoteFetch, 'fetchRemoteBuffer')
      .mockRejectedValue(new Error('localhost must not be fetched remotely'));
    vi.spyOn((service as any).storage, 'uploadFile').mockResolvedValue({
      path: 'http://localhost:4007/uploads/2026/08/20/converted.jpg',
      originalname: 'converted.jpg',
    });

    await expect(
      service.updateMedia(
        'post-1',
        [
          {
            path: 'http://localhost:4007/uploads/2026/08/20/photo.png',
          },
        ],
        true
      )
    ).resolves.toEqual([
      expect.objectContaining({
        path: 'http://localhost:4007/uploads/2026/08/20/converted.jpg',
        type: 'image',
      }),
    ]);
    expect(localRead).toHaveBeenCalledWith('/uploads/2026/08/20/photo.png');
    expect(remoteFetch).not.toHaveBeenCalled();
  });

  it('does not resurrect a forged type when PNG conversion fails', async () => {
    const service = createService();
    vi.spyOn(safeRemoteFetch, 'fetchRemoteBuffer').mockRejectedValue(
      new Error('blocked private address details')
    );

    await expect(
      service.updateMedia(
        'post-1',
        [{ path: 'https://media.test/photo.png', type: 'video' }],
        true
      )
    ).rejects.toThrow('Unable to prepare media safely.');
  });

  it('fails closed when converted media cannot be uploaded', async () => {
    const service = createService();
    vi.spyOn(safeRemoteFetch, 'fetchRemoteBuffer').mockResolvedValue(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      )
    );
    vi.spyOn((service as any).storage, 'uploadFile').mockRejectedValue(
      new Error('storage details')
    );

    await expect(
      service.updateMedia(
        'post-1',
        [{ path: 'https://media.test/photo.png', type: 'video' }],
        true
      )
    ).rejects.toThrow('Unable to prepare media safely.');
  });

  it('fails closed when normalized media cannot be persisted', async () => {
    vi.stubEnv('UPLOAD_DIRECTORY', '/uploads');
    const service = createService({
      repository: {
        updateImages: vi.fn().mockRejectedValue(new Error('database details')),
      },
      mediaService: {
        getMediaById: vi.fn().mockResolvedValue({
          id: 'stored-video',
          path: 'uploads/video.mp4',
          type: 'image',
        }),
      },
    });

    await expect(
      service.updateMedia('post-1', [{ id: 'stored-video' }])
    ).rejects.toThrow('Unable to prepare media safely.');
  });
});

describe('PostsService.createPost authored persistence', () => {
  const createFinalAuthorityService = ({
    transformedContent,
    repository = {
      createOrUpdatePost: vi.fn().mockResolvedValue({
        posts: [{ id: 'post-1', state: 'QUEUE' }],
      }),
    },
  }: {
    transformedContent: string;
    repository?: any;
  }) => {
    const provider = {
      identifier: 'slack',
      editor: 'normal' as const,
      maxLength: vi.fn().mockReturnValue(40_000),
      stripLinks: vi.fn().mockReturnValue(false),
      checkValidity: vi.fn().mockResolvedValue(true),
    };
    const integration = {
      id: 'slack-1',
      providerIdentifier: 'slack',
      name: 'Slack',
      additionalSettings: '[]',
    } as any;
    const integrationManager = new IntegrationManager();
    vi.spyOn(integrationManager, 'getSocialIntegration').mockReturnValue(
      provider as any
    );
    const resolveCapabilitiesV2 = vi.spyOn(
      integrationManager,
      'resolveCapabilitiesV2'
    );
    const service = createService({
      repository,
      integrationManager,
      integrationService: {
        getIntegrationById: vi.fn().mockResolvedValue(integration),
      },
      shortLinkService: {
        convertTextToShortLinks: vi
          .fn()
          .mockResolvedValue([transformedContent]),
      },
    });
    vi.spyOn(service as any, 'startWorkflow').mockResolvedValue(undefined);

    return { service, repository, resolveCapabilitiesV2 };
  };

  const postBody = (content: string, image: any[] = []) => ({
    type: 'schedule' as const,
    shortLink: true,
    date: '2026-08-20T12:00:00Z',
    tags: [],
    posts: [
      {
        integration: { id: 'slack-1' },
        settings: { __type: 'slack' } as any,
        value: [{ id: 'post-1', content, delay: 0, image }],
      },
    ],
  });

  it.each(['WEB', 'API', 'MCP'] as const)(
    'validates and writes the identical transformed content for %s creation',
    async (creationMethod) => {
      const transformed = '<p>final short-link content</p>';
      const { service, repository, resolveCapabilitiesV2 } =
        createFinalAuthorityService({ transformedContent: transformed });

      await service.createPost(
        'org-1',
        postBody('<p>original https://example.com/path</p>'),
        creationMethod
      );

      expect(resolveCapabilitiesV2).toHaveBeenCalledOnce();
      expect(repository.createOrUpdatePost).toHaveBeenCalledOnce();
      expect(
        repository.createOrUpdatePost.mock.calls[0][3].value[0].content
      ).toBe(transformed);
    }
  );

  it('blocks a transformed over-limit post before repository write', async () => {
    const { service, repository } = createFinalAuthorityService({
      transformedContent: `<p>${'a'.repeat(40_001)}</p>`,
    });

    await expect(
      service.createPost(
        'org-1',
        postBody('<p>short before transformation</p>'),
        'WEB'
      )
    ).rejects.toThrow('Body exceeds the 40000-UTF-16-code-unit limit.');
    expect(repository.createOrUpdatePost).not.toHaveBeenCalled();
  });

  it('returns a controlled media validation error before repository write', async () => {
    const { service, repository } = createFinalAuthorityService({
      transformedContent: '<p>content</p>',
    });

    await expect(
      service.createPost('org-1', postBody('<p>content</p>', [null]), 'MCP')
    ).rejects.toThrow(/invalid media/i);
    expect(repository.createOrUpdatePost).not.toHaveBeenCalled();
  });

  it.each(['draft', 'now'] as const)(
    'preserves media authored HTML byte-for-byte for %s posts while skipping short links',
    async (type) => {
      const content =
        '<p>Draft https://example.com/path and ' +
        'https://exa<span>mple</span>.org/other</p>';
      const repository = {
        createOrUpdatePost: vi.fn().mockResolvedValue({
          posts: [{ id: 'post-1', state: 'DRAFT' }],
        }),
      };
      const shortLinkService = { convertTextToShortLinks: vi.fn() };
      const integrationManager = new IntegrationManager();
      vi.spyOn(integrationManager, 'getSocialIntegration').mockReturnValue({
        editor: 'normal',
        maxLength: () => 280,
        stripLinks: () => true,
      } as any);
      const service = createService({
        repository,
        shortLinkService,
        integrationManager,
        integrationService: {
          getIntegrationById: vi.fn().mockResolvedValue({
            id: 'x-1',
            providerIdentifier: 'x',
            name: 'X',
            additionalSettings: '[]',
          }),
        },
      });
      vi.spyOn(service as any, 'startWorkflow').mockResolvedValue(undefined);

      await service.createPost(
        'org-1',
        {
          type,
          shortLink: true,
          date: '2026-08-16T12:00:00Z',
          tags: [],
          posts: [
            {
              integration: { id: 'x-1' },
              group: 'group-1',
              settings: { __type: 'x' } as any,
              value: [
                {
                  content,
                  id: 'post-1',
                  delay: 0,
                  image: [
                    {
                      id: 'image-1',
                      path: 'image.jpg',
                      type: 'image',
                    } as any,
                  ],
                },
              ],
            },
          ],
        },
        'WEB'
      );

      expect(repository.createOrUpdatePost.mock.calls[0][3].value[0]).toEqual(
        expect.objectContaining({ content })
      );
      expect(shortLinkService.convertTextToShortLinks).not.toHaveBeenCalled();
    }
  );
});

describe('PostsService.changePostStatus validation', () => {
  const persistedDraft = {
    id: 'post-1',
    group: 'group-1',
    state: 'DRAFT',
    integrationId: 'integration-1',
    integration: {
      id: 'integration-1',
      providerIdentifier: 'pinterest',
      name: 'Pinterest',
    },
    content: '<p>Pin</p>',
    image: '[]',
    settings: JSON.stringify({ __type: 'pinterest' }),
    parentPostId: null,
    delay: 0,
  };

  const invalidValidation = {
    identifier: 'pinterest',
    name: 'Pinterest',
    contentError: 'This platform requires media.',
    emptyContent: false,
    valid: true,
    errors: true,
    tooLong: false,
    maximumCharacters: 500,
  };

  it('rejects an invalid draft before changing state or starting workflow', async () => {
    const repository = {
      getPostById: vi.fn().mockResolvedValue(persistedDraft),
      getPostsByGroup: vi.fn().mockResolvedValue([persistedDraft]),
      changeState: vi.fn(),
    };
    const service = createService({ repository });
    const validatePosts = vi
      .spyOn(service, 'validatePosts')
      .mockResolvedValue([invalidValidation] as any);
    const startWorkflow = vi
      .spyOn(service as any, 'startWorkflow')
      .mockResolvedValue(undefined);

    await expect(
      service.changePostStatus('org-1', 'post-1', 'schedule')
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: 'This platform requires media.',
      }),
    });

    expect(validatePosts).toHaveBeenCalledWith('org-1', [
      {
        integration: { id: 'integration-1' },
        settings: { __type: 'pinterest' },
        value: [
          {
            content: '<p>Pin</p>',
            image: [],
            delay: 0,
          },
        ],
      },
    ]);
    expect(repository.changeState).not.toHaveBeenCalled();
    expect(startWorkflow).not.toHaveBeenCalled();
  });

  it('queues a clean stored draft only after validation', async () => {
    const repository = {
      getPostById: vi.fn().mockResolvedValue(persistedDraft),
      getPostsByGroup: vi.fn().mockResolvedValue([persistedDraft]),
      changeState: vi.fn().mockResolvedValue(undefined),
    };
    const service = createService({ repository });
    const validatePosts = vi
      .spyOn(service, 'validatePosts')
      .mockResolvedValue([{ ...invalidValidation, contentError: '' }] as any);
    const startWorkflow = vi
      .spyOn(service as any, 'startWorkflow')
      .mockResolvedValue(undefined);

    await expect(
      service.changePostStatus('org-1', 'post-1', 'schedule')
    ).resolves.toEqual({ id: 'post-1', state: 'QUEUE' });

    expect(validatePosts).toHaveBeenCalledOnce();
    expect(repository.changeState).toHaveBeenCalledWith('post-1', 'QUEUE');
    expect(startWorkflow).toHaveBeenCalledWith(
      'pinterest',
      'post-1',
      'org-1',
      'QUEUE'
    );
  });

  it('reconstructs only the requested integration thread from a shared group', async () => {
    const childDraft = {
      ...persistedDraft,
      id: 'post-2',
      content: '<p>First comment</p>',
      image: JSON.stringify([{ path: 'comment.jpg', type: 'image' }]),
      parentPostId: 'post-1',
      delay: 5,
    };
    const otherIntegrationDraft = {
      ...persistedDraft,
      id: 'post-other',
      integrationId: 'integration-2',
      integration: {
        id: 'integration-2',
        providerIdentifier: 'x',
        name: 'X',
      },
      content: '<p>Do not validate this post as Pinterest</p>',
      settings: JSON.stringify({ __type: 'x' }),
    };
    const repository = {
      getPostById: vi.fn().mockResolvedValue(persistedDraft),
      getPostsByGroup: vi
        .fn()
        .mockResolvedValue([persistedDraft, childDraft, otherIntegrationDraft]),
      changeState: vi.fn().mockResolvedValue(undefined),
    };
    const service = createService({ repository });
    const validatePosts = vi
      .spyOn(service, 'validatePosts')
      .mockResolvedValue([{ ...invalidValidation, contentError: '' }] as any);
    vi.spyOn(service as any, 'startWorkflow').mockResolvedValue(undefined);

    await service.changePostStatus('org-1', 'post-1', 'schedule');

    expect(validatePosts).toHaveBeenCalledWith('org-1', [
      {
        integration: { id: 'integration-1' },
        settings: { __type: 'pinterest' },
        value: [
          {
            content: '<p>Pin</p>',
            image: [],
            delay: 0,
          },
          {
            content: '<p>First comment</p>',
            image: [{ path: 'comment.jpg', type: 'image' }],
            delay: 5,
          },
        ],
      },
    ]);
  });
});

describe('PostsService.changeDate draft scheduling audit', () => {
  it('keeps a draft in DRAFT and starts only a draft workflow', async () => {
    const repository = {
      getPostById: vi.fn().mockResolvedValue({
        id: 'post-1',
        state: 'DRAFT',
        integration: { providerIdentifier: 'pinterest' },
      }),
      changeDate: vi.fn().mockResolvedValue({ id: 'post-1', state: 'DRAFT' }),
    };
    const service = createService({ repository });
    const validatePosts = vi.spyOn(service, 'validatePosts');
    const startWorkflow = vi
      .spyOn(service as any, 'startWorkflow')
      .mockResolvedValue(undefined);

    await expect(
      service.changeDate('org-1', 'post-1', '2026-08-16T12:00:00Z', 'schedule')
    ).resolves.toEqual({ id: 'post-1', state: 'DRAFT' });

    expect(repository.changeDate).toHaveBeenCalledWith(
      'org-1',
      'post-1',
      '2026-08-16T12:00:00Z',
      true,
      'schedule'
    );
    expect(startWorkflow).toHaveBeenCalledWith(
      'pinterest',
      'post-1',
      'org-1',
      'DRAFT'
    );
    expect(validatePosts).not.toHaveBeenCalled();
  });
});
