export type ContentUnit =
  | 'graphemes'
  | 'utf16-code-units'
  | 'utf8-bytes'
  | 'weighted';
export type LimitSource = 'platform' | 'runtime' | 'application-safety';
export type WeightedCounter = 'x-weighted';
export type FormattingDialect =
  | 'plain'
  | 'html'
  | 'markdown'
  | 'slack-mrkdwn'
  | 'discord-markdown'
  | 'bluesky-facets';
export type FormattingSupport = 'native' | 'unicode' | 'plain' | 'unsupported';

export interface ContentLimit {
  max: number;
  unit: ContentUnit;
  source: LimitSource;
  recommendedMax?: number;
  counter?: WeightedCounter;
}

export interface TextFieldCapability {
  key: string;
  label: string;
  required: boolean;
  source: 'canonical-editor' | 'provider-setting';
  dialect: FormattingDialect;
  limit?: ContentLimit;
  formatting: Record<
    'bold' | 'underline' | 'links' | 'lists' | 'headings',
    FormattingSupport
  >;
}

export interface StructuredFieldCapability {
  key: string;
  label: string;
  required: boolean;
}

export interface MediaCardinality {
  min: number;
  max?: number;
}

export type StaticMediaRule = (
  | { type: 'none' }
  | {
      type: 'optional' | 'required';
      images?: MediaCardinality;
      videos?: MediaCardinality & { coverRequired?: boolean };
      mixed?: boolean;
    }
  | {
      type: 'exclusive';
      optional?: boolean;
      alternatives: Array<
        | { kind: 'images'; min: number; max: number }
        | { kind: 'video'; min: 1; max: 1; coverRequired?: boolean }
      >;
    }
) & { maxTotal?: number };

export type MediaRule =
  | StaticMediaRule
  | { type: 'provider-runtime'; fallback: StaticMediaRule };

export interface PostVariantCapability {
  key: string;
  fields: TextFieldCapability[];
  structuredFields: StructuredFieldCapability[];
  media: MediaRule;
  delivery: {
    longMediaText: 'caption' | 'split-after-media' | 'not-applicable';
    stripRawUrls: boolean;
    mediaGroupMaxItems?: number;
  };
}

export interface PlatformCapabilityProfileV2 {
  identifier: string;
  displayName: string;
  verification: 'verified' | 'runtime' | 'unverified-adapter';
  evidenceDate: string;
  defaultVariant: string;
  variants: Readonly<Record<string, PostVariantCapability>>;
  aliasOf?: string;
  runtimeKeys?: readonly ('text-limit' | 'media-rule')[];
  runtimeMaxAgeSeconds?: number;
  runtimeMaxCeiling?: number;
  runtimeCeilings?: Readonly<Record<string, number>>;
}

export interface CapabilityRuntimeOverlay {
  observedAt: string;
  textLimits?: Readonly<Record<string, ContentLimit>>;
  mediaRule?: MediaRule;
}

export interface CapabilityResolutionContext {
  identifier: string;
  settings: Readonly<Record<string, unknown>>;
  media: ReadonlyArray<{ type?: 'image' | 'video' }>;
  runtimeOverlay?: CapabilityRuntimeOverlay;
  now?: string;
  adapter?: {
    editor: 'none' | 'normal' | 'markdown' | 'html';
    maximum: number;
    stripRawUrls: boolean;
    measurement?: Pick<ContentLimit, 'unit' | 'counter'>;
  };
}

export interface ResolvedPlatformCapabilityV2 {
  identifier: string;
  profileIdentifier: string;
  verification: PlatformCapabilityProfileV2['verification'];
  evidenceDate: string;
  variant: string;
  fields: readonly TextFieldCapability[];
  structuredFields: readonly StructuredFieldCapability[];
  media: MediaRule;
  delivery: PostVariantCapability['delivery'];
  runtimeOverlay?: CapabilityRuntimeOverlay;
  runtimeObservedAt?: string;
  diagnostics: readonly CapabilityDiagnostic[];
}

export interface CapabilityDiagnostic {
  code: string;
  severity: 'information' | 'warning' | 'error';
  destination: string;
  variant: string;
  field?: string;
  measured?: number;
  limit?: number;
  unit?: ContentUnit;
  message: string;
}
