import { describe, expect, it, vi } from 'vitest';
import { getPlatformCapabilities } from './platform.capabilities';
import {
  analyzePlatformContent,
  analyzeSelectedPlatformContent,
  normalizePlatformContent,
} from './platform.content';

describe('platform content normalization', () => {
  it.each(['linkedin', 'vk'])(
    '%s preserves adjacent heading boundaries and inline fallback formatting',
    (identifier) => {
      expect(
        normalizePlatformContent(
          '<h1>One <strong>Bold</strong></h1><h2>Two <u>Under</u> <a href="https://x.test">Label</a></h2>',
          getPlatformCapabilities(identifier)
        )
      ).toBe('One 𝗕𝗼𝗹𝗱\nTwo U̲n̲d̲e̲r̲ https://x.test');
    }
  );

  it.each(['linkedin', 'vk'])(
    '%s preserves explicit break boundaries without leaking HTML',
    (identifier) => {
      const normalized = normalizePlatformContent(
        '<p>First<br>Second <strong>Bold</strong></p>',
        getPlatformCapabilities(identifier)
      );

      expect(normalized).toBe('First\nSecond 𝗕𝗼𝗹𝗱');
      expect(normalized).not.toMatch(/<\/?(?:p|br|strong)\b/i);
    }
  );

  it.each(['telegram', 'max'])(
    '%s preserves readable list boundaries',
    (identifier) => {
      const normalized = normalizePlatformContent(
        '<h2>Heading</h2><p>Intro<br>continued</p><ul><li>One</li><li><strong>Two</strong></li></ul><p>Last</p>',
        getPlatformCapabilities(identifier)
      );

      expect(normalized).toContain('Heading\nIntro\ncontinued\n- One\n- ');
      expect(normalized).toContain('Two');
      expect(normalized).toMatch(/\nLast$/);
    }
  );

  it.each(['wordpress', 'listmonk'])(
    '%s preserves the legacy HTML fallback subset',
    (identifier) => {
      const content =
        '<h1>Title</h1><h2>Subtitle</h2><h3>Detail</h3><ul><li>One</li><li><strong>Two</strong></li></ul><p>Body</p>';

      expect(
        normalizePlatformContent(
          content,
          getPlatformCapabilities(identifier, {
            editor: 'html',
            maximumCharacters: 100_000,
          })
        )
      ).toBe(content);
    }
  );

  it.each([
    ['telegram', undefined],
    ['linkedin', undefined],
    ['legacy-html', { editor: 'html' as const, maximumCharacters: 1000 }],
    ['legacy-normal', { editor: 'normal' as const, maximumCharacters: 1000 }],
    [
      'legacy-markdown',
      { editor: 'markdown' as const, maximumCharacters: 1000 },
    ],
    ['legacy-none', { editor: 'none' as const, maximumCharacters: 1000 }],
  ])(
    '%s leaves tagless special characters unchanged',
    (identifier, fallback) => {
      const content = 'AT&T < launch > landing &copy;';
      const convertMention = vi.fn(() => '@mention');

      expect(
        normalizePlatformContent(
          content,
          getPlatformCapabilities(identifier, fallback),
          convertMention
        )
      ).toBe(content);
      expect(convertMention).not.toHaveBeenCalled();
    }
  );

  it('analyzes tagless special characters without rewriting them', () => {
    const content = 'AT&T < launch > landing &copy;';
    const analysis = analyzePlatformContent({
      content,
      media: [],
      capabilities: getPlatformCapabilities('linkedin'),
    });

    expect(analysis.normalized).toBe(content);
    expect(analysis.visibleLength).toBe(content.length);
  });

  it('normalizes Telegram to its supported HTML subset', () => {
    expect(
      normalizePlatformContent(
        '<h1>Title</h1><p><strong>Bold</strong> <a href="https://x.test">Link</a></p>',
        getPlatformCapabilities('telegram')
      )
    ).toBe('Title\n<b>Bold</b> Link');
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

  it('aligns duplicate provider diagnostics with exact target integration IDs', () => {
    const analyses = analyzeSelectedPlatformContent({
      content: `<p>${'a'.repeat(501)}</p>`,
      media: [],
      capabilities: [
        getPlatformCapabilities('pinterest'),
        getPlatformCapabilities('pinterest'),
      ],
      targetIntegrationIds: ['pinterest-first', 'pinterest-second'],
    });

    expect(
      analyses.messages
        .filter((message) => message.code === 'text-too-long')
        .map((message) => ({
          platform: message.platform,
          targetIntegrationId: message.targetIntegrationId,
        }))
    ).toEqual([
      {
        platform: 'pinterest',
        targetIntegrationId: 'pinterest-first',
      },
      {
        platform: 'pinterest',
        targetIntegrationId: 'pinterest-second',
      },
    ]);
  });
});
