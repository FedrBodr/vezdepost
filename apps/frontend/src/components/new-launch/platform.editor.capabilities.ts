import type { Internal, SelectedIntegrations } from './store';
import {
  intersectPlatformCapabilities,
  type PlatformCapabilities,
} from '@gitroom/helpers/utils/platform.capabilities';
import { deriveGlobalTargets } from './global.targets';

export type FormattingControl =
  | 'bold'
  | 'underline'
  | 'link'
  | 'list'
  | 'heading';

export const resolveEditorCapabilities = (
  current: string,
  selected: SelectedIntegrations[],
  internal: Internal[] = []
): PlatformCapabilities => {
  if (current === 'global') {
    return intersectPlatformCapabilities(
      deriveGlobalTargets(selected, internal).map(
        (item) => item.integration.capabilities
      )
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
