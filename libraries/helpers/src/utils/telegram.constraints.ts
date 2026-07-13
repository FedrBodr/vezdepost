export const TELEGRAM_MEDIA_CAPTION_MAX_LENGTH = 1024;

export const shouldSendTelegramTextSeparately = (
  visibleTextLength: number,
  mediaCount: number
) => mediaCount > 0 && visibleTextLength > TELEGRAM_MEDIA_CAPTION_MAX_LENGTH;
