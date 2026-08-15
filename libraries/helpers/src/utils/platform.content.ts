import striptags from 'striptags';
import { parseFragment, serialize } from 'parse5';
import { weightedLength } from './count.length';
import { convertHtmlStructureToText } from './html.structure';
import { stripHtmlValidation } from './strip.html.validation';
import { getHttpUrlRanges, stripLinks, type HttpUrlRange } from './strip.links';
import {
  getTelegramVisibleTextLength,
  normalizeTelegramHtml,
} from './telegram.constraints';
import {
  ContentMessageSeverity,
  intersectPlatformCapabilities,
  PlatformCapabilities,
} from './platform.capabilities';

export interface PlatformContentMessage {
  platform?: string;
  targetIntegrationId?: string;
  severity: ContentMessageSeverity;
  code:
    | 'formatting-loss'
    | 'text-too-long'
    | 'media-required'
    | 'unsupported-media'
    | 'too-many-images'
    | 'too-many-videos'
    | 'video-cover-required'
    | 'media-text-split'
    | 'raw-url-removed';
  text: string;
}

export interface PlatformContentAnalysis {
  normalized: string;
  visibleLength: number;
  blocking: boolean;
  messages: PlatformContentMessage[];
}

export const normalizePlatformContent = (
  content: string,
  capabilities: PlatformCapabilities,
  convertMentionFunction?: (idOrHandle: string, name: string) => string
): string => {
  if (!/<\/?[a-z][\s\S]*>/i.test(content)) {
    return content;
  }

  if (!capabilities.verified) {
    return stripHtmlValidation(
      capabilities.output,
      content,
      true,
      false,
      false,
      convertMentionFunction
    );
  }

  const canonicalContent =
    capabilities.identifier === 'telegram'
      ? content
          .replace(/<b(?=[\s>])/gi, '<strong')
          .replace(/<\/b>/gi, '</strong>')
      : content;
  const requiresStructuralFallback =
    capabilities.formatting.lists !== 'native' ||
    capabilities.formatting.headings !== 'native';
  const structuredContent = requiresStructuralFallback
    ? convertHtmlStructureToText(canonicalContent)
    : canonicalContent;
  const html = stripHtmlValidation(
    'html',
    structuredContent,
    false,
    false,
    false,
    convertMentionFunction
  );
  if (capabilities.identifier === 'telegram') {
    return normalizeTelegramHtml(html);
  }
  if (capabilities.output === 'html') {
    return striptags(html, ['p', 'strong', 'u', 'a']);
  }
  const outputContent =
    capabilities.output === 'normal' && requiresStructuralFallback
      ? `<p>${structuredContent}</p>`
      : structuredContent;
  return stripHtmlValidation(
    capabilities.output,
    outputContent,
    true,
    false,
    false,
    convertMentionFunction
  );
};

type HtmlNode = {
  nodeName: string;
  tagName?: string;
  value?: string;
  childNodes?: HtmlNode[];
};

type TextNodeRange = {
  node: HtmlNode;
  start: number;
  end: number;
};

const collectVisibleText = (root: HtmlNode) => {
  const textNodes: TextNodeRange[] = [];
  let visibleText = '';
  const visit = (node: HtmlNode) => {
    if (node.nodeName === '#text') {
      const value = node.value || '';
      const start = visibleText.length;
      visibleText += value;
      textNodes.push({ node, start, end: start + value.length });
      return;
    }
    node.childNodes?.forEach(visit);
  };
  visit(root);
  return { textNodes, visibleText };
};

const getDecodedVisibleText = (normalized: string) => {
  if (!/<\/?[a-z][\s\S]*>/i.test(normalized)) {
    return normalized;
  }

  const fragment = parseFragment(normalized) as unknown as HtmlNode;
  return collectVisibleText(fragment).visibleText;
};

