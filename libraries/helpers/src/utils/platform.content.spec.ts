import { describe, expect, it } from 'vitest';
import { getPlatformCapabilities } from './platform.capabilities';
import {
  analyzePlatformContent,
  analyzeSelectedPlatformContent,
  normalizePlatformContent,
} from './platform.content';

describe('platform content normalization', () => {
  it('normalizes Telegram to its supported HTML subset', () => {
    expect(
      normalizePlatformContent(
        '<h1>Title</h1><p><strong>Bold</strong> <a href="https://x.test">Link</a></p>',
        getPlatformCapabilities('telegram')
      )
    ).toBe('Title\n<b>Bold</b> Link\n');
  });

  it('keeps Telegram normalization idempotent', () => {
    const once = normalizePlatformContent(
      '<p><strong>Bold</strong></p>',
      getPlatformCapabilities('telegram')
    );
    expect(
      normalizePlatformContent(once, getPlatformCapabilities('telegram'))
    ).toBe(once);
  });

  it('reports Telegram long-media split as information', () => {
    const analysis = analyzePlatformContent({
      content: `<p>${'a'.repeat(1025)}</p>`,
      media: [{ type: 'image' }],
      capabilities: getPlatformCapabilities('telegram'),
    });
    expect(analysis.messages).toContainEqual(
      expect.objectContaining({
        severity: 'information',
        code: 'media-text-split',
      })
    );
    expect(analysis.blocking).toBe(false);
  });

  it('blocks required Pinterest media and hard text overflow', () => {
    const analysis = analyzePlatformContent({
      content: `<p>${'a'.repeat(501)}</p>`,
      media: [],
      capabilities: getPlatformCapabilities('pinterest'),
    });
    expect(analysis.messages.map((item) => item.code)).toEqual([
      'text-too-long',
      'media-required',
    ]);
    expect(analysis.blocking).toBe(true);
  });

  it('uses X weighted length for double-weight characters', () => {
    const analysis = analyzePlatformContent({
      content: `<p>${'界'.repeat(141)}</p>`,
      media: [],
      capabilities: getPlatformCapabilities('x', {
        editor: 'normal',
        maximumCharacters: 280,
      }),
    });

    expect(analysis.visibleLength).toBe(282);
    expect(analysis.messages).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'text-too-long',
      })
    );
    expect(analysis.blocking).toBe(true);
  });

  it('retains platform identity when universal content has platform-specific delivery', () => {
    const analyses = analyzeSelectedPlatformContent({
      content: `<p>${'a'.repeat(1025)}</p>`,
      media: [{ type: 'image' }],
      capabilities: [
        getPlatformCapabilities('telegram'),
        getPlatformCapabilities('vk'),
      ],
    });
    expect(analyses.messages).toContainEqual(
      expect.objectContaining({
        platform: 'telegram',
        code: 'media-text-split',
      })
    );
  });
});
