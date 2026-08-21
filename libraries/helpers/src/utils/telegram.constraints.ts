import { normalizeVerifiedHtml } from './verified.html.normalization';
import { measureContent } from './platform.content.measurement';
import type { ContentLimit } from './platform.capability.types';

export const TELEGRAM_BODY_LIMIT = {
  max: 4_096,
  unit: 'utf16-code-units',
  source: 'platform',
} as const satisfies ContentLimit;
export const TELEGRAM_MEDIA_CAPTION_LIMIT = {
  max: 1_024,
  unit: 'utf16-code-units',
  source: 'platform',
} as const satisfies ContentLimit;
export const TELEGRAM_MEDIA_CAPTION_MAX_LENGTH =
  TELEGRAM_MEDIA_CAPTION_LIMIT.max;
export const TELEGRAM_MEDIA_GROUP_MAX_ITEMS = 10;

export const normalizeTelegramHtml = (value: string): string =>
  normalizeVerifiedHtml(value, 'telegram').normalized;

export const getTelegramVisibleTextLength = (value: string): number =>
  measureContent(
    normalizeVerifiedHtml(value, 'telegram').visibleText,
    TELEGRAM_BODY_LIMIT
  ).measured;

export const shouldSendTelegramTextSeparately = (
  visibleTextLength: number,
  mediaCount: number
) => mediaCount > 0 && visibleTextLength > TELEGRAM_MEDIA_CAPTION_MAX_LENGTH;
