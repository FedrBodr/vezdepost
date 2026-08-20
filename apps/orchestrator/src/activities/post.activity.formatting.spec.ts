import { describe, expect, it, vi } from 'vitest';
import { PostActivity } from './post.activity';
import { getPlatformCapabilities } from '@gitroom/helpers/utils/platform.capabilities';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { resolvePlatformCapabilityV2 } from '@gitroom/helpers/utils/platform.capability.resolver';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';

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
      getPlatformCapabilities('telegram')
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
        getPlatformCapabilities(identifier)
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
      getPlatformCapabilities('linkedin')
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

  it('passes mention-normalized effective URL-stripped posts and comments to transport', async () => {
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
      getPlatformCapabilities('x', {
        editor: 'normal',
        maximumCharacters: 280,
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
      [expect.objectContaining({ message: 'Hello @ada' })],
      expect.objectContaining({ id: 'integration-1' })
    );
    expect(provider.comment).toHaveBeenCalledWith(
      'profile',
      'remote-post',
      'remote-last',
      'token',
      [expect.objectContaining({ message: 'Hello @ada' })],
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
});