const expandRemovalRanges = (
  text: string,
  ranges: HttpUrlRange[]
): HttpUrlRange[] => {
  const clusters = ranges.reduce<HttpUrlRange[]>((grouped, range) => {
    const previous = grouped[grouped.length - 1];
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
      horizontalStart--;
    }
    while (horizontalEnd < text.length && /[ \t]/.test(text[horizontalEnd])) {
      horizontalEnd++;
    }

    const hasContentBefore = horizontalStart > 0;
    const hasContentAfter = horizontalEnd < text.length;
    if (!hasContentBefore || !hasContentAfter) {
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
    const previous = merged[merged.length - 1];
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
) => {
  const value = textNode.node.value || '';
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

const stripVisibleRawUrls = (normalized: string) => {
  if (!/<\/?[a-z][\s\S]*>/i.test(normalized)) {
    const ranges = getHttpUrlRanges(normalized);
    const content = ranges.length ? stripLinks(normalized) : normalized;
    return {
      content,
      removed: ranges.length > 0,
      visibleText: content,
    };
  }

  const parsedFragment = parseFragment(normalized);
  const fragment = parsedFragment as unknown as HtmlNode;
  const { textNodes, visibleText } = collectVisibleText(fragment);

  const ranges = getHttpUrlRanges(visibleText);
  if (!ranges.length) {
    return { content: normalized, removed: false, visibleText };
  }

  const removalRanges = expandRemovalRanges(visibleText, ranges);
  const affectedTextNodes = new Set(
    textNodes
      .filter((textNode) => removeRangesFromTextNode(textNode, removalRanges))
      .map(({ node }) => node)
  );

  const emptyInlineTags = new Set(['a', 'strong', 'u']);
  const affectedBranches = new Map<HtmlNode, boolean>();
  const pruneEmptyInlineFormatting = (node: HtmlNode): boolean => {
    let affected = affectedTextNodes.has(node);
    node.childNodes?.forEach((child) => {
      affected = pruneEmptyInlineFormatting(child) || affected;
    });
    affectedBranches.set(node, affected);
    if (!node.childNodes) {
      return affected;
    }
    node.childNodes = node.childNodes.filter((child) => {
      if (
        !child.tagName ||
        !emptyInlineTags.has(child.tagName) ||
        !affectedBranches.get(child)
      ) {
        return true;
      }
      return collectVisibleText(child).visibleText.trim().length > 0;
    });
    return affected;
  };
  pruneEmptyInlineFormatting(fragment);

  const surviving = collectVisibleText(fragment);
  if (!surviving.visibleText.trim()) {
    surviving.textNodes.forEach(({ node }) => {
      node.value = '';
    });
  }

  const effectiveVisibleText = collectVisibleText(fragment).visibleText;
  return {
    content: serialize(parsedFragment),
    removed: true,
    visibleText: effectiveVisibleText,
  };
};

export const resolveEffectivePlatformContent = ({
  content,
  capabilities,
  convertMentionFunction,
}: {
  content: string;
  capabilities: PlatformCapabilities;
  convertMentionFunction?: (idOrHandle: string, name: string) => string;
}) => {
  const normalized = normalizePlatformContent(
    content,
    capabilities,
    convertMentionFunction
  );
  if (!capabilities.delivery.stripRawUrls) {
    return {
      normalized,
      rawUrlRemoved: false,
      visibleText: getDecodedVisibleText(normalized),
    };
  }

  const effective = stripVisibleRawUrls(normalized);
  return {
    normalized: effective.content,
    rawUrlRemoved: effective.removed,
    visibleText: effective.visibleText,
  };
};

export const analyzePlatformContent = ({
  content,
  media,
  capabilities,
}: {
  content: string;
  media: Array<{ type?: 'image' | 'video' }>;
  capabilities: PlatformCapabilities;
}): PlatformContentAnalysis => {
  const {
    normalized,
    rawUrlRemoved,
    visibleText: plainText,
  } = resolveEffectivePlatformContent({ content, capabilities });
  const rawVisibleLength =
    capabilities.identifier === 'telegram'
      ? getTelegramVisibleTextLength(normalized)
      : plainText.length;
  const visibleLength =
    capabilities.identifier === 'x'
      ? Math.max(weightedLength(plainText), rawVisibleLength)
      : rawVisibleLength;
  const messages: PlatformContentMessage[] = [];
  const imageCount = media.filter((item) => item.type !== 'video').length;
  const videoCount = media.filter((item) => item.type === 'video').length;

  const losesLinks =
    /<a\b/i.test(content) && capabilities.formatting.links !== 'native';
  const losesLists =
    /<(ul|ol|li)\b/i.test(content) &&
    capabilities.formatting.lists !== 'native';
  const losesHeadings =
    /<h[1-6]\b/i.test(content) && capabilities.formatting.headings !== 'native';
  if (losesLinks || losesLists || losesHeadings) {
    messages.push({
      severity: 'warning',
      code: 'formatting-loss',
      text: 'Some formatting will be converted to plain text.',
    });
  }
  if (rawUrlRemoved) {
    messages.push({
      severity: 'warning',
      code: 'raw-url-removed',
      text: 'Raw HTTP(S) URLs will be removed before publishing.',
    });
  }

  if (visibleLength > capabilities.text.max) {
    messages.push({
      severity: 'error',
      code: 'text-too-long',
      text: `Text exceeds the ${capabilities.text.max}-character limit.`,
    });
  }
  if (capabilities.media.required && media.length === 0) {
    messages.push({
      severity: 'error',
      code: 'media-required',
      text: 'This platform requires media.',
    });
  }
  if (
    (!capabilities.media.images && imageCount > 0) ||
    (!capabilities.media.videos && videoCount > 0)
  ) {
    messages.push({
      severity: 'error',
      code: 'unsupported-media',
      text: 'One or more attached media types are not supported.',
    });
  }
  if (
    capabilities.media.maxImages !== undefined &&
    imageCount > capabilities.media.maxImages
  ) {
    messages.push({
      severity: 'error',
      code: 'too-many-images',
      text: `This platform supports up to ${capabilities.media.maxImages} images.`,
    });
  }
  if (
    capabilities.media.maxVideos !== undefined &&
    videoCount > capabilities.media.maxVideos
  ) {
    messages.push({
      severity: 'error',
      code: 'too-many-videos',
      text: `This platform supports up to ${capabilities.media.maxVideos} videos.`,
    });
  }
  if (
    capabilities.media.videoRequiresCover &&
    videoCount > 0 &&
    imageCount === 0
  ) {
    messages.push({
      severity: 'error',
      code: 'video-cover-required',
      text: 'A cover image is required for video.',
    });
  }
  if (
    media.length > 0 &&
    capabilities.text.mediaCaptionMax &&
    visibleLength > capabilities.text.mediaCaptionMax &&
    capabilities.delivery.longMediaText === 'split-after-media'
  ) {
    messages.push({
      severity: 'information',
      code: 'media-text-split',
      text: 'Media will be published first, followed by the full text as a separate message.',
    });
  }
  return {
    normalized,
    visibleLength,
    messages,
    blocking: messages.some((item) => item.severity === 'error'),
  };
};

export const analyzeSelectedPlatformContent = ({
  content,
  media,
  capabilities,
  targetIntegrationIds,
}: {
  content: string;
  media: Array<{ type?: 'image' | 'video' }>;
  capabilities: PlatformCapabilities[];
  targetIntegrationIds?: readonly (string | undefined)[];
}): PlatformContentAnalysis => {
  const analyses = capabilities.map((profile) =>
    analyzePlatformContent({ content, media, capabilities: profile })
  );
  const messages = analyses.flatMap((analysis, index) =>
    analysis.messages.map((message) => ({
      ...message,
      platform: capabilities[index].identifier,
      targetIntegrationId: targetIntegrationIds?.[index],
      text: `${capabilities[index].identifier}: ${message.text}`,
    }))
  );
  return {
    normalized: resolveEffectivePlatformContent({
      content,
      capabilities: intersectPlatformCapabilities(capabilities),
    }).normalized,
    visibleLength: Math.max(...analyses.map((item) => item.visibleLength), 0),
    blocking: messages.some((item) => item.severity === 'error'),
    messages,
  };
};
