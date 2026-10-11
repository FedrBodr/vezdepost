import DOMPurify from 'isomorphic-dompurify';
import { parseFragment, serialize } from 'parse5';
import type { Node } from 'parse5';

const ALLOWED_TAGS = [
  'p',
  'br',
  'b',
  'strong',
  'em',
  'i',
  's',
  'strike',
  'del',
  'u',
  'a',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'span',
  'mark',
  'img',
];

const ALLOWED_DATA_ATTR = [
  'data-mention-id',
  'data-mention-label',
  'data-tooltip-id',
  'data-tooltip-content',
];

const ALLOWED_ATTR = [
  'dir',
  'href',
  'target',
  'rel',
  'class',
  'src',
  'alt',
  ...ALLOWED_DATA_ATTR,
];

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

// <img> keeps data: URIs whatever ALLOWED_URI_REGEXP says, so a picture
// that doesn't point to a real file is dropped
DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (
    data.tagName === 'img' &&
    !/^https?:\/\//i.test((node as Element).getAttribute('src') || '')
  ) {
    node.parentNode?.removeChild(node);
  }
});
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

// The plain text a reviewer sees for a post item: the text nodes of the
// sanitised HTML, in order, entities decoded. This is what anchor offsets
// index into on both the frontend (element.textContent) and the backend.
export const postContentPlainText = (value: unknown): string => {
  const walk = (nodes: any[]): string =>
    nodes
      .map((node) =>
        node.nodeName === '#text' ? node.value : walk(node.childNodes || [])
      )
      .join('');

  return walk(parseFragment(sanitizePostContent(value)).childNodes as any[]);
};
