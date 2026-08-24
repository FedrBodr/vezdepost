import type {
  CapabilityDiagnostic,
  MediaRule,
  ResolvedPlatformCapabilityV2,
  StaticMediaRule,
  TextFieldCapability,
} from './platform.capability.types';
import { measureContent } from './platform.content.measurement';
import {
  containsVisibleRawUrl,
  normalizePlatformFields,
  normalizedFieldMeasurementValue,
  type NormalizePlatformFieldsInput,
  type NormalizedPlatformField,
} from './platform.content.normalizers';

export type AnalyzePlatformContentV2Input = NormalizePlatformFieldsInput & {
  media: ReadonlyArray<{ type?: 'image' | 'video' }>;
};

export type PlatformContentAnalysisV2 = {
  fields: Readonly<Record<string, NormalizedPlatformField>>;
  diagnostics: readonly CapabilityDiagnostic[];
  blocking: boolean;
};

const fieldDiagnostic = (
  code: string,
  severity: CapabilityDiagnostic['severity'],
  capability: ResolvedPlatformCapabilityV2,
  field: TextFieldCapability,
  message: string,
  measurement?: {
    measured: number;
    limit: number;
    unit: NonNullable<TextFieldCapability['limit']>['unit'];
  }
): CapabilityDiagnostic => ({
  code,
  severity,
  destination: capability.identifier,
  variant: capability.variant,
  field: field.key,
  ...(measurement ?? {}),
  message,
});

const unitLabel = (
  unit: NonNullable<TextFieldCapability['limit']>['unit']
): string => {
  switch (unit) {
    case 'graphemes':
      return 'grapheme';
    case 'utf16-code-units':
      return 'UTF-16-code-unit';
    case 'utf8-bytes':
      return 'UTF-8-byte';
    case 'weighted':
      return 'weighted-character';
  }
};

const mediaMatchesStaticRule = (
  rule: StaticMediaRule,
  media: AnalyzePlatformContentV2Input['media']
): boolean => {
  const imageCount = media.filter(({ type }) => type === 'image').length;
  const videoCount = media.filter(({ type }) => type === 'video').length;
  const knownCount = imageCount + videoCount;
  if (knownCount !== media.length) {
    return false;
  }
  if (rule.maxTotal !== undefined && knownCount > rule.maxTotal) {
    return false;
  }

  if (rule.type === 'none') {
    return media.length === 0;
  }
  if (rule.type === 'exclusive') {
    if (media.length === 0) return rule.optional === true;
    return rule.alternatives.some((alternative) => {
      if (alternative.kind === 'images') {
        return (
          videoCount === 0 &&
          imageCount >= alternative.min &&
          imageCount <= alternative.max
        );
      }
      const requiredCoverImages = alternative.coverRequired ? 1 : 0;
      return (
        imageCount === requiredCoverImages &&
        videoCount >= alternative.min &&
        videoCount <= alternative.max
      );
    });
  }
  if (rule.type === 'required' && media.length === 0) {
    return false;
  }
  if (media.length === 0) {
    return true;
  }
  if (rule.images === undefined && rule.videos === undefined) {
    return true;
  }
  const videoCoverRequired =
    videoCount > 0 && rule.videos?.coverRequired === true;
  if (videoCoverRequired && imageCount === 0) {
    return false;
  }
  if (
    imageCount > 0 &&
    rule.images === undefined &&
    !(videoCoverRequired && imageCount === 1)
  ) {
    return false;
  }
  if (videoCount > 0 && rule.videos === undefined) {
    return false;
  }
  if (imageCount > 0 && rule.images) {
    if (
      imageCount < rule.images.min ||
      (rule.images.max !== undefined && imageCount > rule.images.max)
    ) {
      return false;
    }
  }
  if (videoCount > 0 && rule.videos) {
    if (
      videoCount < rule.videos.min ||
      (rule.videos.max !== undefined && videoCount > rule.videos.max)
    ) {
      return false;
    }
  }
  return (
    videoCoverRequired ||
    rule.mixed === true ||
    imageCount === 0 ||
    videoCount === 0
  );
};

const mediaMatchesRule = (
  rule: MediaRule,
  media: AnalyzePlatformContentV2Input['media']
): boolean =>
  rule.type === 'provider-runtime'
    ? mediaMatchesStaticRule(rule.fallback, media)
    : mediaMatchesStaticRule(rule, media);

const staticMediaRule = (rule: MediaRule): StaticMediaRule =>
  rule.type === 'provider-runtime' ? rule.fallback : rule;

type FormattingKey = keyof TextFieldCapability['formatting'];

const formattingTags: ReadonlyArray<{
  pattern: RegExp;
  key: FormattingKey;
}> = [
  { pattern: /<(?:strong|b)\b/i, key: 'bold' },
  { pattern: /<u\b/i, key: 'underline' },
  { pattern: /<a\b/i, key: 'links' },
  { pattern: /<(?:ul|ol|li)\b/i, key: 'lists' },
  { pattern: /<h[1-6]\b/i, key: 'headings' },
];

const losesFormatting = (
  canonicalHtml: string,
  field: TextFieldCapability
): boolean =>
  formattingTags.some(
    ({ pattern, key }) =>
      pattern.test(canonicalHtml) &&
      field.formatting[key] !== 'native' &&
      field.formatting[key] !== 'unicode'
  );

