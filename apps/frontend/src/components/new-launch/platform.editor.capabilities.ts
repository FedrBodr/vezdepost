import type { Internal, SelectedIntegrations } from './store';
import { deriveGlobalTargets } from './global.targets';
import { resolvePlatformCapabilityV2 } from '@gitroom/helpers/utils/platform.capability.resolver';
import { analyzePlatformContentV2 } from '@gitroom/helpers/utils/platform.content.analysis';
import { measureContent } from '@gitroom/helpers/utils/platform.content.measurement';
import { normalizedFieldMeasurementValue } from '@gitroom/helpers/utils/platform.content.normalizers';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { getEditorSemanticPolicy } from './platform.editor.semantic-policy';
import type {
  CapabilityDiagnostic,
  CapabilityResolutionContext,
  ContentLimit,
  FormattingSupport,
  ResolvedPlatformCapabilityV2,
  TextFieldCapability,
} from '@gitroom/helpers/utils/platform.capability.types';

export type FormattingControl =
  | 'bold'
  | 'underline'
  | 'italic'
  | 'strike'
  | 'link'
  | 'list'
  | 'ordered-list'
  | 'heading';

export type EditorMediaV2 = {
  path?: string;
  type?: 'image' | 'video';
};

export type EditorCapabilityDiagnosticV2 = CapabilityDiagnostic & {
  targetIntegrationId?: string;
};

export interface EditorCounterV2 {
  targetIntegrationId: string;
  destination: string;
  destinationName: string;
  fieldKey: string;
  fieldLabel: string;
  measured: number;
  limit: ContentLimit;
}

export interface EditorDestinationCapabilityV2 {
  targetIntegrationId: string;
  destinationName: string;
  capability: ResolvedPlatformCapabilityV2;
  canonicalFields: readonly TextFieldCapability[];
  activeField?: TextFieldCapability;
  diagnostics: readonly EditorCapabilityDiagnosticV2[];
  blocking: boolean;
}

export interface EditorCapabilityV2 {
  identifier: string;
  formatting: TextFieldCapability['formatting'];
  destinations: readonly EditorDestinationCapabilityV2[];
  counters: readonly EditorCounterV2[];
  diagnostics: readonly EditorCapabilityDiagnosticV2[];
  blocking: boolean;
  sourceHasContent: boolean;
}

const defaultFormatting: TextFieldCapability['formatting'] = {
  bold: 'native',
  underline: 'native',
  italic: 'native',
  strike: 'native',
  links: 'native',
  lists: 'native',
  orderedLists: 'native',
  headings: 'native',
};

const supportRank: readonly FormattingSupport[] = [
  'unsupported',
  'plain',
  'unicode',
  'native',
];

const weakestSupport = (values: readonly FormattingSupport[]) =>
  supportRank[Math.min(...values.map((value) => supportRank.indexOf(value)))];

const intersectFormatting = (
  fields: readonly TextFieldCapability[]
): TextFieldCapability['formatting'] => {
  if (!fields.length) {
    return defaultFormatting;
  }

  return {
    bold: weakestSupport(fields.map(({ formatting }) => formatting.bold)),
    underline: weakestSupport(
      fields.map(({ formatting }) => formatting.underline)
    ),
    italic: weakestSupport(fields.map(({ formatting }) => formatting.italic)),
    strike: weakestSupport(fields.map(({ formatting }) => formatting.strike)),
    links: weakestSupport(fields.map(({ formatting }) => formatting.links)),
    lists: weakestSupport(fields.map(({ formatting }) => formatting.lists)),
    orderedLists: weakestSupport(
      fields.map(({ formatting }) => formatting.orderedLists)
    ),
    headings: weakestSupport(
      fields.map(({ formatting }) => formatting.headings)
    ),
  };
};

export const deriveActiveEditorFormatting = (
  destinations: readonly Pick<EditorDestinationCapabilityV2, 'activeField'>[]
): TextFieldCapability['formatting'] =>
  intersectFormatting(
    destinations.flatMap(({ activeField }) =>
      activeField ? [activeField] : []
    )
  );

const editorFromSerializedCapability = (
  capability?: ResolvedPlatformCapabilityV2
): NonNullable<CapabilityResolutionContext['adapter']>['editor'] => {
  const field = capability?.fields.find(
    ({ source }) => source === 'canonical-editor'
  );
  switch (field?.dialect) {
    case 'html':
      return 'html';
    case 'markdown':
    case 'discord-markdown':
    case 'slack-mrkdwn':
      return 'markdown';
    case 'plain':
    case 'bluesky-facets':
      return field &&
        Object.values(field.formatting).every(
          (support) => support === 'unsupported'
        )
        ? 'none'
        : 'normal';
    default:
      return 'normal';
  }
};

const adapterFromSerializedCapability = (
  capability?: ResolvedPlatformCapabilityV2
): CapabilityResolutionContext['adapter'] => {
  if (!capability) {
    return undefined;
  }
  const field = capability.fields.find(
    ({ source }) => source === 'canonical-editor'
  );
  return {
    editor: editorFromSerializedCapability(capability),
    maximum: field?.limit?.max ?? 1_000_000,
    stripRawUrls: capability.delivery.stripRawUrls,
    ...(field?.limit
      ? {
          measurement: {
            unit: field.limit.unit,
            ...(field.limit.counter ? { counter: field.limit.counter } : {}),
          },
        }
      : {}),
  };
};

