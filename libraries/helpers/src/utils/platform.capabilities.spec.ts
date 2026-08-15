import { describe, expect, it } from 'vitest';
import {
  getPlatformCapabilities,
  intersectPlatformCapabilities,
} from './platform.capabilities';

describe('platform capability registry', () => {
  it('describes the seven active destinations with backend limits', () => {
    expect(getPlatformCapabilities('telegram').text).toEqual({
      max: 4096,
      mediaCaptionMax: 1024,
    });
    expect(getPlatformCapabilities('max').text.max).toBe(4000);
    expect(getPlatformCapabilities('linkedin').text.max).toBe(3000);
    expect(getPlatformCapabilities('tumblr').text.max).toBe(32768);
    expect(getPlatformCapabilities('pinterest').text.max).toBe(500);
    expect(getPlatformCapabilities('vk').text.max).toBe(16384);
    expect(getPlatformCapabilities('vk-group').text.max).toBe(16384);
  });

  it('uses a conservative fallback for an unaudited provider', () => {
    expect(
      getPlatformCapabilities('unknown', {
        editor: 'markdown',
        maximumCharacters: 700,
      })
    ).toMatchObject({
      identifier: 'unknown',
      verified: false,
      output: 'markdown',
      text: { max: 700 },
      formatting: {
        bold: 'native',
        underline: 'native',
        links: 'native',
        lists: 'native',
        headings: 'native',
      },
      delivery: {
        longMediaText: 'not-applicable',
        stripRawUrls: false,
      },
    });
  });

  it('models raw URL stripping explicitly for legacy providers', () => {
    expect(
      getPlatformCapabilities('x', {
        editor: 'normal',
        maximumCharacters: 280,
        stripRawUrls: true,
      }).delivery.stripRawUrls
    ).toBe(true);
    expect(getPlatformCapabilities('telegram').delivery.stripRawUrls).toBe(
      false
    );
  });

  it('intersects selected platforms and keeps the strictest limit', () => {
    const universal = intersectPlatformCapabilities([
      getPlatformCapabilities('telegram'),
      getPlatformCapabilities('vk'),
    ]);

    expect(universal.identifier).toBe('universal');
    expect(universal.text.max).toBe(4096);
    expect(universal.formatting.bold).toBe('unicode');
    expect(universal.formatting.links).toBe('unsupported');
    expect(universal.delivery.stripRawUrls).toBe(false);
  });

  it('intersects URL removal when any selected platform strips raw URLs', () => {
    const universal = intersectPlatformCapabilities([
      getPlatformCapabilities('telegram'),
      getPlatformCapabilities('x', {
        editor: 'normal',
        maximumCharacters: 280,
        stripRawUrls: true,
      }),
    ]);

    expect(universal.delivery.stripRawUrls).toBe(true);
  });
});
