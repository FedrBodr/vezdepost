import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntegrationManager } from './integration.manager';
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
            unit: 'weighted',
            counter: 'x-weighted',
            source: 'application-safety',
          },
        }),
      ],
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
      source: 'application-safety',
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

  it('derives an unverified bridge limit only from stored integration settings', async () => {
    const manager = new IntegrationManager();
    vi.stubEnv('STRIP_LINKS_FROM_X_POSTS', 'true');

    const resolved = await manager.resolveCapabilitiesV2({
      providerName: 'x',
      settings: {},
      media: [],
      integration: {
        additionalSettings: JSON.stringify([
          { title: 'Verified', value: true },
        ]),
      } as never,
    });

    expect(resolved).toMatchObject({
      verification: 'unverified-adapter',
      fields: [
        expect.objectContaining({
          limit: expect.objectContaining({ max: 4_000 }),
        }),
      ],
      delivery: { stripRawUrls: true },
    });
  });
});
