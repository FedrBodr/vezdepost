import DOMPurify from 'isomorphic-dompurify';

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

export const sanitizePostContent = (value: unknown): string => {
  if (typeof value !== 'string' || !value) {
    return '';
  }

  return DOMPurify.sanitize(value, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ADD_URI_SAFE_ATTR: ALLOWED_DATA_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/|#)/i,
  });
};
