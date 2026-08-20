import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RedditProvider } from './reddit.provider';
import {
  authorizeMediaSource,
  readMediaSourceBuffer,
} from '@gitroom/helpers/utils/media.source';

vi.mock('@gitroom/helpers/utils/media.source', () => ({
  authorizeMediaSource: vi.fn(async (path: string) => {
    if (path.includes('169.254.169.254')) {
      throw new Error('Blocked remote media URL');
    }
  }),
  readMediaSourceBuffer: vi.fn(async () => Buffer.from('primary-video')),
}));

describe('RedditProvider secondary media ordering', () => {
  let provider: RedditProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new RedditProvider();
  });

  it('rejects a private video thumbnail before main-media upload initialization', async () => {
    const providerFetch = vi
      .spyOn(provider, 'fetch')
      .mockRejectedValue(new Error('provider upload slot invoked'));

    await expect(
      provider.post('profile', 'token', [
        {
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
          media: [
            {
              type: 'video',
              path: 'https://cdn.example.test/video.mp4',
              thumbnail:
                'http://169.254.169.254/latest/meta-data/thumbnail.jpg',
            },
          ],
        } as any,
      ])
    ).rejects.toThrow(/blocked remote media/i);

    expect(authorizeMediaSource).toHaveBeenCalledWith(
      'http://169.254.169.254/latest/meta-data/thumbnail.jpg'
    );
    expect(readMediaSourceBuffer).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });
});
