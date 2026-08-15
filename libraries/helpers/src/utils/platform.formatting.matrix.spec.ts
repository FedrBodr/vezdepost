import { describe, expect, it } from 'vitest';
import { getPlatformCapabilities } from './platform.capabilities';
import { analyzePlatformContent } from './platform.content';
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
    const analysis = analyzePlatformContent({
      content: canonical,
      media: identifier === 'pinterest' ? [{ type: 'image' }] : [],
      capabilities: getPlatformCapabilities(identifier),
    });
    expect(analysis.normalized).toMatchSnapshot();
    expect(
      analysis.messages.filter((item) => item.severity === 'error')
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
  const capabilities = getPlatformCapabilities(identifier);
  const media = identifier === 'pinterest' ? [{ type: 'image' as const }] : [];
  expect(
    analyzePlatformContent({
      content: `<p>${'a'.repeat(max)}</p>`,
      media,
      capabilities,
    }).blocking
  ).toBe(false);
  expect(
    analyzePlatformContent({
      content: `<p>${'a'.repeat(max + 1)}</p>`,
      media,
      capabilities,
    }).messages
  ).toContainEqual(expect.objectContaining({ code: 'text-too-long' }));
});

it('splits a Telegram media caption only above 1024 visible characters', () => {
  const capabilities = getPlatformCapabilities('telegram');
  expect(
    analyzePlatformContent({
      content: `<p>${'a'.repeat(1024)}</p>`,
      media: [{ type: 'image' }],
      capabilities,
    }).messages
  ).not.toContainEqual(expect.objectContaining({ code: 'media-text-split' }));
  expect(
    analyzePlatformContent({
      content: `<p>${'a'.repeat(1025)}</p>`,
      media: [{ type: 'image' }],
      capabilities,
    }).messages
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
