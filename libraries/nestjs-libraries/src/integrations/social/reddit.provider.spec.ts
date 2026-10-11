import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RedditProvider } from './reddit.provider';
import {
  authorizeMediaSource,
  readMediaSourceBuffer,
} from '@gitroom/helpers/utils/media.source';

vi.mock('@gitroom/helpers/utils/media.source', () => ({
  authorizeMediaSource: vi.fn(async () => undefined),
  readMediaSourceBuffer: vi.fn(async () => Buffer.from('primary-video')),
}));

const thumbnailPath = 'https://redirect.example.test/thumbnail.jpg';
const primaryPath = 'https://cdn.example.test/video.mp4';
const mediaPost = (media: Record<string, unknown>) =>
  ({
    id: 'post-1',
    message: 'safe',
    settings: {
      subreddit: [
        {
          value: {
            type: 'media',
            title: 'Title',
            subreddit: '/r/testing',
          },
        },
      ],
    },
    media: [media],
  } as any);

describe('RedditProvider secondary media ordering', () => {
  let provider: RedditProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authorizeMediaSource).mockResolvedValue(undefined);
    provider = new RedditProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops before any provider call when the video thumbnail is not an allowed source', async () => {
    vi.mocked(authorizeMediaSource).mockRejectedValue(
      new Error('Invalid media source')
    );
    const providerFetch = vi.spyOn(provider, 'fetch');

    await expect(
      provider.postPending('profile', 'token', [
        mediaPost({
          type: 'video',
          path: primaryPath,
          thumbnail: thumbnailPath,
        }),
      ])
    ).rejects.toThrow('Invalid media source');

    expect(authorizeMediaSource).toHaveBeenCalledWith(thumbnailPath);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('defers every upload to finalizePost, carrying the media paths', async () => {
    const providerFetch = vi.spyOn(provider, 'fetch');

    const [response] = await provider.postPending('profile', 'token', [
      mediaPost({
        type: 'video',
        path: primaryPath,
        thumbnail: thumbnailPath,
      }),
    ]);

    expect(response.status).toBe('pending');
    expect(response.pendingData).toMatchObject({
      mediaPath: primaryPath,
      mediaThumbnail: thumbnailPath,
      cursor: 0,
    });
    expect(readMediaSourceBuffer).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('checks the source before requesting an upload slot', async () => {
    vi.spyOn(provider as any, 'mediaSize').mockRejectedValue(
      new Error('Remote media body download aborted by timeout')
    );
    const providerFetch = vi.spyOn(provider, 'fetch');

    await expect(
      (provider as any).uploadFileToReddit('token', primaryPath)
    ).rejects.toThrow(/aborted by timeout/);

    expect(providerFetch).not.toHaveBeenCalled();
  });
});

const integration = { token: 'access-token' } as never;
const redditSettings = {
  subreddit: [{ value: { subreddit: '/r/testing', type: 'self' } }],
};

describe('RedditProvider.fetchCapabilityRuntime', () => {
  let provider: RedditProvider;

  beforeEach(() => {
    provider = new RedditProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps a stricter title_required_max into a trusted title overlay', async () => {
    const providerFetch = vi
      .spyOn(provider, 'fetch')
      .mockResolvedValue({
        json: async () => ({ title_required_max: 40 }),
      } as Response);

    const overlay = await provider.fetchCapabilityRuntime(
      integration,
      redditSettings
    );

    expect(providerFetch).toHaveBeenCalledWith(
      'https://oauth.reddit.com/api/v1/testing/post_requirements',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
        }),
      }),
      'reddit',
      0,
      false
    );
    expect(overlay).toMatchObject({
      textLimits: {
        title: { max: 40, unit: 'utf16-code-units', source: 'runtime' },
      },
    });
    expect(Number.isFinite(Date.parse(overlay!.observedAt))).toBe(true);
  });

  it('returns undefined when the requirements fetch rejects', async () => {
    vi.spyOn(provider, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(
      provider.fetchCapabilityRuntime(integration, redditSettings)
    ).resolves.toBeUndefined();
  });

  it('returns undefined without fetching when no subreddit is configured', async () => {
    const providerFetch = vi.spyOn(provider, 'fetch').mockRejectedValue(
      new Error('must not be called')
    );

    await expect(
      provider.fetchCapabilityRuntime(integration, {})
    ).resolves.toBeUndefined();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['plain string subreddit', { subreddit: '/r/testing' }],
    ['array of strings', { subreddit: ['/r/testing'] }],
    ['string value wrapper', { subreddit: [{ value: '/r/testing' }] }],
    ['bare subreddit name', { subreddit: [{ value: { subreddit: 'Testing' } }] }],
  ] as const)('extracts the subreddit from %s', async (_label, settings) => {
    const providerFetch = vi
      .spyOn(provider, 'fetch')
      .mockResolvedValue({
        json: async () => ({ title_required_max: 40 }),
      } as Response);

    const overlay = await provider.fetchCapabilityRuntime(
      integration,
      settings
    );

    expect(overlay).toMatchObject({
      textLimits: {
        title: { max: 40, unit: 'utf16-code-units', source: 'runtime' },
      },
    });
    expect(providerFetch).toHaveBeenCalledWith(
      'https://oauth.reddit.com/api/v1/testing/post_requirements',
      expect.anything(),
      'reddit',
      0,
      false
    );
  });

  it('applies the strictest title maximum across all configured subreddits', async () => {
    const providerFetch = vi
      .spyOn(provider, 'fetch')
      .mockImplementation(async (url) =>
        ({
          json: async () => ({
            title_required_max: String(url).includes('/first/') ? 40 : 60,
          }),
        }) as Response
      );

    const overlay = await provider.fetchCapabilityRuntime(integration, {
      subreddit: [
        { value: { subreddit: '/r/second', type: 'self' } },
        { value: { subreddit: '/r/first', type: 'self' } },
      ],
    });

    expect(overlay?.textLimits?.title).toMatchObject({
      max: 40,
      unit: 'utf16-code-units',
      source: 'runtime',
    });
    expect(providerFetch).toHaveBeenCalledTimes(2);
    expect(providerFetch.mock.calls.map(([url]) => url)).toEqual([
      'https://oauth.reddit.com/api/v1/second/post_requirements',
      'https://oauth.reddit.com/api/v1/first/post_requirements',
    ]);
  });

  it('skips a failing subreddit instead of dropping the whole overlay', async () => {
    const providerFetch = vi
      .spyOn(provider, 'fetch')
      .mockImplementation(async (url) => {
        if (String(url).includes('/broken/')) {
          throw new Error('subreddit unavailable');
        }
        return {
          json: async () => ({ title_required_max: 60 }),
        } as Response;
      });

    const overlay = await provider.fetchCapabilityRuntime(integration, {
      subreddit: [
        { value: { subreddit: '/r/broken', type: 'self' } },
        { value: { subreddit: '/r/healthy', type: 'self' } },
      ],
    });

    expect(overlay?.textLimits?.title).toMatchObject({ max: 60 });
    expect(providerFetch).toHaveBeenCalledTimes(2);
  });

  it('returns undefined when every configured subreddit fails', async () => {
    vi.spyOn(provider, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(
      provider.fetchCapabilityRuntime(integration, {
        subreddit: [
          { value: { subreddit: '/r/broken', type: 'self' } },
          { value: { subreddit: '/r/also-broken', type: 'self' } },
        ],
      })
    ).resolves.toBeUndefined();
  });

  it('bounds requirements queries to the first ten subreddits', async () => {
    const providerFetch = vi
      .spyOn(provider, 'fetch')
      .mockResolvedValue({
        json: async () => ({ title_required_max: 40 }),
      } as Response);

    const overlay = await provider.fetchCapabilityRuntime(integration, {
      subreddit: Array.from({ length: 12 }, (_unused, index) => ({
        value: { subreddit: `/r/sub${index}`, type: 'self' },
      })),
    });

    expect(providerFetch).toHaveBeenCalledTimes(10);
    expect(
      providerFetch.mock.calls.filter(([url]) =>
        String(url).includes('/sub10/')
      )
    ).toHaveLength(0);
    expect(overlay?.textLimits?.title).toMatchObject({ max: 40 });
  });
});
