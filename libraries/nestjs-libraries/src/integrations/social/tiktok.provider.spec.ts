import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mediaMocks = vi.hoisted(() => ({
  events: [] as string[],
  getMetadata: vi.fn(),
  withRange: vi.fn(),
}));

vi.mock('@gitroom/helpers/utils/media.source', () => ({
  getMediaSourceMetadata: mediaMocks.getMetadata,
  withMediaSourceRange: mediaMocks.withRange,
}));

import { TiktokProvider } from './tiktok.provider';

const jsonResponse = (body: unknown) =>
  ({ json: vi.fn().mockResolvedValue(body) } as unknown as Response);

describe('TiktokProvider safe ranged video upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mediaMocks.events.length = 0;
    mediaMocks.getMetadata.mockImplementation(async () => {
      mediaMocks.events.push('metadata');
      return {
        size: 4,
        finalUrl: 'https://cdn.example.test/CLIP.MP4?download=1',
        local: false,
      };
    });
    mediaMocks.withRange.mockImplementation(
      async (_path, _options, consume) => {
        mediaMocks.events.push('range');
        return consume({
          stream: Readable.from([Buffer.from([1, 2, 3, 4])]),
          size: 4,
          finalUrl: 'https://cdn.example.test/CLIP.MP4?download=1',
          status: 206,
          headers: new Headers(),
          local: false,
        });
      }
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('authorizes HEAD before init and streams ranges to the byte-identical provider upload URL', async () => {
    const provider = new TiktokProvider();
    const providerUploadUrl =
      'https://upload.tiktok.example/provider-owned?signature=keep-exact';
    vi.spyOn(provider, 'fetch')
      .mockImplementationOnce(async () => {
        mediaMocks.events.push('init');
        return jsonResponse({
          data: { publish_id: 'publish-1', upload_url: providerUploadUrl },
        });
      })
      .mockImplementationOnce(async () => {
        mediaMocks.events.push('status');
        return jsonResponse({
          data: {
            status: 'PUBLISH_COMPLETE',
            publicaly_available_post_id: ['video-1'],
          },
        });
      });
    const uploadFetch = vi.fn(async (url: string) => {
      mediaMocks.events.push('upload');
      expect(url).toBe(providerUploadUrl);
      return { status: 200, text: vi.fn() } as unknown as Response;
    });
    vi.stubGlobal('fetch', uploadFetch);

    await expect(
      provider.post(
        'profile',
        'access-token',
        [
          {
            id: 'post-1',
            message: 'Video',
            media: [
              {
                path: 'https://cdn.example.test/CLIP.MP4?download=1',
                type: 'video',
              },
            ],
            settings: { content_posting_method: 'DIRECT_POST' },
          } as any,
        ],
        { profile: 'creator' } as any
      )
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'post-1',
        postId: 'video-1',
        status: 'success',
      }),
    ]);

    expect(mediaMocks.events).toEqual([
      'metadata',
      'init',
      'range',
      'upload',
      'status',
    ]);
    expect(mediaMocks.withRange).toHaveBeenCalledWith(
      'https://cdn.example.test/CLIP.MP4?download=1',
      { start: 0, end: 3, totalSize: 4, maxBytes: 4 },
      expect.any(Function)
    );
  });
});
