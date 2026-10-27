import { describe, expect, it, vi } from 'vitest';
import { IntegrationsController } from './integrations.controller';

vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { set: vi.fn(), get: vi.fn(), del: vi.fn() },
}));

describe('IntegrationsController connect CSRF cookie', () => {
  it('pins the OAuth state to the browser via the connect_oauth_state cookie', async () => {
    const provider = {
      generateAuthUrl: vi.fn().mockResolvedValue({
        codeVerifier: 'verifier-fixture',
        state: 'state-fixture',
        url: 'https://provider.example/oauth?state=state-fixture',
      }),
    };
    const manager = {
      isSocialIntegrationAllowedForOrg: vi.fn().mockReturnValue(true),
      getMigrationTarget: vi.fn().mockReturnValue(undefined),
      getSocialIntegration: vi.fn().mockReturnValue(provider),
    };
    const controller = new IntegrationsController(
      manager as never,
      {} as never,
      {} as never,
      {} as never
    );
    const response = { cookie: vi.fn() };

    const result = await controller.getIntegrationUrl(
      'telegram',
      '',
      '',
      '',
      '',
      { id: 'org-1' } as never,
      response as never
    );

    expect(result).toEqual({ url: expect.stringContaining('state-fixture') });
    expect(response.cookie).toHaveBeenCalledWith(
      'connect_oauth_state',
      'state-fixture',
      expect.objectContaining({ expires: expect.any(Date) })
    );
  });

  it('exposes whether the provider supports analytics as a boolean', async () => {
    const integration = {
      id: 'integration-1',
      internalId: 'account-1',
      providerIdentifier: 'with-analytics',
      additionalSettings: '[]',
      postingTimes: '[]',
      name: 'Account',
      disabled: false,
      picture: null as string | null,
      inBetweenSteps: false,
      refreshNeeded: false,
      profile: 'account',
      type: 'social',
      customer: null as unknown,
    };
    const manager = {
      getSocialIntegration: vi.fn((identifier: string) =>
        identifier === 'with-analytics'
          ? { editor: 'normal', analytics: vi.fn() }
          : { editor: 'normal' }
      ),
      resolveCapabilitiesV2: vi.fn().mockResolvedValue({}),
    };
    const integrationService = {
      getIntegrationsList: vi.fn().mockResolvedValue([
        integration,
        {
          ...integration,
          id: 'integration-2',
          providerIdentifier: 'without-analytics',
        },
      ]),
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

    expect(response.integrations[0].analytics).toBe(true);
    expect(response.integrations[1].analytics).toBe(false);
  });
});

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

  it('exposes whether the provider supports analytics as a boolean', async () => {
    const integration = {
      id: 'integration-1',
      internalId: 'account-1',
      providerIdentifier: 'with-analytics',
      additionalSettings: '[]',
      postingTimes: '[]',
      name: 'Account',
      disabled: false,
      picture: null as string | null,
      inBetweenSteps: false,
      refreshNeeded: false,
      profile: 'account',
      type: 'social',
      customer: null as unknown,
    };
    const manager = {
      getSocialIntegration: vi.fn((identifier: string) =>
        identifier === 'with-analytics'
          ? { editor: 'normal', analytics: vi.fn() }
          : { editor: 'normal' }
      ),
      resolveCapabilitiesV2: vi.fn().mockResolvedValue({}),
    };
    const integrationService = {
      getIntegrationsList: vi.fn().mockResolvedValue([
        integration,
        {
          ...integration,
          id: 'integration-2',
          providerIdentifier: 'without-analytics',
        },
      ]),
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

    expect(response.integrations[0].analytics).toBe(true);
    expect(response.integrations[1].analytics).toBe(false);
  });
});
