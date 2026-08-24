const PARAGRAPH_BOUNDARY = Symbol('paragraph-boundary');
const ITEM_BOUNDARY = Symbol('item-boundary');

/**
 * Converts editor block markup into text separators while leaving inline HTML
 * intact. Paragraph-level blocks stay separated by a blank line so platform
 * paragraph spacing survives; list items stay tightly packed. Generated
 * separators at the edges are discarded, but literal whitespace from the
 * source is preserved so trailing-newline intent survives.
 */
export const convertHtmlStructureToText = (value: string): string => {
  const normalized = value
    .replace(/(<li\b[^>]*>)\s*<p\b[^>]*>/gi, '$1')
    .replace(/<\/p>\s*(<\/li>)/gi, '$1');
  const parts: Array<
    string | typeof PARAGRAPH_BOUNDARY | typeof ITEM_BOUNDARY
  > = [];
  const structuralTag = /<br\s*\/?>|<\/?(?:p|h[1-6]|ul|ol|li)\b[^>]*>/gi;
  let cursor = 0;
  let insideListItem = false;

  const pushBoundary = () => {
    const boundary = insideListItem ? ITEM_BOUNDARY : PARAGRAPH_BOUNDARY;
    if (parts.at(-1) !== boundary) {
      parts.push(boundary);
    }
  };

  for (const match of normalized.matchAll(structuralTag)) {
    if (match.index > cursor) {
      parts.push(normalized.slice(cursor, match.index));
    }

    if (/^<br\b/i.test(match[0])) {
      parts.push('\n');
    } else if (/^<li\b/i.test(match[0])) {
      parts.push(ITEM_BOUNDARY);
      parts.push('- ');
      insideListItem = true;
    } else if (/^<\/li\b/i.test(match[0])) {
      parts.push(ITEM_BOUNDARY);
      insideListItem = false;
    } else {
      pushBoundary();
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < normalized.length) {
    parts.push(normalized.slice(cursor));
  }

  while (
    parts.length &&
    (parts[0] === PARAGRAPH_BOUNDARY || parts[0] === ITEM_BOUNDARY)
  ) {
    parts.shift();
  }

  let trailingText = '';
  while (parts.length) {
    const last = parts.at(-1);
    if (last === PARAGRAPH_BOUNDARY || last === ITEM_BOUNDARY) {
      parts.pop();
      continue;
    }
    if (typeof last === 'string' && !/\S/.test(last)) {
      trailingText = last + trailingText;
      parts.pop();
      continue;
    }
    break;
  }

  let result = '';
  let index = 0;
  while (index < parts.length) {
    const part = parts[index];
    if (part === PARAGRAPH_BOUNDARY || part === ITEM_BOUNDARY) {
      let paragraphBreak = false;
      while (
        index < parts.length &&
        (parts[index] === PARAGRAPH_BOUNDARY || parts[index] === ITEM_BOUNDARY)
      ) {
        if (parts[index] === PARAGRAPH_BOUNDARY) {
          paragraphBreak = true;
        }
        index += 1;
      }
      result += paragraphBreak ? '\n\n' : '\n';
      continue;
    }
    result += part as string;
    index += 1;
  }
  return result + trailingText;
};
