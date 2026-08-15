import { parseFragment, serialize } from 'parse5';
import { convertHtmlStructureToText } from './html.structure';

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
  parentNode?: HtmlNode;
};

export type VerifiedHtmlPlatform = 'telegram' | 'max';

export type VerifiedHtmlNormalization = {
  normalized: string;
  visibleText: string;
};

const structuralTags = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'br',
]);

const collectText = (node: HtmlNode): string => {
  if (node.nodeName === '#text') {
    return node.value || '';
  }
  return getChildNodes(node).map(collectText).join('');
};

const getChildContainer = (node: HtmlNode): HtmlNode =>
  node.tagName === 'template' && node.content ? node.content : node;

const getChildNodes = (node: HtmlNode): HtmlNode[] =>
  getChildContainer(node).childNodes || [];

const isAllowedInlineTag = (platform: VerifiedHtmlPlatform, tagName: string) =>
  platform === 'telegram'
    ? tagName === 'b' || tagName === 'strong' || tagName === 'u'
    : tagName === 'strong' || tagName === 'u' || tagName === 'a';

const normalizeTree = (
  parent: HtmlNode,
  platform: VerifiedHtmlPlatform,
  convertMentionFunction?: (idOrHandle: string, name: string) => string
): void => {
  const childContainer = getChildContainer(parent);
  const normalizedChildren: HtmlNode[] = [];

  for (const child of getChildNodes(parent)) {
    if (child.nodeName === '#text') {
      normalizedChildren.push(child);
      continue;
    }
    if (!child.tagName) {
      continue;
    }

    const mentionId = child.attrs?.find(
      ({ name }) => name === 'data-mention-id'
    )?.value;
    if (
      child.tagName === 'span' &&
      mentionId !== undefined &&
      convertMentionFunction
    ) {
      normalizedChildren.push({
        nodeName: '#text',
        value: convertMentionFunction(mentionId, collectText(child)),
      });
      continue;
    }

    normalizeTree(child, platform, convertMentionFunction);
    if (isAllowedInlineTag(platform, child.tagName)) {
      if (platform === 'telegram' && child.tagName === 'strong') {
        child.nodeName = 'b';
        child.tagName = 'b';
      }
      normalizedChildren.push(child);
      continue;
    }
    if (structuralTags.has(child.tagName)) {
      normalizedChildren.push(child);
      continue;
    }
    normalizedChildren.push(...getChildNodes(child));
  }

  normalizedChildren.forEach((child) => {
    child.parentNode = childContainer;
  });
  childContainer.childNodes = normalizedChildren;
};

type VisibleToken =
  | { type: 'text'; value: string }
  | { type: 'tag'; tagName: string; closing: boolean }
  | { type: 'inline-boundary' };

const isWhitespaceText = (
  token: VisibleToken | undefined
): token is Extract<VisibleToken, { type: 'text' }> =>
  token?.type === 'text' && !/\S/.test(token.value);

const collectVisibleTokens = (node: HtmlNode, tokens: VisibleToken[]): void => {
  for (const child of getChildNodes(node)) {
    if (child.nodeName === '#text') {
      tokens.push({ type: 'text', value: child.value || '' });
      continue;
    }
    if (!child.tagName) {
      continue;
    }
    if (structuralTags.has(child.tagName)) {
      tokens.push({ type: 'tag', tagName: child.tagName, closing: false });
    } else {
      tokens.push({ type: 'inline-boundary' });
    }
    collectVisibleTokens(child, tokens);
    if (structuralTags.has(child.tagName) && child.tagName !== 'br') {
      tokens.push({ type: 'tag', tagName: child.tagName, closing: true });
    } else if (!structuralTags.has(child.tagName)) {
      tokens.push({ type: 'inline-boundary' });
    }
  }
};

