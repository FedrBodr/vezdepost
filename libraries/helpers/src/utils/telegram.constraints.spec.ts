import { describe, expect, it } from 'vitest';
import {
  TELEGRAM_MEDIA_CAPTION_MAX_LENGTH,
  getTelegramVisibleTextLength,
  normalizeTelegramHtml,
  shouldSendTelegramTextSeparately,
} from './telegram.constraints';

describe('Telegram HTML caption length', () => {
  it('normalizes editor HTML exactly as Telegram delivery expects', () => {
    expect(
      normalizeTelegramHtml(
        '<p><strong>bold</strong> <a href="https://example.com">label</a></p>'
      )
    ).toBe('<b>bold</b> label');
  });

  it('normalizes multiline headings, links, and paragraphs without losing text', () => {
    expect(
      normalizeTelegramHtml(
        '<h2>Title\ncontinued</h2><p>First <a href="https://example.com">label\ncontinued</a></p><p>Last\nline</p>'
      )
    ).toBe('Title\ncontinued\n\nFirst label\ncontinued\n\nLast\nline');
  });

  it('preserves a raw trailing newline', () => {
    expect(normalizeTelegramHtml('plain\n')).toBe('plain\n');
  });

  it('preserves literal private-use Unicode text', () => {
    expect(normalizeTelegramHtml('Private \uE000 glyph')).toBe(
      'Private \uE000 glyph'
    );
  });

  it('retains paragraph separators and remains idempotent with intentional trailing text', () => {
    const once = normalizeTelegramHtml('<p>First</p><p>Second\n</p>');

    expect(once).toBe('First\n\nSecond\n');
    expect(normalizeTelegramHtml(once)).toBe(once);
  });

  it('preserves heading, paragraph, break, and list boundaries idempotently', () => {
    const once = normalizeTelegramHtml(
      '<h2>Heading</h2><p><strong>Intro</strong><br>continued</p><ul><li>One</li><li><u>Two</u></li></ul><p>Last</p>'
    );

    expect(once).toBe(
      'Heading\n\n<b>Intro</b>\ncontinued\n\n- One\n- <u>Two</u>\n\nLast'
    );
    expect(normalizeTelegramHtml(once)).toBe(once);
  });

  it('preserves trailing-newline intent after structural normalization', () => {
    expect(normalizeTelegramHtml('<ul><li>One</li><li>Two</li></ul>\n')).toBe(
      '- One\n- Two\n'
    );
  });

  it('keeps escaped markup inert while preserving real formatting, entities, and trailing newlines idempotently', () => {
    const input =
      '<p><strong>real bold</strong> <u>real underline</u> ' +
      '&lt;b&gt;literal bold&lt;/b&gt; ' +
      '&lt;script&gt;literal script&lt;/script&gt; ' +
      '&amp; &copy; &#65; &#x1F600;</p>\n';
    const once = normalizeTelegramHtml(input);

    expect(once).toBe(
      '<b>real bold</b> <u>real underline</u> ' +
        '&lt;b&gt;literal bold&lt;/b&gt; ' +
        '&lt;script&gt;literal script&lt;/script&gt; ' +
        '&amp; © A 😀\n'
    );
    expect(normalizeTelegramHtml(once)).toBe(once);
    expect(getTelegramVisibleTextLength(once)).toBe(
      'real bold real underline '.length +
        '<b>literal bold</b> '.length +
        '<script>literal script</script> '.length +
        '& © A 😀\n'.length
    );
  });

  it('counts formatting text without counting tags', () => {
    expect(
      getTelegramVisibleTextLength(`<p><strong>${'x'.repeat(600)}</strong></p>`)
    ).toBe(600);
  });

  it('counts link labels instead of URLs', () => {
    expect(
      getTelegramVisibleTextLength(
        `<a href="https://example.com/${'x'.repeat(1100)}">short label</a>`
      )
    ).toBe('short label'.length);
  });

  it('decodes supported named and numeric entities using UTF-16 length', () => {
    expect(getTelegramVisibleTextLength('&amp;'.repeat(1024))).toBe(1024);
    expect(getTelegramVisibleTextLength('&copy;'.repeat(1024))).toBe(1024);
    expect(
      getTelegramVisibleTextLength('<p>&nbsp;&euro;&NewLine;&copy;</p>')
    ).toBe('\u00a0€\n©'.length);
    expect(getTelegramVisibleTextLength('&#128512;'.repeat(512))).toBe(1024);
    expect(getTelegramVisibleTextLength('&#x1F600;'.repeat(513))).toBe(1026);
  });
});

describe('shouldSendTelegramTextSeparately', () => {
  it('keeps text-only posts in one message', () => {
    expect(shouldSendTelegramTextSeparately(1545, 0)).toBe(false);
  });

  it('keeps a 1024-character media caption attached', () => {
    expect(
      shouldSendTelegramTextSeparately(TELEGRAM_MEDIA_CAPTION_MAX_LENGTH, 1)
    ).toBe(false);
  });

  it('splits media from text above 1024 characters', () => {
    expect(
      shouldSendTelegramTextSeparately(TELEGRAM_MEDIA_CAPTION_MAX_LENGTH + 1, 1)
    ).toBe(true);
  });

  it('applies the same rule to albums', () => {
    expect(shouldSendTelegramTextSeparately(1545, 3)).toBe(true);
  });
});
