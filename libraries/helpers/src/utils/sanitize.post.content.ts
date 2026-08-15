import DOMPurify from 'isomorphic-dompurify';
import { parseFragment, serialize } from 'parse5';
import type { Node } from 'parse5';

const ALLOWED_TAGS = [
  'p',
  'br',
  'b',
  'strong',
  'u',
  'a',
  'ul',
  'li',
  'h1',
  'h2',
  'h3',
  'span',
  'mark',
];

const ALLOWED_DATA_ATTR = [
  'data-mention-id',
  'data-mention-label',
  'data-tooltip-id',
  'data-tooltip-content',
];

const ALLOWED_ATTR = ['href', 'target', 'rel', 'class', ...ALLOWED_DATA_ATTR];

const ALLOWED_CLASS_TOKENS = new Set([
  'font-bold',
  'font-[arial]',
  'text-[#ae8afc]',
  'bg-red-500',
]);

const restrictClassTokens = (html: string): string => {
  const fragment = parseFragment(html);
  const visit = (node: Node): void => {
    if ('attrs' in node) {
      node.attrs = node.attrs.flatMap((attribute) => {
        if (attribute.name !== 'class') {
          return [attribute];
        }

        const className = attribute.value
          .split(/\s+/)
          .filter((token) => ALLOWED_CLASS_TOKENS.has(token))
          .join(' ');

        return className ? [{ ...attribute, value: className }] : [];
      });
    }

    if ('childNodes' in node) {
      node.childNodes.forEach(visit);
    }
  };

  visit(fragment);
  return serialize(fragment);
};

export const sanitizePostContent = (value: unknown): string => {
  if (typeof value !== 'string' || !value) {
    return '';
  }

  return restrictClassTokens(
    DOMPurify.sanitize(value, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ADD_URI_SAFE_ATTR: ALLOWED_DATA_ATTR,
      ALLOW_DATA_ATTR: false,
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/|#)/i,
    })
  );
};
