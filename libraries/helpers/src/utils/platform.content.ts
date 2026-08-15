import striptags from 'striptags';
import { weightedLength } from './count.length';
import { convertHtmlStructureToText } from './html.structure';
import { stripHtmlValidation } from './strip.html.validation';
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
  severity: ContentMessageSeverity;
  code:
    | 'formatting-loss'
    | 'text-too-long'
    | 'media-required'
    | 'unsupported-media'
    | 'too-many-images'
    | 'too-many-videos'
    | 'video-cover-required'
    | 'media-text-split';
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

export const analyzePlatformContent = ({
  content,
  media,
  capabilities,
}: {
  content: string;
  media: Array<{ type?: 'image' | 'video' }>;
  capabilities: PlatformCapabilities;
}): PlatformContentAnalysis => {
  const normalized = normalizePlatformContent(content, capabilities);
  const plainText = striptags(normalized);
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
}: {
  content: string;
  media: Array<{ type?: 'image' | 'video' }>;
  capabilities: PlatformCapabilities[];
}): PlatformContentAnalysis => {
  const analyses = capabilities.map((profile) =>
    analyzePlatformContent({ content, media, capabilities: profile })
  );
  const messages = analyses.flatMap((analysis, index) =>
    analysis.messages.map((message) => ({
      ...message,
      platform: capabilities[index].identifier,
      text: `${capabilities[index].identifier}: ${message.text}`,
    }))
  );
  return {
    normalized: normalizePlatformContent(
      content,
      intersectPlatformCapabilities(capabilities)
    ),
    visibleLength: Math.max(...analyses.map((item) => item.visibleLength), 0),
    blocking: messages.some((item) => item.severity === 'error'),
    messages,
  };
};
