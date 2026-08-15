import type { SelectedIntegrations } from './store';
import {
  intersectPlatformCapabilities,
  type PlatformCapabilities,
} from '@gitroom/helpers/utils/platform.capabilities';

export type FormattingControl =
  | 'bold'
  | 'underline'
  | 'link'
  | 'list'
  | 'heading';

export type ControlDependentEditorExtension = Extract<
  FormattingControl,
  'link' | 'heading'
>;

export const resolveEditorCapabilities = (
  current: string,
  selected: SelectedIntegrations[]
): PlatformCapabilities => {
  if (current === 'global') {
    return intersectPlatformCapabilities(
      selected.map((item) => item.integration.capabilities)
    );
  }

  return (
    selected.find((item) => item.integration.id === current)?.integration
      .capabilities || intersectPlatformCapabilities([])
  );
};

export const getFormattingControls = (
  capabilities: PlatformCapabilities
): FormattingControl[] =>
  [
    capabilities.formatting.bold !== 'unsupported' && 'bold',
    capabilities.formatting.underline !== 'unsupported' && 'underline',
    capabilities.formatting.links === 'native' && 'link',
    capabilities.formatting.lists === 'native' && 'list',
    capabilities.formatting.headings === 'native' && 'heading',
  ].filter(Boolean) as FormattingControl[];

export const getControlDependentEditorExtensions = (
  capabilities: PlatformCapabilities
): ControlDependentEditorExtension[] => {
  const controls = getFormattingControls(capabilities);

  return (['link', 'heading'] as const).filter((extension) =>
    controls.includes(extension)
  );
};
