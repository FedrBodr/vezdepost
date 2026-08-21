import { PLATFORM_CAPABILITY_PROFILES } from './platform.capability.profiles';
import type {
  CapabilityDiagnostic,
  CapabilityResolutionContext,
  PlatformCapabilityProfileV2,
  PostVariantCapability,
  ResolvedPlatformCapabilityV2,
  TextFieldCapability,
} from './platform.capability.types';

const plainFormatting: TextFieldCapability['formatting'] = {
  bold: 'unicode',
  underline: 'unicode',
  links: 'plain',
  lists: 'plain',
  headings: 'plain',
};

const unsupportedFormatting: TextFieldCapability['formatting'] = {
  bold: 'unsupported',
  underline: 'unsupported',
  links: 'unsupported',
  lists: 'unsupported',
  headings: 'unsupported',
};

const nativeFormatting: TextFieldCapability['formatting'] = {
  bold: 'native',
  underline: 'native',
  links: 'native',
  lists: 'native',
  headings: 'native',
};

const adapterFormatting = (
  editor: NonNullable<CapabilityResolutionContext['adapter']>['editor']
): TextFieldCapability['formatting'] => {
  switch (editor) {
    case 'none':
      return unsupportedFormatting;
    case 'normal':
      return plainFormatting;
    case 'markdown':
    case 'html':
      return nativeFormatting;
  }
};

const adapterDialect = (
  editor: NonNullable<CapabilityResolutionContext['adapter']>['editor']
): TextFieldCapability['dialect'] => {
  switch (editor) {
    case 'none':
    case 'normal':
      return 'plain';
    case 'markdown':
      return 'markdown';
    case 'html':
      return 'html';
  }
};

export const createUnverifiedAdapterProfile = (
  context: CapabilityResolutionContext
): PlatformCapabilityProfileV2 => {
  if (!context.adapter) {
    throw new Error(
      `Unverified platform ${context.identifier} requires explicit adapter capabilities`
    );
  }
  const adapter = context.adapter;
  const field: TextFieldCapability = {
    key: 'body',
    label: 'Body',
    required: false,
    source: 'canonical-editor',
    dialect: adapterDialect(adapter.editor),
    limit: {
      max: adapter.maximum,
      unit: adapter.measurement?.unit ?? 'utf16-code-units',
      source: 'application-safety',
      ...(adapter.measurement?.counter
        ? { counter: adapter.measurement.counter }
        : {}),
    },
    formatting: adapterFormatting(adapter.editor),
  };

  return {
    identifier: context.identifier,
    displayName: context.identifier,
    verification: 'unverified-adapter',
    evidenceDate: '2026-08-20',
    defaultVariant: 'adapter',
    variants: {
      adapter: {
        key: 'adapter',
        fields: [field],
        structuredFields: [],
        media: { type: 'optional' },
        delivery: {
          longMediaText: 'not-applicable',
          stripRawUrls: adapter.stripRawUrls,
        },
      },
    },
  };
};

const diagnostic = (
  code: string,
  destination: string,
  variant: string,
  severity: CapabilityDiagnostic['severity'],
  message: string
): CapabilityDiagnostic => ({ code, destination, variant, severity, message });

const selectVariant = (
  profile: PlatformCapabilityProfileV2,
  context: CapabilityResolutionContext,
  destination: string
): { key: string; diagnostics: CapabilityDiagnostic[] } => {
  if (profile.identifier === 'telegram') {
    return { key: context.media.length ? 'media' : 'text', diagnostics: [] };
  }

  if (profile.identifier !== 'tiktok') {
    return { key: profile.defaultVariant, diagnostics: [] };
  }

  if (context.media.length === 1 && context.media[0].type === 'video') {
    return { key: 'video', diagnostics: [] };
  }
  if (
    context.media.length > 0 &&
    context.media.every((media) => media.type === 'image')
  ) {
    return { key: 'photo', diagnostics: [] };
  }

  return {
    key: profile.defaultVariant,
    diagnostics: [
      diagnostic(
        'invalid-media-variant',
        destination,
        profile.defaultVariant,
        'error',
        'TikTok requires exactly one video or one to 35 images.'
      ),
    ],
  };
};

