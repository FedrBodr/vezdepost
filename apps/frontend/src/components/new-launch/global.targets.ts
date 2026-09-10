import type { Internal, SelectedIntegrations } from './store';

export const deriveGlobalTargets = (
  selectedIntegrations: readonly SelectedIntegrations[],
  internal: readonly Internal[]
): SelectedIntegrations[] => {
  const overriddenIntegrationIds = new Set(
    internal.map((item) => item.integration.id)
  );

  return selectedIntegrations.filter(
    (item) => !overriddenIntegrationIds.has(item.integration.id)
  );
};
