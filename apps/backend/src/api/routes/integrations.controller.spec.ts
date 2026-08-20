import { describe, expect, it, vi } from 'vitest';
import { IntegrationsController } from './integrations.controller';

describe('IntegrationsController capability metadata', () => {
  it('serializes server-resolved V2 capabilities for each stored integration', async () => {
    const integration = {
      id: 'integration-1',
      internalId: 'mastodon-account-1',
      providerIdentifier: 'mastodon',
      additionalSettings: JSON.stringify([
        { title: 'Visibility', value: 'public' },
      ]),
      postingTimes: '[]',
      name: 'Mastodon account',
      disabled: false,
      picture: null as string | null,
      inBetweenSteps: false,
      refreshNeeded: false,
      profile: 'mastodon-user',
      type: 'social',
      customer: null as unknown,
    };
    const capabilitiesV2 = {
      identifier: 'mastodon',
      profileIdentifier: 'mastodon',
      verification: 'runtime',
      evidenceDate: '2026-08-20',
      variant: 'status',
      fields: [] as never[],
      structuredFields: [] as never[],
      media: { type: 'optional' },
      delivery: {
        longMediaText: 'not-applicable',
        stripRawUrls: false,
      },
      runtimeOverlay: { observedAt: '2026-08-20T10:00:00.000Z' },
      runtimeObservedAt: '2026-08-20T10:00:00.000Z',
      diagnostics: [] as never[],
    };
    const manager = {
      getSocialIntegration: vi.fn().mockReturnValue({
        editor: 'normal',
        maxLength: () => 500,
      }),
      resolveCapabilitiesV2: vi.fn().mockResolvedValue(capabilitiesV2),
    };
    const integrationService = {
      getIntegrationsList: vi.fn().mockResolvedValue([integration]),
    };
    const controller = new IntegrationsController(
      manager as never,
      integrationService as never,
      {} as never,
      {} as never
    );

    const response = await controller.getIntegrationList({
      id: 'org-1',
    } as never);

    expect(response.integrations[0]).toMatchObject({ capabilitiesV2 });
    expect(response.integrations[0]).not.toHaveProperty('capabilities');
    expect(manager.resolveCapabilitiesV2).toHaveBeenCalledExactlyOnceWith({
      providerName: 'mastodon',
      settings: [{ title: 'Visibility', value: 'public' }],
      media: [],
      integration,
    });
  });
});
