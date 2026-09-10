import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLICATION_SECONDARY_MEDIA_SOURCE_FIELDS } from '../../../../../apps/orchestrator/src/activities/publication.media.sources';

const sources: Array<[string, RegExp[]]> = [
  ['bluesky.provider.ts', [/axios\.get\(url/, /fetch\(url\)/]],
  ['discord.provider.ts', [/fetch\(media\.path\)/]],
  ['dribbble.provider.ts', [/axios\.get\([\s\S]*?media\?\.\[0\]\?\.path/]],
  ['mastodon.provider.ts', [/fetch\(fileUrl/]],
  ['max.provider.ts', [/fetch\(url\)/]],
  ['mewe.provider.ts', [/fetch\(mediaPath\)/]],
  ['pinterest.provider.ts', [/axios\.get\([\s\S]*?media\?\.\[0\]\?\.path/]],
  ['reddit.provider.ts', [/axios\.get\(path/]],
  ['skool.provider.ts', [/fetch\(item\.path\)/]],
  ['tiktok.provider.ts', [/fetch\(path, \{ method: 'HEAD'/, /fetch\(path, \{/]],
  ['tumblr.provider.ts', [/axios\.get\(this\.getMediaUrl\(item\.path\)/]],
  ['vk.provider.ts', [/axios\.get\(media\.path/]],
  ['vk.group.provider.ts', [/axios\.get\(media\.path/]],
  ['whop.provider.ts', [/fetch\(item\.path\)/]],
  ['wordpress.provider.ts', [/const blob = await this\.fetch/]],
  [
    'youtube.provider.ts',
    [/url: firstPost\?\.media/, /url: settings\?\.thumbnail/],
  ],
];

describe('social adapter MediaSource contract', () => {
  it.each(sources)(
    '%s has no raw attacker-influenced source download',
    (file, forbidden) => {
      const source = readFileSync(resolve(__dirname, file), 'utf8');
      for (const pattern of forbidden) expect(source).not.toMatch(pattern);
    }
  );

  it.each([
    [
      'reddit.provider.ts',
      'readMediaSourceBuffer(path)',
      "this.fetch(\n        'https://oauth.reddit.com/api/media/asset'",
    ],
    [
      'pinterest.provider.ts',
      'withMediaSourceStream(',
      "this.fetch('https://api.pinterest.com/v5/media'",
    ],
    [
      'vk.provider.ts',
      'withMediaSourceStream(',
      'await this.fetch(\n                    isVideo',
    ],
    [
      'vk.group.provider.ts',
      'withMediaSourceStream(',
      "this.callPhotoVk<unknown>(\n      'photos.getWallUploadServer'",
    ],
  ])(
    '%s authorizes/acquires its source before requesting a provider upload slot',
    (file, sourceBoundary, providerInit) => {
      const source = readFileSync(resolve(__dirname, file), 'utf8');
      expect(source.indexOf(sourceBoundary)).toBeGreaterThanOrEqual(0);
      expect(source.indexOf(providerInit)).toBeGreaterThanOrEqual(0);
      expect(source.indexOf(sourceBoundary)).toBeLessThan(
        source.indexOf(providerInit)
      );
    }
  );

  it('acquires Discord comment attachments before creating a thread', () => {
    const source = readFileSync(
      resolve(__dirname, 'discord.provider.ts'),
      'utf8'
    ).split('async comment(', 2)[1];
    expect(source.indexOf('readMediaSourceBuffer(')).toBeLessThan(
      source.indexOf('/threads`')
    );
  });

  it('acquires the YouTube thumbnail before uploading the destination video', () => {
    const source = readFileSync(
      resolve(__dirname, 'youtube.provider.ts'),
      'utf8'
    );
    expect(
      source.indexOf('readMediaSourceBuffer(settings.thumbnail.path')
    ).toBeGreaterThanOrEqual(0);
    expect(
      source.indexOf('readMediaSourceBuffer(settings.thumbnail.path')
    ).toBeLessThan(source.indexOf('youtubeClient.videos.insert'));
  });

  it.each([
    'dribbble.provider.ts',
    'pinterest.provider.ts',
    'vk.provider.ts',
    'vk.group.provider.ts',
  ])('%s supplies known source length to multipart form-data', (file) => {
    const source = readFileSync(resolve(__dirname, file), 'utf8');
    expect(source).toMatch(/knownLength:\s*size/);
  });

  it('registers every adapter secondary source field read by the server', () => {
    const detected = new Set<string>();
    const directory = resolve(__dirname);
    for (const file of readdirSync(directory).filter((name) =>
      name.endsWith('.provider.ts')
    )) {
      const source = readFileSync(resolve(directory, file), 'utf8');
      const providerIdentifier = file.replace('.provider.ts', '');
      if (
        /(?:readMediaSourceBuffer|readOrFetch|withMediaSourceStream|getMediaSourceMetadata|withMediaSourceRange)/.test(
          source
        )
      ) {
        for (const match of source.matchAll(
          /settings\s*(?:\?\.|\.)\s*([a-z_]\w*)\s*(?:\?\.|\.)\s*path/gi
        )) {
          detected.add(`${providerIdentifier}:settings:${match[1]}`);
        }
      }
      if (/getImageDimensions|readMediaSourceBuffer/.test(source)) {
        for (const match of source.matchAll(
          /(?:post\.)?media(?:\?\.)?(?:\[\d+\])?(?:\?\.)?\.thumbnail\b/g
        )) {
          detected.add(`${providerIdentifier}:media:thumbnail`);
        }
      }
    }

    const registered = new Set(
      PUBLICATION_SECONDARY_MEDIA_SOURCE_FIELDS.map(
        ({ providerIdentifier, container, field }) =>
          `${providerIdentifier}:${container}:${field}`
      )
    );
    expect([...detected].sort()).toEqual([...registered].sort());
  });
});