const removeListParagraphWrappers = (tokens: VisibleToken[]) => {
  const withoutOpenWrappers: VisibleToken[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    withoutOpenWrappers.push(token);
    if (token.type !== 'tag' || token.tagName !== 'li' || token.closing) {
      continue;
    }

    let nextIndex = index + 1;
    while (isWhitespaceText(tokens[nextIndex])) {
      nextIndex += 1;
    }
    const nextToken = tokens[nextIndex];
    if (
      nextToken?.type === 'tag' &&
      nextToken.tagName === 'p' &&
      !nextToken.closing
    ) {
      index = nextIndex;
    }
  }

  const normalized: VisibleToken[] = [];
  for (let index = 0; index < withoutOpenWrappers.length; index += 1) {
    const token = withoutOpenWrappers[index];
    if (token.type === 'tag' && token.tagName === 'p' && token.closing) {
      let nextIndex = index + 1;
      while (isWhitespaceText(withoutOpenWrappers[nextIndex])) {
        nextIndex += 1;
      }
      const nextToken = withoutOpenWrappers[nextIndex];
      if (
        nextToken?.type === 'tag' &&
        nextToken.tagName === 'li' &&
        nextToken.closing
      ) {
        index = nextIndex - 1;
        continue;
      }
    }
    normalized.push(token);
  }
  return normalized;
};

const STRUCTURAL_BOUNDARY = Symbol('structural-boundary');
const INLINE_BOUNDARY = Symbol('inline-boundary');

const collectVisibleText = (node: HtmlNode): string => {
  const rawTokens: VisibleToken[] = [];
  collectVisibleTokens(node, rawTokens);
  const parts: Array<
    string | typeof STRUCTURAL_BOUNDARY | typeof INLINE_BOUNDARY
  > = [];

  for (const token of removeListParagraphWrappers(rawTokens)) {
    if (token.type === 'text') {
      parts.push(token.value);
      continue;
    }
    if (token.type === 'inline-boundary') {
      parts.push(INLINE_BOUNDARY);
      continue;
    }
    if (token.tagName === 'br') {
      parts.push('\n');
      continue;
    }
    if (parts.at(-1) !== STRUCTURAL_BOUNDARY) {
      parts.push(STRUCTURAL_BOUNDARY);
    }
    if (token.tagName === 'li' && !token.closing) {
      parts.push('- ');
    }
  }

  const leadingBoundary = parts.findIndex(
    (part) =>
      part === STRUCTURAL_BOUNDARY ||
      part === INLINE_BOUNDARY ||
      /\S/.test(part as string)
  );
  if (parts[leadingBoundary] === STRUCTURAL_BOUNDARY) {
    parts.splice(leadingBoundary, 1);
  }

  let trailingBoundary = parts.length - 1;
  while (
    trailingBoundary >= 0 &&
    parts[trailingBoundary] !== STRUCTURAL_BOUNDARY &&
    parts[trailingBoundary] !== INLINE_BOUNDARY &&
    !/\S/.test(parts[trailingBoundary] as string)
  ) {
    trailingBoundary -= 1;
  }
  if (parts[trailingBoundary] === STRUCTURAL_BOUNDARY) {
    parts.splice(trailingBoundary, 1);
  }

  return parts
    .map((part) => {
      if (part === STRUCTURAL_BOUNDARY) {
        return '\n';
      }
      return part === INLINE_BOUNDARY ? '' : part;
    })
    .join('');
};

export const normalizeVerifiedHtml = (
  value: string,
  platform: VerifiedHtmlPlatform,
  convertMentionFunction?: (idOrHandle: string, name: string) => string
): VerifiedHtmlNormalization => {
  const parsedFragment = parseFragment(value);
  const fragment = parsedFragment as unknown as HtmlNode;

  normalizeTree(fragment, platform, convertMentionFunction);
  const normalized = convertHtmlStructureToText(
    serialize(parsedFragment).replace(/&nbsp;/g, '&#160;')
  );
  return {
    normalized,
    visibleText: collectVisibleText(fragment),
  };
};
