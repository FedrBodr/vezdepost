import striptags from 'striptags';

export const TELEGRAM_MEDIA_CAPTION_MAX_LENGTH = 1024;

export const normalizeTelegramHtml = (value: string): string =>
  striptags(
    value
      .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gis, '$1\n')
      .replace(/<a[^>]*>(.*?)<\/a>/gis, '$1'),
    ['u', 'strong', 'b', 'p']
  )
    .replace(/<strong>/g, '<b>')
    .replace(/<\/strong>/g, '</b>')
    .replace(/<p>(.*?)<\/p>/gs, '$1\n');

const decodeTelegramHtmlEntities = (value: string) =>
  value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|(lt|gt|amp|quot));/gi,
    (entity, decimal: string, hexadecimal: string, named: string) => {
      if (named) {
        return {
          lt: '<',
          gt: '>',
          amp: '&',
          quot: '"',
        }[named.toLowerCase()]!;
      }

      const codePoint = Number.parseInt(
        decimal || hexadecimal,
        decimal ? 10 : 16
      );
      if (
        !Number.isInteger(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return entity;
      }

      return String.fromCodePoint(codePoint);
    }
  );

export const getTelegramVisibleTextLength = (value: string): number =>
  decodeTelegramHtmlEntities(striptags(normalizeTelegramHtml(value))).length;

export const shouldSendTelegramTextSeparately = (
  visibleTextLength: number,
  mediaCount: number
) => mediaCount > 0 && visibleTextLength > TELEGRAM_MEDIA_CAPTION_MAX_LENGTH;
