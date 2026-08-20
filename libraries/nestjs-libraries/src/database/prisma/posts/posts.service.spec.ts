import axios from 'axios';
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
    const axiosMock = vi
      .spyOn(axios, 'get')
      .mockResolvedValue({ data: png } as any);
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
    expect(axiosMock).toHaveBeenCalledWith(
      'https://media.test/forged-video.PNG',
      { responseType: 'arraybuffer' }
    );
    expect(uploadFile).toHaveBeenCalledOnce();
    expect(repository.updateImages).toHaveBeenCalledOnce();
  });
});

describe('PostsService.createPost authored persistence', () => {
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
      const service = createService({
        repository,
        shortLinkService,
        integrationManager: {
          getSocialIntegration: vi.fn().mockReturnValue({
            stripLinks: () => true,
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
