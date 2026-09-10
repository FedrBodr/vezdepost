import { describe, expect, it } from 'vitest';
import {
  PUBLICATION_SECONDARY_MEDIA_SOURCE_FIELDS,
  collectPublicationMediaSourcePaths,
} from './publication.media.sources';

describe('publication media source collector', () => {
  it.each([
    [
      'youtube',
      { thumbnail: { path: 'https://cdn.test/youtube-thumbnail.jpg' } },
      [{ path: 'primary.mp4', type: 'video' }],
      ['primary.mp4', 'https://cdn.test/youtube-thumbnail.jpg'],
    ],
    [
      'wordpress',
      { main_image: { path: 'https://cdn.test/wordpress-main.jpg' } },
      [{ path: 'primary.jpg', type: 'image' }],
      ['primary.jpg', 'https://cdn.test/wordpress-main.jpg'],
    ],
    [
      'reddit',
      {},
      [
        {
          path: 'primary.mp4',
          type: 'video',
          thumbnail: 'https://cdn.test/reddit-thumbnail.jpg',
        },
      ],
      ['primary.mp4', 'https://cdn.test/reddit-thumbnail.jpg'],
    ],
    [
      'tumblr',
      {},
      [
        {
          path: 'primary.mp4',
          type: 'video',
          thumbnail: 'https://cdn.test/tumblr-thumbnail.jpg',
        },
      ],
      ['primary.mp4', 'https://cdn.test/tumblr-thumbnail.jpg'],
    ],
  ] as const)(
    'collects the registered %s secondary source without recursing through settings',
    (providerIdentifier, settings, media, expected) => {
      expect(
        collectPublicationMediaSourcePaths({
          providerIdentifier,
          settings,
          media: media as any,
        })
      ).toEqual(expected);
    }
  );

  it.each([
    ['youtube', { thumbnail: null }, [{ path: 'primary.mp4' }]],
    ['youtube', { thumbnail: 'not-media' }, [{ path: 'primary.mp4' }]],
    ['wordpress', { main_image: {} }, [{ path: 'primary.jpg' }]],
    [
      'reddit',
      {},
      [{ path: 'primary.mp4', thumbnail: { path: 'nested.jpg' } }],
    ],
    ['tumblr', {}, [{ path: 'primary.mp4', thumbnail: '' }]],
  ] as const)(
    'rejects malformed registered secondary shape for %s',
    (providerIdentifier, settings, media) => {
      expect(() =>
        collectPublicationMediaSourcePaths({
          providerIdentifier,
          settings,
          media: media as any,
        })
      ).toThrow(/invalid secondary media source/i);
    }
  );

  it('ignores arbitrary URL-looking settings and provider-pull cover fields', () => {
    expect(
      collectPublicationMediaSourcePaths({
        providerIdentifier: 'hashnode',
        settings: {
          main_image: { path: 'https://provider-pull.test/cover.jpg' },
          callback: 'http://169.254.169.254/latest/meta-data',
          nested: { thumbnail: { path: 'https://ignored.test/image.jpg' } },
        },
        media: [{ path: 'primary.jpg', type: 'image' }],
      })
    ).toEqual(['primary.jpg']);
  });

  it('keeps the reviewed server-read field inventory explicit', () => {
    expect(PUBLICATION_SECONDARY_MEDIA_SOURCE_FIELDS).toEqual([
      {
        providerIdentifier: 'youtube',
        container: 'settings',
        field: 'thumbnail',
      },
      {
        providerIdentifier: 'wordpress',
        container: 'settings',
        field: 'main_image',
      },
      {
        providerIdentifier: 'reddit',
        container: 'media',
        field: 'thumbnail',
      },
      {
        providerIdentifier: 'tumblr',
        container: 'media',
        field: 'thumbnail',
      },
    ]);
  });
});
