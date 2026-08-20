import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RedditProvider } from './reddit.provider';
import {
  authorizeMediaSource,
  readMediaSourceBuffer,
} from '@gitroom/helpers/utils/media.source';
import {
  SAFE_REMOTE_IMAGE_FETCH_BODY_TIMEOUT_MS,
  SAFE_REMOTE_IMAGE_FETCH_MAX_BYTES,
} from '@gitroom/helpers/utils/ssrf.safe.fetch';

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
    vi.mocked(readMediaSourceBuffer).mockResolvedValue(
      Buffer.from('primary-video')
    );
    provider = new RedditProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops before main-media acquisition when thumbnail materialization fails after authorization', async () => {
    vi.mocked(readMediaSourceBuffer).mockImplementation(async (path) => {
      if (path === thumbnailPath) {
        throw new Error('Remote media body download aborted by timeout');
      }
      return Buffer.from('primary-video');
    });
    const providerFetch = vi
      .spyOn(provider, 'fetch')
      .mockRejectedValue(new Error('provider upload slot invoked'));
    const uploadFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('upload destination invoked'));

    await expect(
      provider.post('profile', 'token', [
        mediaPost({
          type: 'video',
          path: primaryPath,
          thumbnail: thumbnailPath,
        }),
      ])
    ).rejects.toThrow(/body download aborted by timeout/i);

    expect(authorizeMediaSource).toHaveBeenCalledWith(thumbnailPath);
    expect(readMediaSourceBuffer).toHaveBeenCalledOnce();
    expect(readMediaSourceBuffer).toHaveBeenCalledWith(thumbnailPath, {
      maxBytes: SAFE_REMOTE_IMAGE_FETCH_MAX_BYTES,
      bodyTimeoutMs: SAFE_REMOTE_IMAGE_FETCH_BODY_TIMEOUT_MS,
    });
    expect(readMediaSourceBuffer).not.toHaveBeenCalledWith(
      primaryPath,
      expect.anything()
    );
    expect(providerFetch).not.toHaveBeenCalled();
    expect(uploadFetch).not.toHaveBeenCalled();
  });

  it('materializes the thumbnail once before main media and reuses its retained bytes for poster upload', async () => {
    const thumbnail = Buffer.from('retained-thumbnail');
    const primary = Buffer.from('primary-video');
    vi.mocked(readMediaSourceBuffer).mockImplementation(async (path) =>
      path === thumbnailPath ? thumbnail : primary
    );
    const providerFetch = vi
      .spyOn(provider, 'fetch')
      .mockImplementation(async (url) => {
        if (String(url).endsWith('/api/media/asset')) {
          return {
            json: async () => ({
              args: { action: '//uploads.reddit.test/file', fields: [] },
            }),
          } as Response;
        }
        throw new Error('stop after uploads');
      });
    const uploaded: Buffer[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const file = (init?.body as FormData).get('file') as Blob;
      uploaded.push(Buffer.from(await file.arrayBuffer()));
      return {
        text: async () =>
          '<Location>https://reddit-upload.test/location</Location>',
      } as Response;
    });

    await expect(
      provider.post('profile', 'token', [
        mediaPost({
          type: 'video',
          path: primaryPath,
          thumbnail: thumbnailPath,
        }),
      ])
    ).rejects.toThrow('stop after uploads');

    expect(authorizeMediaSource).toHaveBeenCalledWith(thumbnailPath);
    expect(
      vi.mocked(readMediaSourceBuffer).mock.calls.map(([path]) => path)
    ).toEqual([thumbnailPath, primaryPath]);
    expect(
      vi
        .mocked(readMediaSourceBuffer)
        .mock.calls.filter(([path]) => path === thumbnailPath)
    ).toHaveLength(1);
    expect(readMediaSourceBuffer).toHaveBeenCalledWith(thumbnailPath, {
      maxBytes: SAFE_REMOTE_IMAGE_FETCH_MAX_BYTES,
      bodyTimeoutMs: SAFE_REMOTE_IMAGE_FETCH_BODY_TIMEOUT_MS,
    });
    expect(uploaded).toEqual([primary, thumbnail]);
    expect(
      providerFetch.mock.calls.filter(([url]) =>
        String(url).endsWith('/api/media/asset')
      )
    ).toHaveLength(2);
  });

  it('preserves image media flow without secondary acquisition', async () => {
    const providerFetch = vi
      .spyOn(provider, 'fetch')
      .mockRejectedValue(new Error('stop at image upload slot'));

    await expect(
      provider.post('profile', 'token', [
        mediaPost({
          type: 'image',
          path: 'https://cdn.example.test/image.jpg',
        }),
      ])
    ).rejects.toThrow('stop at image upload slot');

    expect(authorizeMediaSource).not.toHaveBeenCalled();
    expect(readMediaSourceBuffer).toHaveBeenCalledOnce();
    expect(readMediaSourceBuffer).toHaveBeenCalledWith(
      'https://cdn.example.test/image.jpg'
    );
    expect(providerFetch).toHaveBeenCalledOnce();
  });
});
