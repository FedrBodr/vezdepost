import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IntegrationManager,
  socialIntegrationList,
} from './integration.manager';
import { analyzePlatformContentV2 } from '@gitroom/helpers/utils/platform.content.analysis';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('IntegrationManager trusted V2 capability resolution', () => {
  it('resolves LinkedIn Page through the LinkedIn profile without losing its identifier', async () => {
    const resolved = await new IntegrationManager().resolveCapabilitiesV2({
      providerName: 'linkedin-page',
      settings: {},
      media: [],
    });

    expect(resolved).toMatchObject({
      identifier: 'linkedin-page',
      profileIdentifier: 'linkedin',
      variant: 'feed',
    });
  });

  it('exposes Slack platform and recommended limits and corrects the adapter limit', async () => {
    const manager = new IntegrationManager();
    const resolved = await manager.resolveCapabilitiesV2({
      providerName: 'slack',
      settings: {},
      media: [],
    });

    expect(resolved.fields[0].limit).toEqual({
      max: 40_000,
      recommendedMax: 4_000,
      source: 'platform',
      unit: 'utf16-code-units',
    });
    expect(manager.getSocialIntegration('slack').maxLength()).toBe(40_000);
  });

  it('selects TikTok variants from trusted media and corrects the adapter limit', async () => {
    const manager = new IntegrationManager();
    const video = await manager.resolveCapabilitiesV2({
      providerName: 'tiktok',
      settings: {},
      media: [{ type: 'video' }],
    });
    const photo = await manager.resolveCapabilitiesV2({
      providerName: 'tiktok',
      settings: {},
      media: [{ type: 'image' }, { type: 'image' }],
    });

    expect(video).toMatchObject({
      variant: 'video',
      fields: [expect.objectContaining({ key: 'caption' })],
    });
    expect(photo).toMatchObject({
      variant: 'photo',
      fields: [
        expect.objectContaining({ key: 'title' }),
        expect.objectContaining({ key: 'description' }),
      ],
    });
    expect(manager.getSocialIntegration('tiktok').maxLength()).toBe(2_200);
  });

  it('uses the Mastodon safety fallback when no stored integration can enrich it', async () => {
    const resolved = await new IntegrationManager().resolveCapabilitiesV2({
      providerName: 'mastodon',
      settings: {},
      media: [],
    });

    expect(resolved).toMatchObject({
      verification: 'runtime',
      fields: [
        expect.objectContaining({
          limit: expect.objectContaining({
            max: 500,
            source: 'application-safety',
          }),
        }),
      ],
      diagnostics: [expect.objectContaining({ code: 'runtime-data-missing' })],
    });
  });

  it('applies runtime capability data returned by the provider for a stored integration', async () => {
    const manager = new IntegrationManager();
    const provider = manager.getSocialIntegration('mastodon');
    vi.spyOn(provider, 'fetchCapabilityRuntime').mockResolvedValue({
      observedAt: new Date().toISOString(),
      textLimits: {
        body: { max: 777, unit: 'graphemes', source: 'runtime' },
      },
      mediaRule: {
        type: 'optional',
        images: { min: 1, max: 6 },
        videos: { min: 1, max: 6 },
        mixed: true,
      },
    });

    const resolved = await manager.resolveCapabilitiesV2({
      providerName: 'mastodon',
      settings: {},
      media: [],
      integration: { id: 'stored-mastodon-integration' } as never,
    });

    expect(provider.fetchCapabilityRuntime).toHaveBeenCalledExactlyOnceWith(
      { id: 'stored-mastodon-integration' },
      {}
    );
    expect(resolved).toMatchObject({
      fields: [
        expect.objectContaining({
          limit: { max: 777, unit: 'graphemes', source: 'runtime' },
        }),
      ],
      media: {
        type: 'optional',
        images: { min: 1, max: 6 },
        videos: { min: 1, max: 6 },
        mixed: true,
      },
      runtimeOverlay: expect.objectContaining({
        textLimits: {
          body: { max: 777, unit: 'graphemes', source: 'runtime' },
        },
      }),
      diagnostics: [],
    });
  });

  it('forwards post settings, not integration additionalSettings, to fetchCapabilityRuntime', async () => {
    const manager = new IntegrationManager();
    const provider = manager.getSocialIntegration('reddit');
    const spy = vi
      .spyOn(provider, 'fetchCapabilityRuntime')
      .mockResolvedValue(undefined);

    const integration = {
      id: 'stored-reddit-integration',
      additionalSettings: JSON.stringify([
        { title: 'Unrelated', value: true },
      ]),
    } as never;
    const postSettings = {
      subreddit: [{ value: { subreddit: '/r/testing', type: 'self' } }],
    };

    await manager.resolveCapabilitiesV2({
      providerName: 'reddit',
      settings: postSettings,
      media: [],
      integration,
    });

    expect(spy).toHaveBeenCalledExactlyOnceWith(integration, postSettings);
  });

  it('ignores client-supplied limit escalation in settings', async () => {
    const manager = new IntegrationManager();
    const provider = manager.getSocialIntegration('mastodon');
    vi.spyOn(provider, 'fetchCapabilityRuntime').mockResolvedValue({
      observedAt: new Date().toISOString(),
      textLimits: {
        body: { max: 300, unit: 'graphemes', source: 'runtime' },
      },
    });

    const resolved = await manager.resolveCapabilitiesV2({
      providerName: 'mastodon',
      settings: {
        maximumCharacters: 999_999,
        verification: 'verified',
        runtimeOverlay: {
          observedAt: new Date().toISOString(),
          textLimits: {
            body: { max: 999_999, unit: 'graphemes', source: 'runtime' },
          },
        },
      },
      media: [],
      integration: { id: 'stored-mastodon-integration' } as never,
    });

    expect(resolved.verification).toBe('runtime');
    expect(resolved.fields[0].limit?.max).toBe(300);
  });

  it('keeps the X fallback conservative when settings forge premium verification', async () => {
    const resolved = await new IntegrationManager().resolveCapabilitiesV2({
      providerName: 'x',
      settings: [{ title: 'Verified', value: true }],
      media: [],
    });

    expect(resolved).toMatchObject({
      verification: 'runtime',
      fields: [
        expect.objectContaining({
          limit: {
            max: 280,
            unit: 'weighted',
            counter: 'x-weighted',
            source: 'platform',
          },
        }),
      ],
      diagnostics: [expect.objectContaining({ code: 'runtime-data-missing' })],
    });
  });

  it('preserves explicit X weighted measurement and rejects weighted CJK overflow', async () => {
    const resolved = await new IntegrationManager().resolveCapabilitiesV2({
      providerName: 'x',
      settings: {},
      media: [],
    });
    const analysis = analyzePlatformContentV2({
      canonicalHtml: `<p>${'漢'.repeat(141)}</p>`,
      settings: {},
      media: [],
      capability: resolved,
    });

    expect(resolved.fields[0].limit).toEqual({
      max: 280,
      unit: 'weighted',
      counter: 'x-weighted',
      source: 'platform',
    });
    expect(analysis.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'text-too-long',
        measured: 282,
        limit: 280,
        unit: 'weighted',
      })
    );
    expect(analysis.blocking).toBe(true);
  });

  it('raises X to premium 4000 only through the stored entitlement', async () => {
    const manager = new IntegrationManager();

    const resolved = await manager.resolveCapabilitiesV2({
      providerName: 'x',
      settings: {},
      media: [],
      integration: {
        updatedAt: new Date('2026-08-21T00:00:00.000Z'),
        additionalSettings: JSON.stringify([
          { title: 'Verified', value: true },
        ]),
      } as never,
    });

    expect(resolved).toMatchObject({
      verification: 'runtime',
      fields: [
        expect.objectContaining({
          limit: {
            max: 4_000,
            unit: 'weighted',
            counter: 'x-weighted',
            source: 'runtime',
          },
        }),
      ],
      diagnostics: [],
    });
  });

  it('keeps X at the 280 fallback with a warning when the entitlement is absent', async () => {
    const resolved = await new IntegrationManager().resolveCapabilitiesV2({
      providerName: 'x',
      settings: {},
      media: [],
      integration: {
        updatedAt: new Date('2026-08-21T00:00:00.000Z'),
        additionalSettings: JSON.stringify([]),
      } as never,
    });

    expect(resolved.fields[0].limit).toMatchObject({
      max: 280,
      source: 'platform',
    });
    expect(resolved.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'runtime-data-missing' })
    );
  });

  it('ignores a forged settings.capabilitiesV2 payload for X premium', async () => {
    const resolved = await new IntegrationManager().resolveCapabilitiesV2({
      providerName: 'x',
      settings: {
        capabilitiesV2: {
          runtimeOverlay: {
            observedAt: new Date().toISOString(),
            textLimits: {
              body: {
                max: 4_000,
                unit: 'weighted',
                counter: 'x-weighted',
                source: 'runtime',
              },
            },
          },
        },
      },
      media: [],
    });

    expect(resolved.verification).toBe('runtime');
    expect(resolved.fields[0].limit?.max).toBe(280);
    expect(resolved.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'runtime-data-missing' })
    );
  });
});

