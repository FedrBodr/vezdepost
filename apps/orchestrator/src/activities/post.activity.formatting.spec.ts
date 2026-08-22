import { describe, expect, it, vi } from 'vitest';
import { PostActivity } from './post.activity';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { resolvePlatformCapabilityV2 } from '@gitroom/helpers/utils/platform.capability.resolver';
import type { ResolvedPlatformCapabilityV2 } from '@gitroom/helpers/utils/platform.capability.types';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { authorizeMediaSource } from '@gitroom/helpers/utils/media.source';
import { ApplicationFailure } from '@temporalio/activity';

vi.mock('@gitroom/helpers/utils/media.source', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authorizeMediaSource: vi.fn(async (path: string) => {
      if (
        path.includes('169.254.169.254') ||
        path.includes('private.example.test') ||
        path.includes('missing-local') ||
        path.includes('dns-timeout')
      ) {
        if (path.includes('missing-local')) {
          throw new actual.InvalidMediaSourceError();
        }
        throw new Error(
          path.includes('dns-timeout')
            ? 'Remote media DNS lookup timed out'
            : 'Blocked remote media URL'
        );
      }
    }),
  };
});

const createCapabilityManager = (
  provider: any,
  capability: ResolvedPlatformCapabilityV2
) => ({
  getSocialIntegration: vi.fn().mockReturnValue(provider),
  resolveCapabilitiesV2: vi.fn(async ({ providerName, settings, media }: any) =>
    resolvePlatformCapabilityV2({
      identifier: providerName,
      settings,
      media,
      adapter: {
        editor: provider.editor ?? 'normal',
        maximum:
          capability.fields.find(
            ({ source, limit }) => source === 'canonical-editor' && !!limit
          )?.limit?.max ?? 1_000_000,
        stripRawUrls: capability.delivery.stripRawUrls,
      },
    })
  ),
});

const resolvedCapability = (
  identifier: string,
  adapter?: { editor: 'normal'; maximum: number; stripRawUrls: boolean }
) =>
  resolvePlatformCapabilityV2({
    identifier,
    settings: {},
    media: [],
    ...(adapter ? { adapter } : {}),
  });

