import { describe, expect, it } from 'vitest';
import {
  TELEGRAM_MEDIA_CAPTION_MAX_LENGTH,
  shouldSendTelegramTextSeparately,
} from './telegram.constraints';

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
