// Keep this in sync with the URL detection used by the short linking service
const urlRegex = () =>
  /(https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*))/gm;

export type HttpUrlRange = { start: number; end: number };

export function getHttpUrlRanges(text?: string | null): HttpUrlRange[] {
  return Array.from((text || '').matchAll(urlRegex())).map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

export function hasLinks(text?: string | null): boolean {
  return getHttpUrlRanges(text).length > 0;
}

export function stripLinks(text?: string | null): string {
  const content = text || '';
  if (!getHttpUrlRanges(content).length) {
    return content;
  }

  return (
    content
      .replace(urlRegex(), '')
      // collapse the whitespace / empty anchor leftovers the removed link left behind
      .replace(/<a\b[^>]*>\s*<\/a>/gi, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/ +\n/g, '\n')
      .trim()
  );
}
