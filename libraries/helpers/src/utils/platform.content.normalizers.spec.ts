import { describe, expect, it, vi } from 'vitest';
import { resolvePlatformCapabilityV2 } from './platform.capability.resolver';
import { normalizePlatformFields } from './platform.content.normalizers';

const capability = (
  identifier: string,
  media: ReadonlyArray<{ type?: 'image' | 'video' }> = [],
  adapter = {
    editor: 'normal' as const,
    maximum: 5_000,
    stripRawUrls: false,
  }
) =>
  resolvePlatformCapabilityV2({
    identifier,
    settings: {},
    media,
    adapter,
  });

describe('normalizePlatformFields', () => {
  it('normalizes Telegram fields to its verified HTML subset', () => {
    expect(
      normalizePlatformFields({
        canonicalHtml: '<p>Hello <strong>world</strong></p>',
        settings: {},
        capability: capability('telegram'),
      })
    ).toEqual({
      body: { value: 'Hello <b>world</b>', facets: undefined },
    });
  });

  it('normalizes Slack fields to Slack mrkdwn', () => {
    expect(
      normalizePlatformFields({
        canonicalHtml: '<p>Hello <strong>world</strong></p>',
        settings: {},
        capability: capability('slack'),
      })
    ).toEqual({
      body: { value: 'Hello *world*', facets: undefined },
    });
  });

  it('maps canonical and provider-setting sources independently', () => {
    expect(
      normalizePlatformFields({
        canonicalHtml: '<p>Caption</p>',
        settings: { title: 'Photo title' },
        capability: capability('tiktok', [{ type: 'image' }]),
      })
    ).toEqual({
      title: { value: 'Photo title', facets: undefined },
      description: { value: 'Caption', facets: undefined },
    });
  });

  it('normalizes both Telegram media fields from immutable canonical HTML', () => {
    const canonicalHtml = '<p>Hello <strong>world</strong></p>';
    const settings = Object.freeze<Record<string, unknown>>({});

    expect(
      normalizePlatformFields({
        canonicalHtml,
        settings,
        capability: capability('telegram', [{ type: 'image' }]),
      })
    ).toEqual({
      body: { value: 'Hello <b>world</b>', facets: undefined },
      caption: { value: 'Hello <b>world</b>', facets: undefined },
    });
    expect(canonicalHtml).toBe('<p>Hello <strong>world</strong></p>');
    expect(settings).toEqual({});
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
  ])('%s keeps escaped tags inert', (identifier, expected) => {
    const canonicalHtml =
      '<p><strong>real</strong> ' +
      '<a href="https://example.com">label</a> <em>plain</em> ' +
      '&lt;strong&gt;literal&lt;/strong&gt; ' +
      '&lt;custom&gt;custom&lt;/custom&gt; &amp; &copy;</p>';

    expect(
      normalizePlatformFields({
        canonicalHtml,
        settings: {},
        capability: capability(identifier),
      }).body.value
    ).toBe(expected);
  });

  it('preserves paragraphs, headings, links, and ordered and unordered lists in Markdown', () => {
    const markdown = capability('legacy-markdown', [], {
      editor: 'markdown',
      maximum: 5_000,
      stripRawUrls: false,
    });

    expect(
      normalizePlatformFields({
        canonicalHtml:
          '<h2>Heading</h2><p>Hello <strong>world</strong> <em>soft</em> ' +
          '<a href="https://x.test">site</a></p>' +
          '<ol><li>One</li><li>Two</li></ol><ul><li>Three</li></ul>',
        settings: {},
        capability: markdown,
      }).body.value
    ).toBe(
      '## Heading\nHello **world** *soft* [site](https://x.test)\n' +
        '1. One\n2. Two\n- Three'
    );
  });

  it('ignores formatting-only whitespace between Markdown list items', () => {
    const markdown = capability('legacy-markdown', [], {
      editor: 'markdown',
      maximum: 5_000,
      stripRawUrls: false,
    });

    expect(
      normalizePlatformFields({
        canonicalHtml:
          '<ol>\n  <li>One</li>\n  <li>Two</li>\n</ol>' +
          '<ul>\n  <li>Three</li>\n</ul>',
        settings: {},
        capability: markdown,
      }).body.value
    ).toBe('1. One\n2. Two\n- Three');
  });

  it('uses Slack link and emphasis syntax without treating it as CommonMark', () => {
    expect(
      normalizePlatformFields({
        canonicalHtml:
          '<h1>Heading</h1><p><strong>Bold</strong> <em>soft</em> ' +
          '<a href="https://x.test">site</a></p>',
        settings: {},
        capability: capability('slack'),
      }).body.value
    ).toBe('Heading\n*Bold* _soft_ <https://x.test|site>');
  });

  it('keeps decoded Slack control sequences inert', () => {
    expect(
      normalizePlatformFields({
        canonicalHtml: '<p>&lt;!channel&gt; &amp; team</p>',
        settings: {},
        capability: capability('slack'),
      }).body.value
    ).toBe('&lt;!channel&gt; &amp; team');

    expect(
      normalizePlatformFields({
        canonicalHtml: '<!channel> & team',
        settings: {},
        capability: capability('slack'),
      }).body.value
    ).toBe('&lt;!channel&gt; &amp; team');
  });

  it('escapes literal Markdown punctuation outside generated formatting', () => {
    const markdown = capability('legacy-markdown', [], {
      editor: 'markdown',
      maximum: 5_000,
      stripRawUrls: false,
    });

    expect(
      normalizePlatformFields({
        canonicalHtml:
          '<p>Literal *stars* [brackets] and <strong>bold</strong></p>',
        settings: {},
        capability: markdown,
      }).body.value
    ).toBe('Literal \\*stars\\* \\[brackets\\] and **bold**');

    expect(
      normalizePlatformFields({
        canonicalHtml: '*literal* [label]',
        settings: {},
        capability: markdown,
      }).body.value
    ).toBe('\\*literal\\* \\[label\\]');
  });

  it('escapes generated link destination delimiters per dialect', () => {
    const markdown = capability('legacy-markdown', [], {
      editor: 'markdown',
      maximum: 5_000,
      stripRawUrls: false,
    });
    const canonicalHtml = '<p><a href="https://example.com/a_(b)">site</a></p>';

    expect(
      normalizePlatformFields({
        canonicalHtml,
        settings: {},
        capability: markdown,
      }).body.value
    ).toBe('[site](https://example.com/a_\\(b\\))');
    expect(
      normalizePlatformFields({
        canonicalHtml: '<p><a href="https://example.com/a|b">site</a></p>',
        settings: {},
        capability: capability('slack'),
      }).body.value
    ).toBe('<https://example.com/a%7Cb|site>');
  });

  it.each([
    ['javascript:alert(1)', 'unsafe'],
    ['java&#x0A;script:alert(1)', 'obfuscated'],
    [' data:text/html,unsafe ', 'data'],
    ['vbscript:msgbox(1)', 'vbscript'],
  ])('renders unsafe generated link %s as inert text', (href, label) => {
    const markdown = capability('legacy-markdown', [], {
      editor: 'markdown',
      maximum: 5_000,
      stripRawUrls: false,
    });
    const canonicalHtml = `<p><a href="${href}">${label}</a></p>`;

    expect(
      normalizePlatformFields({
        canonicalHtml,
        settings: {},
        capability: markdown,
      }).body.value
    ).toBe(label);
    expect(
      normalizePlatformFields({
        canonicalHtml,
        settings: {},
        capability: capability('slack'),
      }).body.value
    ).toBe(label);
  });

  it('generates Markdown and Slack links only for allowed protocols', () => {
    const markdown = capability('legacy-markdown', [], {
      editor: 'markdown',
      maximum: 5_000,
      stripRawUrls: false,
    });
    const canonicalHtml =
      '<p><a href=" https://example.com/path ">web</a> ' +
      '<a href="mailto:user@example.com">mail</a></p>';

    expect(
      normalizePlatformFields({
        canonicalHtml,
        settings: {},
        capability: markdown,
      }).body.value
    ).toBe('[web](https://example.com/path) [mail](mailto:user@example.com)');
    expect(
      normalizePlatformFields({
        canonicalHtml,
        settings: {},
        capability: capability('slack'),
      }).body.value
    ).toBe('<https://example.com/path|web> <mailto:user@example.com|mail>');
  });

  it('retains first-wave plain-text structure, Unicode emphasis, and link targets', () => {
    expect(
      normalizePlatformFields({
        canonicalHtml:
          '<h2>Heading</h2><p>Intro<br>continued</p><ul><li>One</li>' +
          '<li><strong>Two</strong></li></ul><p>' +
          '<a href="https://x.test">Site</a></p>',
        settings: {},
        capability: capability('linkedin'),
      }).body.value
    ).toBe('Heading\nIntro\ncontinued\n- One\n- 𝗧𝘄𝗼\nhttps://x.test');
  });

  it('retains tagless special characters exactly', () => {
    const canonicalHtml = 'AT&T < launch > landing &copy;';
    expect(
      normalizePlatformFields({
        canonicalHtml,
        settings: {},
        capability: capability('linkedin'),
      }).body.value
    ).toBe(canonicalHtml);
  });

  it('uses ordinary text for the all-unsupported none bridge', () => {
    const none = capability('legacy-none', [], {
      editor: 'none',
      maximum: 5_000,
      stripRawUrls: false,
    });
    const normal = capability('legacy-normal', [], {
      editor: 'normal',
      maximum: 5_000,
      stripRawUrls: false,
    });

    expect(none.fields[0].formatting.bold).toBe('unsupported');
    expect(
      normalizePlatformFields({
        canonicalHtml: '<p><strong>Bold</strong></p>',
        settings: {},
        capability: none,
      }).body.value
    ).toBe('Bold');
    expect(
      normalizePlatformFields({
        canonicalHtml: '<p><strong>Bold</strong></p>',
        settings: {},
        capability: normal,
      }).body.value
    ).toBe('𝗕𝗼𝗹𝗱');
  });

  it('retains the legacy HTML adapter structural subset', () => {
    const html = capability('legacy-html', [], {
      editor: 'html',
      maximum: 5_000,
      stripRawUrls: false,
    });
    const canonicalHtml =
      '<h1>Title</h1><h2>Subtitle</h2><ul><li>One</li>' +
      '<li><strong>Two</strong></li></ul><p>Body</p>';

    expect(
      normalizePlatformFields({
        canonicalHtml,
        settings: {},
        capability: html,
      }).body.value
    ).toBe(canonicalHtml);
  });

  it('strips visible raw URLs across harmless inline markup when delivery requires it', () => {
    const stripping = capability('legacy-normal', [], {
      editor: 'normal',
      maximum: 280,
      stripRawUrls: true,
    });

    expect(
      normalizePlatformFields({
        canonicalHtml: '<p>https://exa<span>mple</span>.com/path</p>',
        settings: {},
        capability: stripping,
      }).body.value
    ).toBe('');
  });

  it('does not join or remove a URL split across block boundaries', () => {
    const stripping = capability('legacy-normal', [], {
      editor: 'normal',
      maximum: 280,
      stripRawUrls: true,
    });

    expect(
      normalizePlatformFields({
        canonicalHtml: '<p>https://exa</p><p>mple.com</p>',
        settings: {},
        capability: stripping,
      }).body.value
    ).toBe('https://exa\nmple.com');
  });

  it('strips Markdown visible URLs before escaping while retaining link metadata', () => {
    const markdown = capability('legacy-markdown', [], {
      editor: 'markdown',
      maximum: 5_000,
      stripRawUrls: true,
    });

    expect(
      normalizePlatformFields({
        canonicalHtml: '<p>Read https://example.com/a-b now</p>',
        settings: {},
        capability: markdown,
      }).body.value
    ).toBe('Read now');
    expect(
      normalizePlatformFields({
        canonicalHtml:
          '<p><a href="https://example.com/path">Read more</a></p>',
        settings: {},
        capability: markdown,
      }).body.value
    ).toBe('[Read more](https://example.com/path)');
  });

  const blueskyCapability = (stripRawUrls = false) => ({
    identifier: 'bluesky',
    profileIdentifier: 'bluesky',
    verification: 'verified',
    evidenceDate: '2026-08-21',
    variant: 'post',
    fields: [
      {
        key: 'body',
        label: 'Body',
        required: false,
        source: 'canonical-editor',
        dialect: 'bluesky-facets',
        formatting: { bold: 'unsupported', underline: 'unsupported', links: 'native', lists: 'plain', headings: 'plain' },
      },
    ],
    structuredFields: [],
    media: { type: 'optional' },
    delivery: { longMediaText: 'not-applicable', stripRawUrls },
    diagnostics: [],
  });

  it('emits utf8 byte-indexed link facets for bluesky', () => {
    const result = normalizePlatformFields({
      canonicalHtml: '<p>see <a href="https://example.com">this</a> 😀</p>',
      settings: {},
      capability: blueskyCapability(),
    });
    const prefix = 'see this 😀';
    expect(result.body.value).toBe(prefix);
    expect(result.body.facets).toEqual([
      {
        index: { byteStart: 4, byteEnd: 8 },
        features: [{ '$type': 'app.bsky.richtext.facet#link', uri: 'https://example.com' }],
      },
    ]);
  });

  it('omits facets when no link is present', () => {
    const result = normalizePlatformFields({
      canonicalHtml: '<p>plain words</p>',
      settings: {},
      capability: blueskyCapability(),
    });
    expect(result.body.facets).toBeUndefined();
  });

  it('converts mentions without rewriting the canonical source', () => {
    const canonicalHtml =
      '<p>Hello <span data-mention-id="42">Alice</span></p>';
    const convertMentionFunction = vi.fn(
      (id: string, name: string) => `@${name.toLowerCase()}-${id}`
    );

    expect(
      normalizePlatformFields({
        canonicalHtml,
        settings: {},
        capability: capability('linkedin'),
        convertMentionFunction,
      }).body.value
    ).toBe('Hello @alice-42');
    expect(convertMentionFunction).toHaveBeenCalledWith('42', 'Alice');
    expect(canonicalHtml).toBe(
      '<p>Hello <span data-mention-id="42">Alice</span></p>'
    );
  });
});
