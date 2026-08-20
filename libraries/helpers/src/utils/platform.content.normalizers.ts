import { parseFragment, serialize } from 'parse5';
import type {
  ResolvedPlatformCapabilityV2,
  TextFieldCapability,
} from './platform.capability.types';
import { convertHtmlStructureToText } from './html.structure';
import { getHttpUrlRanges, stripLinks, type HttpUrlRange } from './strip.links';
import { convertMention, stripHtmlValidation } from './strip.html.validation';
import { normalizeVerifiedHtml } from './verified.html.normalization';

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

type TextNodeRange = {
  node: HtmlNode;
  start: number;
  end: number;
};

type RenderToken = string | typeof STRUCTURAL_BOUNDARY;

type RenderStyle = 'markdown' | 'slack-mrkdwn';

export type NormalizedPlatformField = {
  value: string;
  facets?: readonly unknown[];
};

export type NormalizePlatformFieldsInput = {
  canonicalHtml: string;
  settings: Readonly<Record<string, unknown>>;
  capability: ResolvedPlatformCapabilityV2;
  convertMentionFunction?: (idOrHandle: string, name: string) => string;
};

const STRUCTURAL_BOUNDARY = Symbol('structural-boundary');

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

const pushBoundary = (tokens: RenderToken[]): void => {
  if (tokens.at(-1) !== STRUCTURAL_BOUNDARY) {
    tokens.push(STRUCTURAL_BOUNDARY);
  }
};

