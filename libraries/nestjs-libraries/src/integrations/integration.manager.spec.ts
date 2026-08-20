import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntegrationManager } from './integration.manager';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('IntegrationManager capability metadata', () => {
  it('uses the shared registry as the source of the VK limit', () => {
    const manager = new IntegrationManager();
    expect(manager.getCapabilities('vk')).toMatchObject({
      identifier: 'vk',
      verified: true,
      text: { max: 16384 },
    });
  });

  it('passes provider settings to legacy capability limits', () => {
    const manager = new IntegrationManager();
    expect(
      manager.getCapabilities('x', [{ title: 'Verified', value: true }])
    ).toMatchObject({
      identifier: 'x',
      verified: false,
      text: { max: 4000 },
    });
  });

  it('derives raw URL stripping from an X-style legacy provider', () => {
    vi.stubEnv('STRIP_LINKS_FROM_X_POSTS', 'true');

    expect(new IntegrationManager().getCapabilities('x')).toMatchObject({
      identifier: 'x',
      verified: false,
      delivery: { stripRawUrls: true },
    });
  });

  it('overlays explicit provider URL stripping on a verified profile', () => {
    const manager = new IntegrationManager();
    const capabilities = manager.getCapabilities('telegram');
    const provider = new Proxy(manager.getSocialIntegration('telegram'), {
      get(target, property, receiver) {
        if (property === 'capabilities') return capabilities;
        if (property === 'stripLinks') return () => true;
        return Reflect.get(target, property, receiver);
      },
    });
    vi.spyOn(manager, 'getSocialIntegration').mockReturnValue(provider);

    expect(manager.getCapabilities('future-verified')).toMatchObject({
      verified: true,
      delivery: { stripRawUrls: true },
    });
  });
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

    expect(provider.fetchCapabilityRuntime).toHaveBeenCalledExactlyOnceWith({
      id: 'stored-mastodon-integration',
    });
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

  it('keeps the unverified X bridge conservative when settings forge premium verification', async () => {
    const resolved = await new IntegrationManager().resolveCapabilitiesV2({
      providerName: 'x',
      settings: [{ title: 'Verified', value: true }],
      media: [],
    });

    expect(resolved).toMatchObject({
      verification: 'unverified-adapter',
      fields: [
        expect.objectContaining({
          limit: {
            max: 280,
            unit: 'utf16-code-units',
            source: 'application-safety',
          },
        }),
      ],
    });
  });
});
