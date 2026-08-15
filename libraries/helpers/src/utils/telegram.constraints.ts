import { normalizeVerifiedHtml } from './verified.html.normalization';

export const TELEGRAM_MEDIA_CAPTION_MAX_LENGTH = 1024;

export const normalizeTelegramHtml = (value: string): string =>
  normalizeVerifiedHtml(value, 'telegram').normalized;

export const getTelegramVisibleTextLength = (value: string): number =>
  normalizeVerifiedHtml(value, 'telegram').visibleText.length;

export const shouldSendTelegramTextSeparately = (
  visibleTextLength: number,
  mediaCount: number
) => mediaCount > 0 && visibleTextLength > TELEGRAM_MEDIA_CAPTION_MAX_LENGTH;