describe('PostActivity platform formatting', () => {
  it('passes registry-normalized Telegram content to the provider', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const provider = {
      post: vi.fn().mockResolvedValue([]),
      editor: 'html',
      mentionFormat: undefined as
        | ((idOrHandle: string, name: string) => string)
        | undefined,
      convertToJPEG: false,
    };
    const postService = {
      updateTags: vi.fn().mockResolvedValue([
        {
          id: 'post-1',
          content:
            '<h1>Title</h1><p><strong>Body</strong> <a href="https://x.test">Link</a></p>',
          settings: '{}',
          image: JSON.stringify([
            { path: 'https://media.test/photo.jpg', type: 'image' },
          ]),
        },
      ]),
      updateMedia: vi
        .fn()
        .mockResolvedValue([
          { path: 'https://media.test/photo.jpg', type: 'image' },
        ]),
    };
    const integrationManager = createCapabilityManager(
      provider,
      resolvedCapability('telegram')
    );
    const activity = new PostActivity(
      postService as any,
      {} as any,
      integrationManager as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await activity.postSocial(
      {
        id: 'integration-1',
        internalId: 'channel',
        token: 'chat-id',
        providerIdentifier: 'telegram',
        organizationId: 'org-1',
      } as any,
      [{ id: 'post-1' } as any]
    );

    expect(provider.post).toHaveBeenCalledWith(
      'channel',
      'chat-id',
      [
        expect.objectContaining({
          message: 'Title\n<b>Body</b> Link',
          fields: expect.objectContaining({
            body: expect.objectContaining({
              value: 'Title\n<b>Body</b> Link',
            }),
            caption: expect.objectContaining({
              value: 'Title\n<b>Body</b> Link',
            }),
          }),
        }),
      ],
      expect.objectContaining({ id: 'integration-1' })
    );
  });

  it.each([
    [
      'telegram',
      '<b>real</b> &lt;b&gt;literal&lt;/b&gt; ' +
        '&lt;script&gt;alert&lt;/script&gt; &amp; ©',
    ],
    [
      'max',
      '<strong>real</strong> &lt;b&gt;literal&lt;/b&gt; ' +
        '&lt;script&gt;alert&lt;/script&gt; &amp; ©',
    ],
  ])(
    'passes safe escaped text to %s transport without activating it',
    async (identifier, expected) => {
      vi.stubEnv('STRIPE_SECRET_KEY', '');
      const provider = {
        post: vi.fn().mockResolvedValue([]),
        editor: 'html',
        mentionFormat: undefined,
        convertToJPEG: false,
      };
      const postService = {
        updateTags: vi.fn().mockResolvedValue([
          {
            id: 'post-1',
            content:
              '<p><strong>real</strong> &lt;b&gt;literal&lt;/b&gt; ' +
              '&lt;script&gt;alert&lt;/script&gt; &amp; &copy;</p>',
            settings: '{}',
            image: '[]',
          },
        ]),
        updateMedia: vi.fn().mockResolvedValue([]),
      };
      const integrationManager = createCapabilityManager(
        provider,
        resolvedCapability(identifier)
      );
      const activity = new PostActivity(
        postService as any,
        {} as any,
        integrationManager as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      );

      await activity.postSocial(
        {
          id: 'integration-1',
          internalId: 'channel',
          token: 'token',
          providerIdentifier: identifier,
          organizationId: 'org-1',
        } as any,
        [{ id: 'post-1' } as any]
      );

      expect(provider.post).toHaveBeenCalledWith(
        'channel',
        'token',
        [expect.objectContaining({ message: expected })],
        expect.objectContaining({ id: 'integration-1' })
      );
    }
  );

  it.each(['post', 'comment'] as const)(
    'rejects a missing local media source before provider.%s invocation',
    async (method) => {
      vi.stubEnv('STRIPE_SECRET_KEY', '');
      const mediaPath = '/var/postiz/uploads/missing-local.jpg';
      const provider = {
        post: vi.fn().mockResolvedValue([]),
        comment: vi.fn().mockResolvedValue([]),
        editor: 'normal' as const,
        mentionFormat: undefined,
        convertToJPEG: false,
        maxLength: vi.fn().mockReturnValue(40_000),
      };
      const postService = {
        updateTags: vi.fn().mockResolvedValue([
          {
            id: 'post-1',
            content: 'safe',
            settings: '{}',
            image: JSON.stringify([{ path: mediaPath }]),
          },
        ]),
        updateMedia: vi
          .fn()
          .mockResolvedValue([{ path: mediaPath, type: 'image' }]),
      };
      const integrationManager = new IntegrationManager();
      vi.spyOn(integrationManager, 'getSocialIntegration').mockReturnValue(
        provider as any
      );
      const activity = new PostActivity(
        postService as any,
        {} as any,
        integrationManager,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      );
      const integration = {
        id: 'integration-1',
        internalId: 'profile',
        token: 'token',
        providerIdentifier: 'slack',
        organizationId: 'org-1',
      } as any;

      const request =
        method === 'post'
          ? activity.postSocial(integration, [{ id: 'post-1' } as any])
          : activity.postComment('remote-post', undefined, integration, [
              { id: 'post-1' } as any,
            ]);

      await expect(request).rejects.toThrow(/invalid media source/i);
      expect(provider.post).not.toHaveBeenCalled();
      expect(provider.comment).not.toHaveBeenCalled();
    }
  );

  it('authorizes ID-resolved complete-thread media before persistence, conversion, sibling preparation, or provider effects', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const unsafeThumbnail =
      'http://169.254.169.254/latest/meta-data/secondary.jpg';
    const integration = {
      id: 'integration-1',
      internalId: 'profile',
      token: 'token',
      providerIdentifier: 'reddit',
      organizationId: 'org-1',
    };
    const posts = [
      {
        id: 'safe-sibling',
        integration,
        content: '<p>safe sibling</p>',
        settings: '{}',
        image: JSON.stringify([{ id: 'safe-media' }]),
      },
      {
        id: 'unsafe-secondary',
        integration,
        content: '<p>unsafe secondary</p>',
        settings: '{}',
        image: JSON.stringify([{ id: 'unsafe-media' }]),
      },
    ] as any[];
    const provider = {
      post: vi.fn().mockResolvedValue([]),
      editor: 'normal' as const,
      mentionFormat: undefined,
      convertToJPEG: true,
      maxLength: vi.fn().mockReturnValue(10_000),
    };
    const postService = {
      getPostsRecursively: vi.fn().mockResolvedValue(posts),
      resolveMediaSources: vi.fn(async ([media]: Array<{ id: string }>) =>
        media.id === 'safe-media'
          ? [
              {
                id: media.id,
                path: 'https://media.example.test/safe.png',
                type: 'image',
              },
            ]
          : [
              {
                id: media.id,
                path: 'https://media.example.test/video.mp4',
                type: 'video',
                thumbnail: unsafeThumbnail,
              },
            ]
      ),
      updateTags: vi.fn().mockResolvedValue(posts),
      updateMedia: vi.fn().mockResolvedValue([]),
    };
    const integrationManager = new IntegrationManager();
    vi.spyOn(integrationManager, 'getSocialIntegration').mockReturnValue(
      provider as any
    );
    const resolveCapabilities = vi.spyOn(
      integrationManager,
      'resolveCapabilitiesV2'
    );
    const activity = new PostActivity(
      postService as any,
      {} as any,
      integrationManager,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await expect(
      activity.getPostsList('org-1', 'safe-sibling')
    ).rejects.toThrow(/blocked remote media/i);

    expect(authorizeMediaSource).toHaveBeenCalledWith(unsafeThumbnail);
    expect(postService.resolveMediaSources).toHaveBeenCalledTimes(2);
    expect(postService.updateTags).not.toHaveBeenCalled();
    expect(postService.updateMedia).not.toHaveBeenCalled();
    expect(resolveCapabilities).not.toHaveBeenCalled();
    expect(provider.post).not.toHaveBeenCalled();
  });

  it.each([
    [
      'unsafe remote media',
      JSON.stringify([
        {
          path: 'http://169.254.169.254/latest/meta-data/photo.jpg',
          type: 'image',
        },
      ]),
      'Blocked remote media URL',
    ],
    [
      'missing local media',
      JSON.stringify([{ path: 'missing-local.jpg', type: 'image' }]),
      'Invalid media source',
    ],
    ['malformed media JSON', '{', 'Invalid publication media'],
    ['null media member', '[null]', 'Invalid publication media'],
    [
      'mixed valid and null media members',
      JSON.stringify([
        { path: 'https://media.example.test/photo.jpg', type: 'image' },
        null,
      ]),
      'Invalid publication media',
    ],
    [
      'primitive media member',
      JSON.stringify(['not-a-media-object']),
      'Invalid publication media',
    ],
    [
      'nested array media member',
      JSON.stringify([
        [{ path: 'https://media.example.test/photo.jpg', type: 'image' }],
      ]),
      'Invalid publication media',
    ],
  ])(
    'classifies %s preflight failures as structured and non-retryable',
    async (_caseName, image, message) => {
      const postService = {
        getPostsRecursively: vi.fn().mockResolvedValue([
          {
            id: 'post-1',
            organizationId: 'org-1',
            settings: '{}',
            image,
            integration: { providerIdentifier: 'slack' },
          },
        ]),
        resolveMediaSources: vi.fn(),
      };
      const activity = new PostActivity(
        postService as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      );

      const request = activity.getPostsList('org-1', 'post-1');

      await expect(request).rejects.toBeInstanceOf(ApplicationFailure);
      await expect(request).rejects.toMatchObject({
        message,
        type: 'publication_media_preflight',
        nonRetryable: true,
      });
      expect(postService.resolveMediaSources).not.toHaveBeenCalled();
    }
  );

  it('keeps transient preflight infrastructure failures retryable', async () => {
    const error = new Error('Remote media DNS lookup timed out');
    const postService = {
      getPostsRecursively: vi.fn().mockResolvedValue([
        {
          id: 'post-1',
          organizationId: 'org-1',
          settings: '{}',
          image: JSON.stringify([
            {
              path: 'https://dns-timeout.example.test/photo.jpg',
              type: 'image',
            },
          ]),
          integration: { providerIdentifier: 'slack' },
        },
      ]),
      resolveMediaSources: vi.fn(),
    };
    const activity = new PostActivity(
      postService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await expect(activity.getPostsList('org-1', 'post-1')).rejects.toEqual(
      error
    );
  });

  it('publishes tagless special characters unchanged', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const mentionFormat = vi.fn(() => '@mention');
    const provider = {
      post: vi.fn().mockResolvedValue([]),
      editor: 'normal',
      mentionFormat,
      convertToJPEG: false,
    };
    const postService = {
      updateTags: vi.fn().mockResolvedValue([
        {
          id: 'post-1',
          content: 'AT&T < launch > landing &copy;',
          settings: '{}',
          image: '[]',
        },
      ]),
      updateMedia: vi.fn().mockResolvedValue([]),
    };
    const integrationManager = createCapabilityManager(
      provider,
      resolvedCapability('linkedin')
    );
    const activity = new PostActivity(
      postService as any,
      {} as any,
      integrationManager as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await activity.postSocial(
      {
        id: 'integration-1',
        internalId: 'profile',
        token: 'token',
        providerIdentifier: 'linkedin',
        organizationId: 'org-1',
      } as any,
      [{ id: 'post-1' } as any]
    );

    expect(provider.post).toHaveBeenCalledWith(
      'profile',
      'token',
      [
        expect.objectContaining({
          message: 'AT&T < launch > landing &copy;',
        }),
      ],
      expect.objectContaining({ id: 'integration-1' })
    );
    expect(mentionFormat).not.toHaveBeenCalled();
  });

  it('passes mention-normalized posts and comments preserving raw URLs to transport', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const mentionFormat = vi.fn((idOrHandle: string) => `@${idOrHandle}`);
    const provider = {
      post: vi.fn().mockResolvedValue([]),
      comment: vi.fn().mockResolvedValue([]),
      editor: 'normal',
      mentionFormat,
      convertToJPEG: false,
    };
    const postService = {
      updateTags: vi.fn().mockResolvedValue([
        {
          id: 'post-1',
          content:
            '<p>Hello <span data-mention-id="ada">@Ada</span> ' +
            'https://exa<span>mple</span>.com/path</p>',
          settings: '{}',
          image: '[]',
        },
      ]),
      updateMedia: vi.fn().mockResolvedValue([]),
    };
    const integrationManager = createCapabilityManager(
      provider,
      resolvedCapability('x', {
        editor: 'normal',
        maximum: 280,
        stripRawUrls: true,
      })
    );
    const activity = new PostActivity(
      postService as any,
      {} as any,
      integrationManager as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    const integration = {
      id: 'integration-1',
      internalId: 'profile',
      token: 'token',
      providerIdentifier: 'x',
      organizationId: 'org-1',
    } as any;
    const posts = [{ id: 'post-1' } as any];

    await activity.postSocial(integration, posts);
    await activity.postComment(
      'remote-post',
      'remote-last',
      integration,
      posts
    );

    expect(provider.post).toHaveBeenCalledWith(
      'profile',
      'token',
      [
        expect.objectContaining({
          message: 'Hello @ada https://example.com/path',
        }),
      ],
      expect.objectContaining({ id: 'integration-1' })
    );
    expect(provider.comment).toHaveBeenCalledWith(
      'profile',
      'remote-post',
      'remote-last',
      'token',
      [
        expect.objectContaining({
          message: 'Hello @ada https://example.com/path',
        }),
      ],
      expect.objectContaining({ id: 'integration-1' })
    );
    expect(mentionFormat).toHaveBeenCalledTimes(2);
    expect(mentionFormat).toHaveBeenCalledWith('ada', '@Ada');
  });

  it('passes TikTok photo description as message while retaining structured title', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const provider = {
      post: vi.fn().mockResolvedValue([]),
      checkValidity: vi.fn().mockResolvedValue(true),
      maxLength: vi.fn().mockReturnValue(2_200),
      editor: 'normal' as const,
      mentionFormat: undefined,
      convertToJPEG: false,
    };
    const settings = {
      title: 'Structured title',
      content_posting_method: 'DIRECT_POST',
    };
    const postService = {
      updateTags: vi.fn().mockResolvedValue([
        {
          id: 'post-1',
          content: '<p>Canonical description</p>',
          settings: JSON.stringify(settings),
          image: JSON.stringify([
            { path: 'https://client.test/photo.jpg', type: 'video' },
          ]),
        },
      ]),
      updateMedia: vi
        .fn()
        .mockResolvedValue([
          { path: 'https://media.test/photo.jpg', type: 'image' },
        ]),
    };
    const integrationManager = new IntegrationManager();
    vi.spyOn(integrationManager, 'getSocialIntegration').mockReturnValue(
      provider as any
    );
    const activity = new PostActivity(
      postService as any,
      {} as any,
      integrationManager,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await activity.postSocial(
      {
        id: 'integration-1',
        internalId: 'profile',
        token: 'token',
        providerIdentifier: 'tiktok',
        organizationId: 'org-1',
      } as any,
      [{ id: 'post-1' } as any]
    );

    expect(provider.post).toHaveBeenCalledWith(
      'profile',
      'token',
      [
        expect.objectContaining({
          message: 'Canonical description',
          settings,
          fields: {
            title: { value: 'Structured title', facets: undefined },
            description: {
              value: 'Canonical description',
              facets: undefined,
            },
          },
        }),
      ],
      expect.objectContaining({ id: 'integration-1' })
    );
  });

  it.each(['post', 'comment'] as const)(
    'blocks a deterministic violation before provider.%s',
    async (method) => {
      vi.stubEnv('STRIPE_SECRET_KEY', '');
      const provider = {
        post: vi.fn().mockResolvedValue([]),
        comment: vi.fn().mockResolvedValue([]),
        checkValidity: vi.fn().mockResolvedValue(true),
        maxLength: vi.fn().mockReturnValue(40_000),
        editor: 'normal' as const,
        mentionFormat: undefined,
        convertToJPEG: false,
      };
      const forgedRuntime = {
        observedAt: new Date().toISOString(),
        textLimits: {
          body: {
            max: 1_000_000,
            unit: 'utf16-code-units',
            source: 'runtime',
          },
        },
      };
      const postService = {
        updateTags: vi.fn().mockResolvedValue([
          {
            id: 'post-1',
            content: 'a'.repeat(40_001),
            settings: JSON.stringify({ runtimeOverlay: forgedRuntime }),
            image: '[]',
          },
        ]),
        updateMedia: vi.fn().mockResolvedValue([]),
      };
      const integrationManager = new IntegrationManager();
      vi.spyOn(integrationManager, 'getSocialIntegration').mockReturnValue(
        provider as any
      );
      const activity = new PostActivity(
        postService as any,
        {} as any,
        integrationManager,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      );
      const integration = {
        id: 'integration-1',
        internalId: 'channel',
        token: 'token',
        providerIdentifier: 'slack',
        organizationId: 'org-1',
      } as any;

      const request =
        method === 'post'
          ? activity.postSocial(integration, [{ id: 'post-1' } as any])
          : activity.postComment('remote-post', 'remote-last', integration, [
              { id: 'post-1' } as any,
            ]);

      await expect(request).rejects.toThrow(
        'Body exceeds the 40000-UTF-16-code-unit limit.'
      );
      expect(provider.post).not.toHaveBeenCalled();
      expect(provider.comment).not.toHaveBeenCalled();
    }
  );

  it('blocks deterministic content before optional media conversion/download', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const provider = {
      post: vi.fn().mockResolvedValue([]),
      editor: 'normal' as const,
      mentionFormat: undefined,
      convertToJPEG: true,
      maxLength: vi.fn().mockReturnValue(2_200),
    };
    const postService = {
      updateTags: vi.fn().mockResolvedValue([
        {
          id: 'post-1',
          content: 'a'.repeat(50_000),
          settings: '{}',
          image: JSON.stringify([
            { path: 'https://media.example.test/photo.png' },
          ]),
        },
      ]),
      updateMedia: vi
        .fn()
        .mockResolvedValueOnce([
          { path: 'https://media.example.test/photo.png', type: 'image' },
        ])
        .mockRejectedValue(new Error('conversion downloaded media')),
    };
    const integrationManager = new IntegrationManager();
    vi.spyOn(integrationManager, 'getSocialIntegration').mockReturnValue(
      provider as any
    );
    const activity = new PostActivity(
      postService as any,
      {} as any,
      integrationManager,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await expect(
      activity.postSocial(
        {
          id: 'integration-1',
          internalId: 'profile',
          token: 'token',
          providerIdentifier: 'tiktok',
          organizationId: 'org-1',
        } as any,
        [{ id: 'post-1' } as any]
      )
    ).rejects.toThrow(/exceeds/i);
    expect(postService.updateMedia).toHaveBeenCalledOnce();
    expect(postService.updateMedia).toHaveBeenCalledWith(
      'post-1',
      [{ path: 'https://media.example.test/photo.png' }],
      false
    );
    expect(provider.post).not.toHaveBeenCalled();
  });

  it('analyzes a JPEG-converting post once while publishing its converted media', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const provider = {
      post: vi.fn().mockResolvedValue([]),
      editor: 'normal' as const,
      mentionFormat: undefined,
      convertToJPEG: true,
      maxLength: vi.fn().mockReturnValue(2_200),
    };
    const postService = {
      updateTags: vi.fn().mockResolvedValue([
        {
          id: 'post-1',
          content: '<p>safe</p>',
          settings: '{}',
          image: JSON.stringify([
            { path: 'https://media.example.test/photo.png' },
          ]),
        },
      ]),
      updateMedia: vi
        .fn()
        .mockResolvedValueOnce([
          { path: 'https://media.example.test/photo.png', type: 'image' },
        ])
        .mockResolvedValueOnce([
          { path: 'nested/converted.jpg', type: 'image' },
        ]),
    };
    const integrationManager = createCapabilityManager(
      provider,
      resolvedCapability('tiktok')
    );
    const activity = new PostActivity(
      postService as any,
      {} as any,
      integrationManager as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await activity.postSocial(
      {
        id: 'integration-1',
        internalId: 'profile',
        token: 'token',
        providerIdentifier: 'tiktok',
        organizationId: 'org-1',
      } as any,
      [{ id: 'post-1' } as any]
    );

    expect(integrationManager.resolveCapabilitiesV2).toHaveBeenCalledOnce();
    expect(provider.post).toHaveBeenCalledWith(
      'profile',
      'token',
      [
        expect.objectContaining({
          media: [{ path: 'nested/converted.jpg', type: 'image' }],
        }),
      ],
      expect.anything()
    );
  });

  it.each([
    ['post', 'direct', 'http://169.254.169.254/latest/meta-data/photo.jpg'],
    ['comment', 'direct', 'http://169.254.169.254/latest/meta-data/photo.jpg'],
    ['post', 'DNS-private', 'https://private.example.test/photo.jpg'],
    ['comment', 'DNS-private', 'https://private.example.test/photo.jpg'],
  ] as const)(
    'rejects a %s %s media source before provider invocation',
    async (method, _kind, mediaPath) => {
      vi.stubEnv('STRIPE_SECRET_KEY', '');
      const provider = {
        post: vi.fn().mockResolvedValue([]),
        comment: vi.fn().mockResolvedValue([]),
        editor: 'normal' as const,
        mentionFormat: undefined,
        convertToJPEG: false,
        maxLength: vi.fn().mockReturnValue(40_000),
      };
      const postService = {
        updateTags: vi.fn().mockResolvedValue([
          {
            id: 'post-1',
            content: 'safe',
            settings: '{}',
            image: JSON.stringify([
              {
                path: mediaPath,
              },
            ]),
          },
        ]),
        updateMedia: vi.fn().mockResolvedValue([
          {
            path: mediaPath,
            type: 'image',
          },
        ]),
      };
      const integrationManager = new IntegrationManager();
      vi.spyOn(integrationManager, 'getSocialIntegration').mockReturnValue(
        provider as any
      );
      const activity = new PostActivity(
        postService as any,
        {} as any,
        integrationManager,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      );
      const integration = {
        id: 'integration-1',
        internalId: 'profile',
        token: 'token',
        providerIdentifier: 'slack',
        organizationId: 'org-1',
      } as any;

      const request =
        method === 'post'
          ? activity.postSocial(integration, [{ id: 'post-1' } as any])
          : activity.postComment('remote-post', undefined, integration, [
              { id: 'post-1' } as any,
            ]);

      await expect(request).rejects.toThrow(/blocked remote media/i);
      expect(provider.post).not.toHaveBeenCalled();
      expect(provider.comment).not.toHaveBeenCalled();
    }
  );

  it.each(
    [
      ['youtube', 'settings.thumbnail.path'],
      ['wordpress', 'settings.main_image.path'],
      ['reddit', 'media.thumbnail'],
      ['tumblr', 'media.thumbnail'],
    ].flatMap(([providerIdentifier, field]) =>
      (['post', 'comment'] as const).map(
        (method) => [providerIdentifier, field, method] as const
      )
    )
  )(
    'rejects unsafe %s %s before provider.%s invocation',
    async (providerIdentifier, field, method) => {
      vi.stubEnv('STRIPE_SECRET_KEY', '');
      const unsafePath =
        'http://169.254.169.254/latest/meta-data/secondary.jpg';
      const settings =
        providerIdentifier === 'youtube'
          ? { thumbnail: { path: unsafePath } }
          : providerIdentifier === 'wordpress'
          ? { main_image: { path: unsafePath } }
          : {};
      const media = [
        {
          path: 'https://media.example.test/primary.mp4',
          type: 'video' as const,
          ...(['reddit', 'tumblr'].includes(providerIdentifier)
            ? { thumbnail: unsafePath }
            : {}),
        },
      ];
      const provider = {
        post: vi.fn().mockResolvedValue([]),
        comment: vi.fn().mockResolvedValue([]),
        editor: 'normal' as const,
        mentionFormat: undefined,
        convertToJPEG: false,
        maxLength: vi.fn().mockReturnValue(40_000),
      };
      const postService = {
        updateTags: vi.fn().mockResolvedValue([
          {
            id: 'post-1',
            content: '<p>safe</p>',
            settings: JSON.stringify(settings),
            image: JSON.stringify(media),
          },
        ]),
        updateMedia: vi.fn().mockResolvedValue(media),
      };
      const integrationManager = new IntegrationManager();
      vi.spyOn(integrationManager, 'getSocialIntegration').mockReturnValue(
        provider as any
      );
      const activity = new PostActivity(
        postService as any,
        {} as any,
        integrationManager,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      );
      const integration = {
        id: 'integration-1',
        internalId: 'profile',
        token: 'token',
        providerIdentifier,
        organizationId: 'org-1',
      } as any;

      const request =
        method === 'post'
          ? activity.postSocial(integration, [{ id: 'post-1' } as any])
          : activity.postComment('remote-post', undefined, integration, [
              { id: 'post-1' } as any,
            ]);

      await expect(request).rejects.toThrow(/blocked remote media/i);
      expect(provider.post).not.toHaveBeenCalled();
      expect(provider.comment).not.toHaveBeenCalled();
    }
  );

  it('rejects with the media authorization error when a required title is also missing', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const unsafePath = 'http://169.254.169.254/latest/meta-data/secondary.jpg';
    const settings = { thumbnail: { path: unsafePath } };
    const media = [
      {
        path: 'https://media.example.test/primary.mp4',
        type: 'video' as const,
      },
    ];
    const provider = {
      post: vi.fn().mockResolvedValue([]),
      comment: vi.fn().mockResolvedValue([]),
      editor: 'normal' as const,
      mentionFormat: undefined,
      convertToJPEG: false,
      maxLength: vi.fn().mockReturnValue(40_000),
    };
    const postService = {
      updateTags: vi.fn().mockResolvedValue([
        {
          id: 'post-1',
          content: '<p>safe</p>',
          settings: JSON.stringify(settings),
          image: JSON.stringify(media),
        },
      ]),
      updateMedia: vi.fn().mockResolvedValue(media),
    };
    const integrationManager = new IntegrationManager();
    vi.spyOn(integrationManager, 'getSocialIntegration').mockReturnValue(
      provider as any
    );
    const activity = new PostActivity(
      postService as any,
      {} as any,
      integrationManager,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await expect(
      activity.postSocial(
        {
          id: 'integration-1',
          internalId: 'profile',
          token: 'token',
          providerIdentifier: 'youtube',
          organizationId: 'org-1',
        } as any,
        [{ id: 'post-1' } as any]
      )
    ).rejects.toThrow(/blocked remote media/i);
    expect(provider.post).not.toHaveBeenCalled();
    expect(provider.comment).not.toHaveBeenCalled();
  });

  it.each([
    [
      'youtube',
      {
        title: 'Safe title',
        thumbnail: { path: 'https://app.example.test/uploads/thumb.jpg' },
      },
      'https://app.example.test/uploads/thumb.jpg',
    ],
    [
      'wordpress',
      {
        title: 'Fixture title',
        type: 'post',
        main_image: { path: 'https://cdn.example.test/main.jpg' },
      },
      'https://cdn.example.test/main.jpg',
    ],
  ] as const)(
    'publishes with an authorized safe %s secondary source',
    async (providerIdentifier, settings, secondaryPath) => {
      vi.stubEnv('STRIPE_SECRET_KEY', '');
      vi.stubEnv('FRONTEND_URL', 'https://app.example.test');
      vi.stubEnv('STORAGE_PROVIDER', 'local');
      vi.mocked(authorizeMediaSource).mockClear();
      const media = [
        providerIdentifier === 'wordpress'
          ? {
              path: 'https://media.example.test/primary.jpg',
              type: 'image' as const,
            }
          : {
              path: 'https://media.example.test/primary.mp4',
              type: 'video' as const,
            },
      ];
      const provider = {
        post: vi.fn().mockResolvedValue([]),
        editor: 'normal' as const,
        mentionFormat: undefined,
        convertToJPEG: false,
        maxLength: vi.fn().mockReturnValue(40_000),
      };
      const postService = {
        updateTags: vi.fn().mockResolvedValue([
          {
            id: 'post-1',
            content: '<p>safe</p>',
            settings: JSON.stringify(settings),
            image: JSON.stringify(media),
          },
        ]),
        updateMedia: vi.fn().mockResolvedValue(media),
      };
      const integrationManager = new IntegrationManager();
      vi.spyOn(integrationManager, 'getSocialIntegration').mockReturnValue(
        provider as any
      );
      const activity = new PostActivity(
        postService as any,
        {} as any,
        integrationManager,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      );

      await activity.postSocial(
        {
          id: 'integration-1',
          internalId: 'profile',
          token: 'token',
          providerIdentifier,
          organizationId: 'org-1',
        } as any,
        [{ id: 'post-1' } as any]
      );

      expect(authorizeMediaSource).toHaveBeenCalledWith(secondaryPath);
      expect(provider.post).toHaveBeenCalledOnce();
    }
  );

  it('uses real updateMedia output to reject a forged TikTok video type', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const provider = {
      post: vi.fn().mockResolvedValue([]),
      checkValidity: vi.fn().mockResolvedValue(true),
      maxLength: vi.fn().mockReturnValue(2_200),
      editor: 'normal' as const,
      mentionFormat: undefined,
      convertToJPEG: false,
    };
    const repository = { updateImages: vi.fn() };
    const integrationManager = new IntegrationManager();
    vi.spyOn(integrationManager, 'getSocialIntegration').mockReturnValue(
      provider as any
    );
    const postService = new PostsService(
      repository as any,
      integrationManager,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    vi.spyOn(postService, 'updateTags').mockResolvedValue([
      {
        id: 'post-1',
        content: 'a'.repeat(3_000),
        settings: '{}',
        image: JSON.stringify([
          {
            path: 'https://media.test/actual-video.MP4?download=1',
            type: 'image',
          },
        ]),
      } as any,
    ]);
    const activity = new PostActivity(
      postService,
      {} as any,
      integrationManager,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await expect(
      activity.postSocial(
        {
          id: 'integration-1',
          internalId: 'profile',
          token: 'token',
          providerIdentifier: 'tiktok',
          organizationId: 'org-1',
        } as any,
        [{ id: 'post-1' } as any]
      )
    ).rejects.toThrow('Caption exceeds the 2200-UTF-16-code-unit limit.');
    expect(provider.post).not.toHaveBeenCalled();
  });

  it.each(['post', 'comment'] as const)(
    'blocks provider %s when a TikTok conversion targets metadata media',
    async (method) => {
      vi.stubEnv('STRIPE_SECRET_KEY', '');
      const provider = {
        post: vi.fn().mockResolvedValue([]),
        comment: vi.fn().mockResolvedValue([]),
        checkValidity: vi.fn().mockResolvedValue(true),
        maxLength: vi.fn().mockReturnValue(2_200),
        editor: 'normal' as const,
        convertToJPEG: true,
      };
      const integrationManager = new IntegrationManager();
      vi.spyOn(integrationManager, 'getSocialIntegration').mockReturnValue(
        provider as any
      );
      const postService = new PostsService(
        { updateImages: vi.fn() } as any,
        integrationManager,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      );
      vi.spyOn(postService, 'updateTags').mockResolvedValue([
        {
          id: 'post-1',
          content: '<p>safe content</p>',
          settings: '{}',
          image: JSON.stringify([
            {
              path: 'http://169.254.169.254/latest/meta-data/photo.png',
              type: 'video',
            },
          ]),
        } as any,
      ]);
      const activity = new PostActivity(
        postService,
        {} as any,
        integrationManager,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      );
      const integration = {
        id: 'integration-1',
        internalId: 'profile',
        token: 'token',
        providerIdentifier: 'tiktok',
        organizationId: 'org-1',
      } as any;

      const request =
        method === 'post'
          ? activity.postSocial(integration, [{ id: 'post-1' } as any])
          : activity.postComment('remote-post', undefined, integration, [
              { id: 'post-1' } as any,
            ]);

      await expect(request).rejects.toThrow(/blocked remote media/i);
      expect(provider.post).not.toHaveBeenCalled();
      expect(provider.comment).not.toHaveBeenCalled();
    }
  );
});
