const STRUCTURAL_BOUNDARY = Symbol('structural-boundary');

/**
 * Converts editor block markup into text separators while leaving inline HTML
 * intact. Generated block separators at the edges are discarded, but literal
 * whitespace from the source is preserved so trailing-newline intent survives.
 */
export const convertHtmlStructureToText = (value: string): string => {
  const normalized = value
    .replace(/(<li\b[^>]*>)\s*<p\b[^>]*>/gi, '$1')
    .replace(/<\/p>\s*(<\/li>)/gi, '$1');
  const parts: Array<string | typeof STRUCTURAL_BOUNDARY> = [];
  const structuralTag = /<br\s*\/?>|<\/?(?:p|h[1-6]|ul|ol|li)\b[^>]*>/gi;
  let cursor = 0;

  for (const match of normalized.matchAll(structuralTag)) {
    if (match.index > cursor) {
      parts.push(normalized.slice(cursor, match.index));
    }

    if (/^<br\b/i.test(match[0])) {
      parts.push('\n');
    } else {
      if (parts.at(-1) !== STRUCTURAL_BOUNDARY) {
        parts.push(STRUCTURAL_BOUNDARY);
      }
      if (/^<li\b/i.test(match[0])) {
        parts.push('- ');
      }
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < normalized.length) {
    parts.push(normalized.slice(cursor));
  }

  const leadingBoundary = parts.findIndex(
    (part) => part === STRUCTURAL_BOUNDARY || /\S/.test(part as string)
  );
  if (parts[leadingBoundary] === STRUCTURAL_BOUNDARY) {
    parts.splice(leadingBoundary, 1);
  }

  let trailingBoundary = parts.length - 1;
  while (
    trailingBoundary >= 0 &&
    parts[trailingBoundary] !== STRUCTURAL_BOUNDARY &&
    !/\S/.test(parts[trailingBoundary] as string)
  ) {
    trailingBoundary -= 1;
  }
  if (parts[trailingBoundary] === STRUCTURAL_BOUNDARY) {
    parts.splice(trailingBoundary, 1);
  }

  return parts
    .map((part) => (part === STRUCTURAL_BOUNDARY ? '\n' : part))
    .join('');
};
