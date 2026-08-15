import { describe, expect, it, vi } from 'vitest';
import { getPlatformCapabilities } from './platform.capabilities';
import {
  analyzePlatformContent,
  analyzeSelectedPlatformContent,
  normalizePlatformContent,
  resolveEffectivePlatformContent,
} from './platform.content';
import { stripLinks } from './strip.links';

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

  it.each(['telegram', 'max'])(
    '%s safely serializes tagless text for HTML parse mode',
    (identifier) => {
      const capabilities = getPlatformCapabilities(identifier);
      const content = 'AT&T < launch > landing &copy; &nbsp;';
      const normalized = normalizePlatformContent(content, capabilities);

      expect(normalized).toBe('AT&amp;T &lt; launch &gt; landing © &#160;');
      expect(normalizePlatformContent(normalized, capabilities)).toBe(
        normalized
      );
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

  it.each([
    [
      'telegram',
      '<b>real</b> label plain &lt;strong&gt;literal&lt;/strong&gt; ' +
        '&lt;custom&gt;custom&lt;/custom&gt; &amp; ©',
    ],
    [
      'max',
      '<strong>real</strong> <a href="https://example.com">label</a> plain ' +
        '&lt;strong&gt;literal&lt;/strong&gt; ' +
        '&lt;custom&gt;custom&lt;/custom&gt; &amp; ©',
    ],
  ])(
    '%s keeps escaped markup inert and real supported markup active',
    (identifier, expected) => {
      const content =
        '<p><strong>real</strong> ' +
        '<a href="https://example.com">label</a> <em>plain</em> ' +
        '&lt;strong&gt;literal&lt;/strong&gt; ' +
        '&lt;custom&gt;custom&lt;/custom&gt; &amp; &copy;</p>';
      const capabilities = getPlatformCapabilities(identifier);
      const once = normalizePlatformContent(content, capabilities);

      expect(once).toBe(expected);
      expect(normalizePlatformContent(once, capabilities)).toBe(once);
    }
  );

  it.each(['telegram', 'max'])(
    '%s counts escaped tag text and entities exactly once',
    (identifier) => {
      const content =
        '<p>real &lt;b&gt;literal&lt;/b&gt; &amp; &copy; &#65; &#x1F600;</p>';
      const analysis = analyzePlatformContent({
        content,
        media: [],
        capabilities: getPlatformCapabilities(identifier),
      });

      expect(analysis.visibleLength).toBe(
        'real <b>literal</b> & © A 😀'.length
      );
    }
  );

  it.each(['telegram', 'max'])(
    '%s unwraps unsupported template markup without dropping its text',
    (identifier) => {
      const capabilities = getPlatformCapabilities(identifier);
      const once = normalizePlatformContent(
        '<p>before <template><strong>kept</strong></template> after</p>',
        capabilities
      );

      expect(once).toContain('before ');
      expect(once).toContain('kept');
      expect(once).toContain(' after');
      expect(once).not.toContain('<template');
      expect(normalizePlatformContent(once, capabilities)).toBe(once);
    }
  );

  it.each(['telegram', 'max'])(
    '%s derives visible text from decoded nodes with structural parity',
    (identifier) => {
      const capabilities = getPlatformCapabilities(identifier);
      const content =
        '<h2>Head</h2><ul><li><p>One&nbsp;</p></li>' +
        '<li><p>Two<br>line</p></li></ul><p>Last\n</p>';
      const resolved = resolveEffectivePlatformContent({
        content,
        capabilities,
      });

      expect(resolved.normalized).toBe(
        'Head\n- One&#160;\n- Two\nline\nLast\n'
      );
      expect(resolved.visibleText).toBe(
        'Head\n- One\u00a0\n- Two\nline\nLast\n'
      );
      expect(normalizePlatformContent(resolved.normalized, capabilities)).toBe(
        resolved.normalized
      );
    }
  );

  it.each([
    ['telegram', '<strong><p>A</p>B</strong>', '<b>\nA\nB</b>', '\nA\nB'],
    ['telegram', '<u><h2>A</h2>B</u>', '<u>\nA\nB</u>', '\nA\nB'],
    ['max', '<strong><p>A</p>B</strong>', '<strong>\nA\nB</strong>', '\nA\nB'],
    [
      'max',
      '<a href="max://chat/1"><p>A</p>B</a>',
      '<a href="max://chat/1">\nA\nB</a>',
      '\nA\nB',
    ],
    ['max', '<u><ul><li>One</li></ul>B</u>', '<u>\n- One\nB</u>', '\n- One\nB'],
  ])(
    '%s preserves structural edge whitespace inside retained inline markup',
    (identifier, content, expectedNormalized, expectedVisibleText) => {
      const capabilities = getPlatformCapabilities(identifier);
      const first = resolveEffectivePlatformContent({
        content,
        capabilities,
      });
      const second = resolveEffectivePlatformContent({
        content: first.normalized,
        capabilities,
      });

      expect(first.normalized).toBe(expectedNormalized);
      expect(first.visibleText).toBe(expectedVisibleText);
      expect(second).toEqual(first);
    }
  );

  it('preserves MAX link attributes and schemes for the provider', () => {
    expect(
      normalizePlatformContent(
        '<p><a href="javascript:alert(1)" data-track="kept">unsafe</a> ' +
          '<a href="max://chat/1" title="deep">deep</a></p>',
        getPlatformCapabilities('max')
      )
    ).toBe(
      '<a href="javascript:alert(1)" data-track="kept">unsafe</a> ' +
        '<a href="max://chat/1" title="deep">deep</a>'
    );
  });

  it('uses escaped literal tag text at the Telegram media-caption boundary', () => {
    const capabilities = getPlatformCapabilities('telegram');
    const literalTag = '&lt;b&gt;x&lt;/b&gt;';
    const atBoundary = analyzePlatformContent({
      content: `<p>${'a'.repeat(1016)}${literalTag}</p>`,
      media: [{ type: 'image' }],
      capabilities,
    });
    const aboveBoundary = analyzePlatformContent({
      content: `<p>${'a'.repeat(1017)}${literalTag}</p>`,
      media: [{ type: 'image' }],
      capabilities,
    });

    expect(atBoundary.visibleLength).toBe(1024);
    expect(atBoundary.messages).not.toContainEqual(
      expect.objectContaining({ code: 'media-text-split' })
    );
    expect(aboveBoundary.messages).toContainEqual(
      expect.objectContaining({ code: 'media-text-split' })
    );
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

  it('warns without blocking when transport removes a raw HTTP URL', () => {
    const analysis = analyzePlatformContent({
      content: '<p>Read https://example.com/path before publishing.</p>',
      media: [],
      capabilities: getPlatformCapabilities('x', {
        editor: 'normal',
        maximumCharacters: 280,
        stripRawUrls: true,
      }),
    });

    expect(analysis.messages).toContainEqual({
      severity: 'warning',
      code: 'raw-url-removed',
      text: 'Raw HTTP(S) URLs will be removed before publishing.',
    });
    expect(analysis.normalized).toBe('Read before publishing.');
    expect(analysis.visibleLength).toBe('Read before publishing.'.length);
    expect(analysis.blocking).toBe(false);
  });

  it('treats a URL-only payload as empty after effective stripping with or without media', () => {
    const capabilities = getPlatformCapabilities('x', {
      editor: 'normal',
      maximumCharacters: 280,
      stripRawUrls: true,
    });
    const withoutMedia = analyzePlatformContent({
      content: '<p>https://example.com/path</p>',
      media: [],
      capabilities,
    });
    const withMedia = analyzePlatformContent({
      content: '<p>https://example.com/path</p>',
      media: [{ type: 'image' }],
      capabilities,
    });

    expect(withoutMedia.normalized).toBe('');
    expect(withoutMedia.visibleLength).toBe(0);
    expect(withMedia.normalized).toBe('');
    expect(withMedia.visibleLength).toBe(0);
    expect(withMedia.blocking).toBe(false);
  });

  it('detects a raw URL joined by normalization across harmless markup', () => {
    const analysis = analyzePlatformContent({
      content: '<p>https://exa<span>mple</span>.com/path</p>',
      media: [],
      capabilities: getPlatformCapabilities('x', {
        editor: 'normal',
        maximumCharacters: 280,
        stripRawUrls: true,
      }),
    });

    expect(analysis.normalized).toBe('');
    expect(analysis.visibleLength).toBe(0);
    expect(analysis.messages).toContainEqual(
      expect.objectContaining({ code: 'raw-url-removed' })
    );
  });

  it('removes a URL range across retained nested markup and decoded entities', () => {
    const max = getPlatformCapabilities('max');
    const analysis = analyzePlatformContent({
      content:
        '<p>Before https://exa<strong>mple</strong>.com?a=1&amp;b=2 after</p>',
      media: [],
      capabilities: {
        ...max,
        delivery: { ...max.delivery, stripRawUrls: true },
      },
    });

    expect(analysis.normalized).toBe('Before after');
    expect(analysis.visibleLength).toBe('Before after'.length);
    expect(analysis.messages).toContainEqual(
      expect.objectContaining({ code: 'raw-url-removed' })
    );
  });

  it('counts decoded visible entities after stripping a separate URL', () => {
    const max = getPlatformCapabilities('max');
    const analysis = analyzePlatformContent({
      content: '<p>A &amp; <strong>B</strong> https://example.com/path</p>',
      media: [],
      capabilities: {
        ...max,
        delivery: { ...max.delivery, stripRawUrls: true },
      },
    });

    expect(analysis.normalized).toBe('A &amp; <strong>B</strong>');
    expect(analysis.visibleLength).toBe('A & B'.length);
  });

  it('preserves authored newlines outside the removed URL range', () => {
    const max = getPlatformCapabilities('max');
    const analysis = analyzePlatformContent({
      content: '<p>A <strong>\nB</strong> https://example.com/path</p>',
      media: [],
      capabilities: {
        ...max,
        delivery: { ...max.delivery, stripRawUrls: true },
      },
    });

    expect(analysis.normalized).toBe('A <strong>\nB</strong>');
    expect(analysis.visibleLength).toBe('A \nB'.length);
  });

  it.each([
    [
      'spaces on both sides',
      'Read  https://example.com/path  before',
      'Read before',
    ],
    [
      'spaces only on the right',
      'See:https://example.com/path  before',
      'See: before',
    ],
    [
      'spaces only on the left',
      'See  https://example.com/path,before',
      'See ,before',
    ],
    [
      'content glued on both sides',
      'See:https://example.com/path,before',
      'See:,before',
    ],
    [
      'multiple URLs separated by horizontal whitespace',
      'Ahttps://one.com  https://two.com B',
      'A B',
    ],
    ['a URL on a new line', 'A \n https://example.com/path after', 'A\n after'],
    [
      'a URL before a line break',
      'Before https://example.com/path  \nAfter',
      'Before\nAfter',
    ],
  ])('matches provider defense with %s', (_case, content, expected) => {
    const analysis = analyzePlatformContent({
      content: `<p>${content}</p>`,
      media: [],
      capabilities: getPlatformCapabilities('x', {
        editor: 'normal',
        maximumCharacters: 280,
        stripRawUrls: true,
      }),
    });

    expect(analysis.normalized).toBe(expected);
    expect(stripLinks(analysis.normalized)).toBe(analysis.normalized);
  });

  it('keeps provider defense idempotent for URL-free authored whitespace', () => {
    const content = 'A  B \n C';
    const analysis = analyzePlatformContent({
      content,
      media: [],
      capabilities: getPlatformCapabilities('x', {
        editor: 'normal',
        maximumCharacters: 280,
        stripRawUrls: true,
      }),
    });

    expect(analysis.normalized).toBe(content);
    expect(stripLinks(analysis.normalized)).toBe(content);
  });

  it('does not warn for a URL that remains only in retained anchor metadata', () => {
    const max = getPlatformCapabilities('max');
    const analysis = analyzePlatformContent({
      content: '<p><a href="https://example.com/path">Read more</a></p>',
      media: [],
      capabilities: {
        ...max,
        delivery: { ...max.delivery, stripRawUrls: true },
      },
    });

    expect(analysis.normalized).toContain('>Read more</a>');
    expect(analysis.visibleLength).toBe('Read more'.length);
    expect(analysis.messages).not.toContainEqual(
      expect.objectContaining({ code: 'raw-url-removed' })
    );
  });

  it.each([
    [
      'URL stripping is disabled',
      '<p>Read https://example.com/path.</p>',
      getPlatformCapabilities('x', {
        editor: 'normal',
        maximumCharacters: 280,
      }),
    ],
    [
      'content has no raw URL',
      '<p>There is no link here.</p>',
      getPlatformCapabilities('x', {
        editor: 'normal',
        maximumCharacters: 280,
        stripRawUrls: true,
      }),
    ],
    [
      'Telegram only lacks hidden-link formatting',
      '<p>Read https://example.com/path.</p>',
      getPlatformCapabilities('telegram'),
    ],
  ])(
    'does not warn about URL removal when %s',
    (_reason, content, capabilities) => {
      const analysis = analyzePlatformContent({
        content,
        media: [],
        capabilities,
      });

      expect(analysis.messages).not.toContainEqual(
        expect.objectContaining({ code: 'raw-url-removed' })
      );
    }
  );

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
