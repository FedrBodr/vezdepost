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
    ).toBe('<b>bold</b> label\n');
  });

  it('counts formatting text without counting tags', () => {
    expect(
      getTelegramVisibleTextLength(`<p><strong>${'x'.repeat(600)}</strong></p>`)
    ).toBe(601);
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