const mediaForCapability = (
  media: readonly EditorMediaV2[]
): CapabilityResolutionContext['media'] =>
  media.map((item) => ({
    ...(item.type === 'image' || item.type === 'video'
      ? { type: item.type }
      : item.path?.split('?')[0].toLowerCase().endsWith('.mp4')
      ? { type: 'video' as const }
      : item.path
      ? { type: 'image' as const }
      : {}),
  }));

const settingsForCapability = (
  settings: unknown
): Readonly<Record<string, unknown>> =>
  settings && typeof settings === 'object' && !Array.isArray(settings)
    ? (settings as Readonly<Record<string, unknown>>)
    : {};

const activeCanonicalField = (
  capability: ResolvedPlatformCapabilityV2,
  media: CapabilityResolutionContext['media']
): TextFieldCapability | undefined => {
  const canonicalFields = capability.fields.filter(
    ({ source }) => source === 'canonical-editor'
  );
  if (
    media.length > 0 &&
    capability.delivery.longMediaText === 'split-after-media'
  ) {
    return (
      canonicalFields.find(({ key }) => key === 'caption') ?? canonicalFields[0]
    );
  }
  return canonicalFields[0];
};

const resolveDestination = (
  selected: SelectedIntegrations,
  canonicalHtml: string,
  media: CapabilityResolutionContext['media']
): {
  destination: EditorDestinationCapabilityV2;
  counter?: EditorCounterV2;
} => {
  const serialized = selected.integration.capabilitiesV2;
  const settings = settingsForCapability(selected.settings);
  const adapter = adapterFromSerializedCapability(serialized);
  const capability = resolvePlatformCapabilityV2({
    identifier: selected.integration.identifier,
    settings,
    media,
    ...(serialized?.runtimeOverlay
      ? { runtimeOverlay: serialized.runtimeOverlay }
      : {}),
    ...(adapter ? { adapter } : {}),
  });
  const analysis = analyzePlatformContentV2({
    canonicalHtml,
    settings,
    media,
    capability,
  });
  const diagnostics = analysis.diagnostics.map((diagnostic) => ({
    ...diagnostic,
    targetIntegrationId: selected.integration.id,
  }));
  const canonicalFields = capability.fields.filter(
    ({ source }) => source === 'canonical-editor'
  );
  const activeField = activeCanonicalField(capability, media);
  const normalized = activeField ? analysis.fields[activeField.key] : undefined;
  const measurement =
    activeField?.limit && normalized
      ? measureContent(
          normalizedFieldMeasurementValue(normalized.value, activeField),
          activeField.limit
        )
      : undefined;

  return {
    destination: {
      targetIntegrationId: selected.integration.id,
      destinationName:
        selected.integration.name || selected.integration.identifier,
      capability,
      canonicalFields,
      activeField,
      diagnostics,
      blocking: analysis.blocking,
    },
    ...(activeField?.limit && measurement
      ? {
          counter: {
            targetIntegrationId: selected.integration.id,
            destination: capability.identifier,
            destinationName:
              selected.integration.name || selected.integration.identifier,
            fieldKey: activeField.key,
            fieldLabel: activeField.label,
            measured: measurement.measured,
            limit: activeField.limit,
          },
        }
      : {}),
  };
};

export const resolveEditorCapabilityV2 = (
  current: string,
  selected: readonly SelectedIntegrations[],
  internal: readonly Internal[] = [],
  content = '',
  media: readonly EditorMediaV2[] = []
): EditorCapabilityV2 => {
  const targets =
    current === 'global'
      ? deriveGlobalTargets(selected, internal)
      : selected.filter(({ integration }) => integration.id === current);
  const capabilityMedia = mediaForCapability(media);
  const resolved = targets.map((target) =>
    resolveDestination(target, content, capabilityMedia)
  );
  const destinations = resolved.map(({ destination }) => destination);
  const diagnostics = destinations.flatMap(
    (destination) => destination.diagnostics
  );

  return {
    identifier: current,
    formatting: deriveActiveEditorFormatting(destinations),
    destinations,
    counters: resolved.flatMap(({ counter }) => (counter ? [counter] : [])),
    diagnostics,
    blocking: destinations.some(({ blocking }) => blocking),
    sourceHasContent: stripHtmlValidation('none', content).trim().length > 0,
  };
};

export const getFormattingControls = (
  capability: Pick<EditorCapabilityV2, 'formatting'>
): FormattingControl[] => {
  const policy = getEditorSemanticPolicy(capability);
  return [
    policy.bold && 'bold',
    policy.underline && 'underline',
    policy.italic && 'italic',
    policy.strike && 'strike',
    policy.link && 'link',
    policy.list && 'list',
    policy.orderedList && 'ordered-list',
    policy.heading && 'heading',
  ].filter(Boolean) as FormattingControl[];
};
