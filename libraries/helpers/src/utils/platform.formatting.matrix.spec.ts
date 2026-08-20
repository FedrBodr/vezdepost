import { describe, expect, it } from 'vitest';
import { analyzePlatformContentV2 } from './platform.content.analysis';
import { resolvePlatformCapabilityV2 } from './platform.capability.resolver';
import { MaxProvider } from '@gitroom/nestjs-libraries/integrations/social/max.provider';
import { TumblrProvider } from '@gitroom/nestjs-libraries/integrations/social/tumblr.provider';
import { VkGroupProvider } from '@gitroom/nestjs-libraries/integrations/social/vk.group.provider';

const active = [
  'telegram',
  'max',
  'linkedin',
  'tumblr',
  'pinterest',
  'vk',
  'vk-group',
];
const canonical =
  '<h1>Launch</h1><p><strong>Bold</strong> and <u>underlined</u></p><ul><li>One</li><li>Two</li></ul>';

describe.each(active)('%s formatting matrix', (identifier) => {
  it('normalizes deterministically and stays under its configured limit', () => {
    const media =
      identifier === 'pinterest' ? [{ type: 'image' as const }] : [];
    const settings = identifier === 'pinterest' ? { board: 'board' } : {};
    const capability = resolvePlatformCapabilityV2({
      identifier,
      settings,
      media,
    });
    const analysis = analyzePlatformContentV2({
      canonicalHtml: canonical,
      settings,
      media,
      capability,
    });
    const field = capability.fields.find(
      ({ source }) => source === 'canonical-editor'
    )!;
    expect(analysis.fields[field.key].value).toMatchSnapshot();
    expect(
      analysis.diagnostics.filter((item) => item.severity === 'error')
    ).toEqual([]);
  });
});

it.each([
  ['telegram', 4096],
  ['max', 4000],
  ['linkedin', 3000],
  ['tumblr', 32768],
  ['pinterest', 500],
  ['vk', 16384],
  ['vk-group', 16384],
] as const)('%s accepts its limit and rejects limit + 1', (identifier, max) => {
  const media = identifier === 'pinterest' ? [{ type: 'image' as const }] : [];
  const capability = resolvePlatformCapabilityV2({
    identifier,
    settings: identifier === 'pinterest' ? { board: 'board' } : {},
    media,
  });
  expect(
    analyzePlatformContentV2({
      canonicalHtml: `<p>${'a'.repeat(max)}</p>`,
      settings: identifier === 'pinterest' ? { board: 'board' } : {},
      media,
      capability,
    }).blocking
  ).toBe(false);
  expect(
    analyzePlatformContentV2({
      canonicalHtml: `<p>${'a'.repeat(max + 1)}</p>`,
      settings: identifier === 'pinterest' ? { board: 'board' } : {},
      media,
      capability,
    }).diagnostics
  ).toContainEqual(expect.objectContaining({ code: 'text-too-long' }));
});

it('splits a Telegram media caption only above 1024 visible characters', () => {
  const media = [{ type: 'image' as const }];
  const capability = resolvePlatformCapabilityV2({
    identifier: 'telegram',
    settings: {},
    media,
  });
  expect(
    analyzePlatformContentV2({
      canonicalHtml: `<p>${'a'.repeat(1024)}</p>`,
      settings: {},
      media,
      capability,
    }).diagnostics
  ).not.toContainEqual(expect.objectContaining({ code: 'media-text-split' }));
  expect(
    analyzePlatformContentV2({
      canonicalHtml: `<p>${'a'.repeat(1025)}</p>`,
      settings: {},
      media,
      capability,
    }).diagnostics
  ).toContainEqual(expect.objectContaining({ code: 'media-text-split' }));
});

it('keeps detailed media rules in providers', async () => {
  expect(
    await new MaxProvider().checkValidity([
      [{ path: 'clip.mp4', type: 'video' }],
    ])
  ).toBe('Video posting to MAX is not supported yet.');

  expect(
    await new TumblrProvider().checkValidity([
      Array.from({ length: 31 }, (_, index) => ({
        path: `image-${index}.jpg`,
        type: 'image' as const,
      })),
    ])
  ).toBe('Tumblr supports up to 30 images in one post.');

  expect(
    await new VkGroupProvider().checkValidity([
      Array.from({ length: 11 }, (_, index) => ({
        path: `image-${index}.jpg`,
        type: 'image' as const,
      })),
    ])
  ).toBe('VK Group supports up to 10 photographs per post.');
});