const isRuntimeOverlayFresh = (
  profile: PlatformCapabilityProfileV2,
  context: CapabilityResolutionContext
): boolean => {
  if (!context.runtimeOverlay || !profile.runtimeMaxAgeSeconds) {
    return !!context.runtimeOverlay;
  }

  const observedAt = Date.parse(context.runtimeOverlay.observedAt);
  const now = context.now ? Date.parse(context.now) : Date.now();
  return (
    Number.isFinite(observedAt) &&
    Number.isFinite(now) &&
    now - observedAt <= profile.runtimeMaxAgeSeconds * 1_000
  );
};

const applyRuntimeOverlay = (
  variant: PostVariantCapability,
  profile: PlatformCapabilityProfileV2,
  context: CapabilityResolutionContext
): {
  variant: PostVariantCapability;
  runtimeOverlay?: ResolvedPlatformCapabilityV2['runtimeOverlay'];
  runtimeObservedAt?: string;
  diagnostics: CapabilityDiagnostic[];
} => {
  if (profile.verification !== 'runtime') {
    return { variant, diagnostics: [] };
  }

  if (!isRuntimeOverlayFresh(profile, context)) {
    return {
      variant,
      diagnostics: [
        diagnostic(
          'runtime-data-missing',
          context.identifier,
          variant.key,
          'warning',
          'Current platform capability data is unavailable; a safe fallback is in use.'
        ),
      ],
    };
  }

  const overlay = context.runtimeOverlay!;
  const runtimeKeys = profile.runtimeKeys ?? [];
  const textLimits = overlay.textLimits
    ? Object.fromEntries(
        Object.entries(overlay.textLimits).map(([key, limit]) => [
          key,
          { ...limit, source: 'runtime' as const },
        ])
      )
    : undefined;
  const runtimeOverlay = textLimits ? { ...overlay, textLimits } : overlay;
  const fields =
    runtimeKeys.includes('text-limit') && textLimits
      ? variant.fields.map((field) => {
          const limit = textLimits[field.key];
          return limit ? { ...field, limit } : field;
        })
      : variant.fields;
  const media =
    runtimeKeys.includes('media-rule') && overlay.mediaRule
      ? overlay.mediaRule
      : variant.media;

  return {
    variant: { ...variant, fields, media },
    runtimeOverlay,
    runtimeObservedAt: overlay.observedAt,
    diagnostics: [],
  };
};

const cloneAndDeepFreeze = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneAndDeepFreeze)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          cloneAndDeepFreeze(child),
        ])
      )
    ) as T;
  }
  return value;
};

export const resolvePlatformCapabilityV2 = (
  context: CapabilityResolutionContext
): ResolvedPlatformCapabilityV2 => {
  const requestedProfile = PLATFORM_CAPABILITY_PROFILES[context.identifier];
  const profile = requestedProfile?.aliasOf
    ? PLATFORM_CAPABILITY_PROFILES[requestedProfile.aliasOf]
    : requestedProfile ?? createUnverifiedAdapterProfile(context);
  const { key, diagnostics } = selectVariant(
    profile,
    context,
    context.identifier
  );
  const variant = profile.variants[key];

  if (!variant) {
    throw new Error(
      `Platform profile ${profile.identifier} has no ${key} variant`
    );
  }

  const runtime = applyRuntimeOverlay(variant, profile, context);
  return cloneAndDeepFreeze({
    identifier: context.identifier,
    profileIdentifier: profile.identifier,
    verification: profile.verification,
    evidenceDate: profile.evidenceDate,
    variant: runtime.variant.key,
    fields: runtime.variant.fields,
    structuredFields: runtime.variant.structuredFields.map((field) => ({
      ...field,
    })),
    media: runtime.variant.media,
    delivery: runtime.variant.delivery,
    ...(runtime.runtimeOverlay
      ? {
          runtimeOverlay: runtime.runtimeOverlay,
          runtimeObservedAt: runtime.runtimeObservedAt,
        }
      : {}),
    diagnostics: [...diagnostics, ...runtime.diagnostics],
  });
};