describe('IntegrationManager deployment availability', () => {
  it('keeps every provider allowed when the environment value is blank', async () => {
    vi.stubEnv('ENABLED_SOCIAL_INTEGRATIONS', '   ');
    const manager = new IntegrationManager();
    const catalogue = await manager.getAllIntegrations();

    expect(manager.getAllowedSocialsIntegrations()).toEqual(
      socialIntegrationList.map(({ identifier }) => identifier)
    );
    expect(catalogue.social).toHaveLength(socialIntegrationList.length);
    expect(catalogue.social.every(({ canConnect }) => canConnect)).toBe(true);
  });

  it('adds canConnect without filtering or reordering the catalogue', async () => {
    vi.stubEnv(
      'ENABLED_SOCIAL_INTEGRATIONS',
      ' telegram, X,telegram,unknown-provider '
    );
    const warning = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const manager = new IntegrationManager();
    const catalogue = await manager.getAllIntegrations();

    expect(manager.getAllowedSocialsIntegrations()).toEqual(['x', 'telegram']);
    expect(manager.isSocialIntegrationAllowed('x')).toBe(true);
    expect(manager.isSocialIntegrationAllowed('reddit')).toBe(false);
    expect(catalogue.social.map(({ identifier }) => identifier)).toEqual(
      socialIntegrationList.map(({ identifier }) => identifier)
    );
    expect(
      catalogue.social.find(({ identifier }) => identifier === 'x')
    ).toMatchObject({ canConnect: true });
    expect(
      catalogue.social.find(({ identifier }) => identifier === 'reddit')
    ).toMatchObject({ canConnect: false });
    expect(warning).toHaveBeenCalledExactlyOnceWith(
      '[integrations] Ignoring unknown ENABLED_SOCIAL_INTEGRATIONS identifiers: unknown-provider'
    );
  });
});
