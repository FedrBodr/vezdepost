import { parseFragment } from 'parse5';

type HtmlAttribute = {
  name: string;
  value: string;
};

type HtmlNode = {
  nodeName: string;
  tagName?: string;
  attrs?: HtmlAttribute[];
  value?: string;
  childNodes?: HtmlNode[];
  content?: HtmlNode;
};

const RICH_BLOCK_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'blockquote',
  'pre',
  'hr',
]);

const escapeRichText = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeRichAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const getChildNodes = (node: HtmlNode): HtmlNode[] =>
  (node.tagName === 'template' && node.content
    ? node.content.childNodes
    : node.childNodes) ?? [];

const getAttribute = (node: HtmlNode, name: string): string | undefined =>
  node.attrs?.find((attribute) => attribute.name === name)?.value;

const collectNodeText = (node: HtmlNode): string =>
  node.nodeName === '#text'
    ? node.value ?? ''
    : getChildNodes(node).map(collectNodeText).join('');

const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

const normalizeLinkHref = (value: string): string | undefined => {
  const trimmed = value.trim();
  try {
    return ALLOWED_LINK_PROTOCOLS.has(new URL(trimmed).protocol)
      ? trimmed
      : undefined;
  } catch {
    return undefined;
  }
};

const INLINE_TAG_MAP: Record<string, string> = {
  strong: 'b',
  b: 'b',
  em: 'i',
  i: 'i',
  ins: 'u',
  u: 'u',
  del: 's',
  s: 's',
  strike: 's',
};

const renderNode = (
  node: HtmlNode,
  convertMentionFunction?:
    | ((idOrHandle: string, name: string) => string)
    | undefined
): string => {
  if (node.nodeName === '#text') {
    return escapeRichText(node.value ?? '');
  }
  const tagName = node.tagName;
  if (!tagName) {
    return renderChildren(node, convertMentionFunction);
  }

  const mentionId =
    tagName === 'span' ? getAttribute(node, 'data-mention-id') : undefined;
  if (mentionId !== undefined && convertMentionFunction) {
    return escapeRichText(
      convertMentionFunction(mentionId, collectNodeText(node))
    );
  }

  if (tagName === 'br') {
    return '\n';
  }
  if (tagName === 'hr') {
    return '<hr/>';
  }

  const inner = renderChildren(node, convertMentionFunction);

  if (tagName === 'a') {
    const href = getAttribute(node, 'href');
    const normalized = href ? normalizeLinkHref(href) : undefined;
    return normalized
      ? `<a href="${escapeRichAttribute(normalized)}">${inner}</a>`
      : inner;
  }
  const inlineTag = INLINE_TAG_MAP[tagName];
  if (inlineTag) {
    return `<${inlineTag}>${inner}</${inlineTag}>`;
  }
  if (tagName === 'code') {
    return `<code>${inner}</code>`;
  }
  if (tagName === 'blockquote') {
    return `<blockquote>${inner}</blockquote>`;
  }
  if (tagName === 'pre') {
    return `<pre>${inner}</pre>`;
  }
  if (/^h[1-6]$/.test(tagName)) {
    return `<${tagName}>${inner}</${tagName}>`;
  }
  if (tagName === 'p') {
    return `<p>${inner}</p>`;
  }
  if (tagName === 'ul' || tagName === 'ol') {
    const items = getChildNodes(node)
      .filter(
        (child) =>
          child.tagName === 'li' ||
          (child.nodeName === '#text' && /\S/.test(child.value ?? ''))
      )
      .map((child) =>
        child.tagName === 'li'
          ? `<li>${renderChildren(child, convertMentionFunction)}</li>`
          : renderNode(child, convertMentionFunction)
      )
      .join('');
    return `<${tagName}>${items}</${tagName}>`;
  }
  if (tagName === 'li') {
    return `<li>${inner}</li>`;
  }
  return inner;
};

const renderChildren = (
  node: HtmlNode,
  convertMentionFunction?:
    | ((idOrHandle: string, name: string) => string)
    | undefined
): string =>
  getChildNodes(node)
    .map((child) => renderNode(child, convertMentionFunction))
    .join('');

/** Splits rendered output into block chunks on top-level block tags. */
const splitBlocks = (rendered: string): string[] => {
  const blockPattern =
    /<(?:p|h[1-6]|ul|ol|blockquote|pre)\b[^>]*>[\s\S]*?<\/(?:p|h[1-6]|ul|ol|blockquote|pre)>|<hr\/>/g;
  const blocks: string[] = [];
  let cursor = 0;
  for (const match of rendered.matchAll(blockPattern)) {
    if (match.index > cursor) {
      const between = rendered.slice(cursor, match.index);
      if (between.trim()) {
        blocks.push(between.trim());
      }
    }
    blocks.push(match[0]);
    cursor = match.index + match[0].length;
  }
  if (cursor < rendered.length && rendered.slice(cursor).trim()) {
    blocks.push(rendered.slice(cursor).trim());
  }
  return blocks;
};

export type TelegramRichMedia = Readonly<{
  type?: string;
  path?: string;
}>;

export const renderTelegramRichHtml = (
  canonicalHtml: string,
  media: ReadonlyArray<TelegramRichMedia> = [],
  convertMentionFunction?: (idOrHandle: string, name: string) => string
): string => {
  const fragment = parseFragment(canonicalHtml) as unknown as HtmlNode;
  const body = splitBlocks(
    renderChildren(fragment, convertMentionFunction)
  ).join('\n\n');

  const imageBlocks = media
    .filter(
      (item) => item.type === 'image' && /^https?:\/\//.test(item.path ?? '')
    )
    .map((item) => `<img src="${escapeRichAttribute(item.path!.trim())}"/>`);

  return [...imageBlocks, body].filter(Boolean).join('\n\n');
};

export const telegramRichMeasurementValue = (value: string): string => {
  const fragment = parseFragment(value) as unknown as HtmlNode;
  const collect = (node: HtmlNode): string => {
    if (node.nodeName === '#text') {
      return node.value ?? '';
    }
    return getChildNodes(node).map(collect).join('');
  };
  return collect(fragment);
};

export const telegramRichMediaEligible = (
  media: ReadonlyArray<TelegramRichMedia>
): boolean =>
  media.every(
    (item) => item.type === 'image' && /^https?:\/\//.test(item.path ?? '')
  );