const escapeDialectText = (value: string, style: RenderStyle): string => {
  if (style === 'slack-mrkdwn') {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  return value.replace(/([\\`*_[\]{}()#+\-.!|])/g, '\\$1');
};

const escapeLinkDestination = (value: string, style: RenderStyle): string =>
  style === 'slack-mrkdwn'
    ? value
        .replace(
          /[|<>]/g,
          (character) =>
            `%${character.charCodeAt(0).toString(16).toUpperCase()}`
        )
        .replace(/&/g, '&amp;')
    : value
        .replace(/\\/g, '\\\\')
        .replace(/[()]/g, '\\$&')
        .replace(/[<>\s]/g, (character) => encodeURIComponent(character));

const ALLOWED_GENERATED_LINK_PROTOCOLS = new Set([
  'http:',
  'https:',
  'mailto:',
]);

const normalizeGeneratedLinkHref = (value: string): string | undefined => {
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, '');
  try {
    return ALLOWED_GENERATED_LINK_PROTOCOLS.has(new URL(normalized).protocol)
      ? normalized
      : undefined;
  } catch {
    return undefined;
  }
};

const renderInline = (
  node: HtmlNode,
  style: RenderStyle,
  convertMentionFunction?: (idOrHandle: string, name: string) => string
): string => {
  const tokens: RenderToken[] = [];
  renderNode(node, tokens, style, convertMentionFunction, false);
  return joinTokens(tokens);
};

const renderChildren = (
  node: HtmlNode,
  tokens: RenderToken[],
  style: RenderStyle,
  convertMentionFunction: NormalizePlatformFieldsInput['convertMentionFunction'],
  inListItem: boolean
): void => {
  for (const child of getChildNodes(node)) {
    renderNode(child, tokens, style, convertMentionFunction, inListItem);
  }
};

const renderList = (
  node: HtmlNode,
  tokens: RenderToken[],
  style: RenderStyle,
  convertMentionFunction: NormalizePlatformFieldsInput['convertMentionFunction'],
  ordered: boolean
): void => {
  pushBoundary(tokens);
  let itemNumber = 0;
  for (const child of getChildNodes(node)) {
    if (child.nodeName === '#text' && !/\S/.test(child.value ?? '')) {
      continue;
    }
    if (child.tagName !== 'li') {
      renderNode(child, tokens, style, convertMentionFunction, false);
      continue;
    }
    itemNumber += 1;
    pushBoundary(tokens);
    tokens.push(ordered ? `${itemNumber}. ` : '- ');
    renderChildren(child, tokens, style, convertMentionFunction, true);
    pushBoundary(tokens);
  }
  pushBoundary(tokens);
};

const renderNode = (
  node: HtmlNode,
  tokens: RenderToken[],
  style: RenderStyle,
  convertMentionFunction: NormalizePlatformFieldsInput['convertMentionFunction'],
  inListItem: boolean
): void => {
  if (node.nodeName === '#text') {
    tokens.push(escapeDialectText(node.value ?? '', style));
    return;
  }

  const tagName = node.tagName;
  if (!tagName) {
    renderChildren(node, tokens, style, convertMentionFunction, inListItem);
    return;
  }

  const mentionId =
    tagName === 'span' ? getAttribute(node, 'data-mention-id') : undefined;
  if (mentionId !== undefined && convertMentionFunction) {
    tokens.push(convertMentionFunction(mentionId, collectNodeText(node)));
    return;
  }

  if (tagName === 'br') {
    tokens.push('\n');
    return;
  }
  if (tagName === 'ul' || tagName === 'ol') {
    renderList(node, tokens, style, convertMentionFunction, tagName === 'ol');
    return;
  }
  if (tagName === 'li') {
    pushBoundary(tokens);
    tokens.push('- ');
    renderChildren(node, tokens, style, convertMentionFunction, true);
    pushBoundary(tokens);
    return;
  }
  if (tagName === 'p') {
    if (!inListItem) {
      pushBoundary(tokens);
    }
    renderChildren(node, tokens, style, convertMentionFunction, inListItem);
    pushBoundary(tokens);
    return;
  }
  if (/^h[1-6]$/.test(tagName)) {
    pushBoundary(tokens);
    if (style === 'markdown') {
      tokens.push(`${'#'.repeat(Number(tagName[1]))} `);
    }
    renderChildren(node, tokens, style, convertMentionFunction, inListItem);
    pushBoundary(tokens);
    return;
  }

  const inner = getChildNodes(node)
    .map((child) => renderInline(child, style, convertMentionFunction))
    .join('');
  if (tagName === 'strong' || tagName === 'b') {
    const marker = style === 'slack-mrkdwn' ? '*' : '**';
    tokens.push(`${marker}${inner}${marker}`);
    return;
  }
  if (tagName === 'em' || tagName === 'i') {
    tokens.push(
      `${style === 'slack-mrkdwn' ? '_' : '*'}${inner}${
        style === 'slack-mrkdwn' ? '_' : '*'
      }`
    );
    return;
  }
  if (tagName === 'u') {
    tokens.push(style === 'markdown' ? `__${inner}__` : inner);
    return;
  }
  if (tagName === 'a') {
    const rawHref = getAttribute(node, 'href');
    const href = rawHref ? normalizeGeneratedLinkHref(rawHref) : undefined;
    if (!href) {
      tokens.push(inner);
    } else if (style === 'slack-mrkdwn') {
      const destination = escapeLinkDestination(href, style);
      tokens.push(
        inner === href ? `<${destination}>` : `<${destination}|${inner}>`
      );
    } else {
      tokens.push(`[${inner}](${escapeLinkDestination(href, style)})`);
    }
    return;
  }

  tokens.push(inner);
};

const joinTokens = (tokens: RenderToken[]): string => {
  const normalized = [...tokens];
  const firstContent = normalized.findIndex(
    (token) => token === STRUCTURAL_BOUNDARY || /\S/.test(token as string)
  );
  if (normalized[firstContent] === STRUCTURAL_BOUNDARY) {
    normalized.splice(firstContent, 1);
  }

  let lastContent = normalized.length - 1;
  while (
    lastContent >= 0 &&
    normalized[lastContent] !== STRUCTURAL_BOUNDARY &&
    !/\S/.test(normalized[lastContent] as string)
  ) {
    lastContent -= 1;
  }
  if (normalized[lastContent] === STRUCTURAL_BOUNDARY) {
    normalized.splice(lastContent, 1);
  }

  return normalized
    .map((token) => (token === STRUCTURAL_BOUNDARY ? '\n' : token))
    .join('');
};

const renderMarkupDialect = (
  canonicalHtml: string,
  style: RenderStyle,
  convertMentionFunction?: NormalizePlatformFieldsInput['convertMentionFunction']
): string => {
  if (!/<\/?[a-z][\s\S]*>/i.test(canonicalHtml)) {
    return escapeDialectText(canonicalHtml, style);
  }
  const fragment = parseFragment(canonicalHtml) as unknown as HtmlNode;
  const tokens: RenderToken[] = [];
  renderChildren(fragment, tokens, style, convertMentionFunction, false);
  return joinTokens(tokens);
};

const normalizePlain = (
  canonicalHtml: string,
  convertMentionFunction?: NormalizePlatformFieldsInput['convertMentionFunction'],
  unicodeFallback = true
): string => {
  if (!/<\/?[a-z][\s\S]*>/i.test(canonicalHtml)) {
    return canonicalHtml;
  }
  const structured = convertHtmlStructureToText(canonicalHtml);
  if (!unicodeFallback) {
    return stripHtmlValidation(
      'none',
      convertMention(structured, convertMentionFunction)
    );
  }
  return stripHtmlValidation(
    'normal',
    `<p>${structured}</p>`,
    true,
    false,
    false,
    convertMentionFunction
  );
};

const normalizeHtml = (
  canonicalHtml: string,
  capability: ResolvedPlatformCapabilityV2,
  convertMentionFunction?: NormalizePlatformFieldsInput['convertMentionFunction']
): string => {
  if (
    capability.profileIdentifier === 'telegram' ||
    capability.profileIdentifier === 'max'
  ) {
    return normalizeVerifiedHtml(
      canonicalHtml,
      capability.profileIdentifier,
      convertMentionFunction
    ).normalized;
  }
  if (!/<\/?[a-z][\s\S]*>/i.test(canonicalHtml)) {
    return canonicalHtml;
  }
  return stripHtmlValidation(
    'html',
    canonicalHtml,
    false,
    false,
    false,
    convertMentionFunction
  );
};

const normalizeCanonicalField = (
  canonicalHtml: string,
  field: TextFieldCapability,
  capability: ResolvedPlatformCapabilityV2,
  convertMentionFunction?: NormalizePlatformFieldsInput['convertMentionFunction']
): string => {
  switch (field.dialect) {
    case 'html':
      return normalizeHtml(canonicalHtml, capability, convertMentionFunction);
    case 'markdown':
    case 'discord-markdown':
      return renderMarkupDialect(
        canonicalHtml,
        'markdown',
        convertMentionFunction
      );
    case 'slack-mrkdwn':
      return renderMarkupDialect(
        canonicalHtml,
        'slack-mrkdwn',
        convertMentionFunction
      );
    case 'plain':
    case 'bluesky-facets':
      return normalizePlain(
        canonicalHtml,
        convertMentionFunction,
        field.formatting.bold === 'unicode' ||
          field.formatting.underline === 'unicode'
      );
  }
};

const visibleBoundaryTags = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
]);

const collectVisibleText = (root: HtmlNode) => {
  const textNodes: TextNodeRange[] = [];
  let visibleText = '';
  let pendingBoundary = false;

  const markBoundary = () => {
    if (visibleText.length > 0 && !visibleText.endsWith('\n')) {
      pendingBoundary = true;
    }
  };

  const visit = (node: HtmlNode) => {
    if (node.nodeName === '#text') {
      const value = node.value ?? '';
      if (pendingBoundary && !/\S/.test(value)) {
        return;
      }
      if (pendingBoundary) {
        if (!/^\r?\n/.test(value)) {
          visibleText += '\n';
        }
        pendingBoundary = false;
      }
      const start = visibleText.length;
      visibleText += value;
      textNodes.push({ node, start, end: start + value.length });
      return;
    }

    if (node.tagName === 'br') {
      markBoundary();
      return;
    }
    const introducesBoundary =
      node.tagName !== undefined && visibleBoundaryTags.has(node.tagName);
    if (introducesBoundary) {
      markBoundary();
    }
    getChildNodes(node).forEach(visit);
    if (introducesBoundary) {
      markBoundary();
    }
  };
  visit(root);
  return { textNodes, visibleText };
};

const expandRemovalRanges = (
  text: string,
  ranges: HttpUrlRange[]
): HttpUrlRange[] => {
  const clusters = ranges.reduce<HttpUrlRange[]>((grouped, range) => {
    const previous = grouped.at(-1);
    if (previous && /^[ \t]*$/.test(text.slice(previous.end, range.start))) {
      previous.end = range.end;
    } else {
      grouped.push({ ...range });
    }
    return grouped;
  }, []);

  const expanded = clusters.map((range) => {
    let horizontalStart = range.start;
    let horizontalEnd = range.end;
    while (horizontalStart > 0 && /[ \t]/.test(text[horizontalStart - 1])) {
      horizontalStart -= 1;
    }
    while (horizontalEnd < text.length && /[ \t]/.test(text[horizontalEnd])) {
      horizontalEnd += 1;
    }
    if (horizontalStart === 0 || horizontalEnd === text.length) {
      return { start: horizontalStart, end: horizontalEnd };
    }
    if (/\r|\n/.test(text[horizontalEnd])) {
      return { start: horizontalStart, end: horizontalEnd };
    }
    if (horizontalStart < range.start) {
      return { start: horizontalStart + 1, end: horizontalEnd };
    }
    if (horizontalEnd > range.end) {
      return { start: range.start, end: horizontalEnd - 1 };
    }
    return range;
  });

  return expanded.reduce<HttpUrlRange[]>((merged, range) => {
    const previous = merged.at(-1);
    if (!previous || range.start > previous.end) {
      merged.push({ ...range });
    } else {
      previous.end = Math.max(previous.end, range.end);
    }
    return merged;
  }, []);
};

const removeRangesFromTextNode = (
  textNode: TextNodeRange,
  ranges: HttpUrlRange[]
): boolean => {
  const value = textNode.node.value ?? '';
  let cursor = 0;
  let stripped = '';
  let affected = false;
  for (const range of ranges) {
    const removalStart = Math.max(range.start, textNode.start);
    const removalEnd = Math.min(range.end, textNode.end);
    if (removalStart >= removalEnd) {
      continue;
    }
    affected = true;
    const localStart = removalStart - textNode.start;
    const localEnd = removalEnd - textNode.start;
    stripped += value.slice(cursor, localStart);
    cursor = localEnd;
  }
  if (affected) {
    textNode.node.value = stripped + value.slice(cursor);
  }
  return affected;
};

const stripVisibleRawUrls = (value: string): string => {
  if (!/<\/?[a-z][\s\S]*>/i.test(value)) {
    return getHttpUrlRanges(value).length ? stripLinks(value) : value;
  }

  const parsedFragment = parseFragment(value);
  const fragment = parsedFragment as unknown as HtmlNode;
  const { textNodes, visibleText } = collectVisibleText(fragment);
  const ranges = getHttpUrlRanges(visibleText);
  if (!ranges.length) {
    return value;
  }
  const removalRanges = expandRemovalRanges(visibleText, ranges);
  const affectedTextNodes = new Set(
    textNodes
      .filter((textNode) => removeRangesFromTextNode(textNode, removalRanges))
      .map(({ node }) => node)
  );

  const affectedBranches = new Map<HtmlNode, boolean>();
  const emptyInlineTags = new Set(['a', 'strong', 'b', 'u', 'em', 'i']);
  const pruneEmptyInlineFormatting = (node: HtmlNode): boolean => {
    let affected = affectedTextNodes.has(node);
    getChildNodes(node).forEach((child) => {
      affected = pruneEmptyInlineFormatting(child) || affected;
    });
    affectedBranches.set(node, affected);
    if (node.childNodes) {
      node.childNodes = node.childNodes.filter(
        (child) =>
          !child.tagName ||
          !emptyInlineTags.has(child.tagName) ||
          !affectedBranches.get(child) ||
          collectVisibleText(child).visibleText.trim().length > 0
      );
    }
    return affected;
  };
  pruneEmptyInlineFormatting(fragment);

  const surviving = collectVisibleText(fragment);
  if (!surviving.visibleText.trim()) {
    surviving.textNodes.forEach(({ node }) => {
      node.value = '';
    });
  }
  return serialize(parsedFragment);
};

const providerSettingValue = (
  settings: Readonly<Record<string, unknown>>,
  field: TextFieldCapability
): string => {
  const value = settings[field.key];
  return typeof value === 'string' ? value : '';
};

export const normalizePlatformFields = ({
  canonicalHtml,
  settings,
  capability,
  convertMentionFunction,
}: NormalizePlatformFieldsInput): Readonly<
  Record<string, NormalizedPlatformField>
> =>
  Object.fromEntries(
    capability.fields.map((field) => {
      const value = (() => {
        if (field.source === 'provider-setting') {
          const setting = providerSettingValue(settings, field);
          return capability.delivery.stripRawUrls
            ? stripVisibleRawUrls(setting)
            : setting;
        }
        const effectiveCanonicalHtml = capability.delivery.stripRawUrls
          ? stripVisibleRawUrls(canonicalHtml)
          : canonicalHtml;
        return normalizeCanonicalField(
          effectiveCanonicalHtml,
          field,
          capability,
          convertMentionFunction
        );
      })();
      return [
        field.key,
        {
          value,
          facets: undefined,
        },
      ];
    })
  );

export const normalizedFieldMeasurementValue = (
  value: string,
  field: TextFieldCapability
): string => {
  if (field.dialect !== 'html') {
    return value;
  }
  return collectVisibleText(parseFragment(value) as unknown as HtmlNode)
    .visibleText;
};

export const containsVisibleRawUrl = (value: string): boolean => {
  const visibleText = /<\/?[a-z][\s\S]*>/i.test(value)
    ? collectVisibleText(parseFragment(value) as unknown as HtmlNode)
        .visibleText
    : value;
  return getHttpUrlRanges(visibleText).length > 0;
};