const hasMeaningfulSetting = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return value !== undefined && value !== null;
};

export const analyzePlatformContentV2 = ({
  canonicalHtml,
  settings,
  media,
  capability,
  convertMentionFunction,
}: AnalyzePlatformContentV2Input): PlatformContentAnalysisV2 => {
  const fields = normalizePlatformFields({
    canonicalHtml,
    settings,
    capability,
    media,
    convertMentionFunction,
  });
  const diagnostics: CapabilityDiagnostic[] = [...capability.diagnostics];
  const measurements = new Map<
    string,
    { measured: number; exceeded: boolean }
  >();

  for (const field of capability.structuredFields) {
    if (field.required && !hasMeaningfulSetting(settings[field.key])) {
      diagnostics.push({
        code: 'required-field-missing',
        severity: 'error',
        destination: capability.identifier,
        variant: capability.variant,
        field: field.key,
        message: `${field.label} is required.`,
      });
    }
  }

  for (const field of capability.fields) {
    const normalized = fields[field.key];
    if (!normalized) {
      continue;
    }
    if (
      field.source === 'canonical-editor' &&
      losesFormatting(canonicalHtml, field)
    ) {
      diagnostics.push(
        fieldDiagnostic(
          'formatting-loss',
          'warning',
          capability,
          field,
          `Some formatting in ${field.label} will be converted or removed.`
        )
      );
    }
    const settingValue = settings[field.key];
    const sourceValue =
      field.source === 'canonical-editor'
        ? canonicalHtml
        : typeof settingValue === 'string'
        ? settingValue
        : '';
    if (
      capability.delivery.stripRawUrls &&
      containsVisibleRawUrl(sourceValue)
    ) {
      diagnostics.push(
        fieldDiagnostic(
          'raw-url-removed',
          'warning',
          capability,
          field,
          'Raw HTTP(S) URLs will be removed before publishing.'
        )
      );
    }
    const measurementValue = normalizedFieldMeasurementValue(
      normalized.value,
      field
    );
    if (field.required && measurementValue.trim().length === 0) {
      diagnostics.push(
        fieldDiagnostic(
          'required-field-missing',
          'error',
          capability,
          field,
          `${field.label} is required.`
        )
      );
    }
    if (!field.limit) {
      continue;
    }

    const measured = measureContent(measurementValue, field.limit);
    measurements.set(field.key, measured);
    const isSplitCaption =
      field.key === 'caption' &&
      capability.delivery.longMediaText === 'split-after-media';
    if (measured.exceeded && !isSplitCaption) {
      diagnostics.push(
        fieldDiagnostic(
          'text-too-long',
          'error',
          capability,
          field,
          `${field.label} exceeds the ${field.limit.max}-${unitLabel(
            field.limit.unit
          )} limit.`,
          {
            measured: measured.measured,
            limit: field.limit.max,
            unit: field.limit.unit,
          }
        )
      );
    } else if (
      !measured.exceeded &&
      field.limit.recommendedMax !== undefined &&
      measured.measured > field.limit.recommendedMax
    ) {
      diagnostics.push(
        fieldDiagnostic(
          'recommended-limit-exceeded',
          'warning',
          capability,
          field,
          `${field.label} exceeds the recommended ${
            field.limit.recommendedMax
          }-${unitLabel(field.limit.unit)} limit.`,
          {
            measured: measured.measured,
            limit: field.limit.recommendedMax,
            unit: field.limit.unit,
          }
        )
      );
    }
  }

  const knownMediaCount = media.filter(
    ({ type }) => type === 'image' || type === 'video'
  ).length;
  const maxTotal = staticMediaRule(capability.media).maxTotal;
  if (maxTotal !== undefined && knownMediaCount > maxTotal) {
    diagnostics.push({
      code: 'too-many-media',
      severity: 'error',
      destination: capability.identifier,
      variant: capability.variant,
      measured: knownMediaCount,
      limit: maxTotal,
      message: `Attached media exceeds the ${maxTotal}-item total limit.`,
    });
  } else if (!mediaMatchesRule(capability.media, media)) {
    diagnostics.push({
      code: 'unsupported-media',
      severity: 'error',
      destination: capability.identifier,
      variant: capability.variant,
      message: `Attached media does not match the ${capability.variant} variant requirements.`,
    });
  }

  const bodyField = capability.fields.find(({ key }) => key === 'body');
  const captionField = capability.fields.find(({ key }) => key === 'caption');
  const bodyMeasurement = measurements.get('body');
  const captionMeasurement = measurements.get('caption');
  if (
    media.length > 0 &&
    capability.delivery.longMediaText === 'split-after-media' &&
    bodyField?.limit &&
    captionField?.limit &&
    bodyMeasurement &&
    captionMeasurement?.exceeded &&
    !bodyMeasurement.exceeded
  ) {
    diagnostics.push(
      fieldDiagnostic(
        'media-text-split',
        'information',
        capability,
        captionField,
        'Media will be published first, followed by the full text as a separate message.',
        {
          measured: captionMeasurement.measured,
          limit: captionField.limit.max,
          unit: captionField.limit.unit,
        }
      )
    );
  }

  return {
    fields,
    diagnostics,
    blocking: diagnostics.some(({ severity }) => severity === 'error'),
  };
};
