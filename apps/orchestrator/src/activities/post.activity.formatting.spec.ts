import { describe, expect, it, vi } from 'vitest';
import { PostActivity } from './post.activity';
import { getPlatformCapabilities } from '@gitroom/helpers/utils/platform.capabilities';

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
          image: '[]',
        },
      ]),
      updateMedia: vi.fn().mockResolvedValue([]),
    };
    const integrationManager = {
      getSocialIntegration: vi.fn().mockReturnValue(provider),
      getCapabilities: vi
        .fn()
        .mockReturnValue(getPlatformCapabilities('telegram')),
    };
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
      [expect.objectContaining({ message: 'Title\n<b>Body</b> Link' })],
      expect.objectContaining({ id: 'integration-1' })
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
    const integrationManager = {
      getSocialIntegration: vi.fn().mockReturnValue(provider),
      getCapabilities: vi
        .fn()
        .mockReturnValue(getPlatformCapabilities('linkedin')),
    };
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
});
