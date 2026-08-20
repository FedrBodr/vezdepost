import { describe, expect, it } from 'vitest';
import { BATCH_0_IDENTIFIERS } from './platform.capability.profiles';
import {
  createUnverifiedAdapterProfile,
  resolvePlatformCapabilityV2,
} from './platform.capability.resolver';
import type {
  CapabilityResolutionContext,
  CapabilityRuntimeOverlay,
} from './platform.capability.types';

const ctx = (
  identifier: string,
  media: CapabilityResolutionContext['media'] = [],
  overrides: Partial<CapabilityResolutionContext> = {}
): CapabilityResolutionContext => ({
  identifier,
  settings: {},
  media,
  adapter: {
    editor: 'normal',
    maximum: 5_000,
    stripRawUrls: false,
  },
  ...overrides,
});

describe('Batch 0 platform capability resolution', () => {
  it('registers every Batch 0 destination exactly once', () => {
    expect(BATCH_0_IDENTIFIERS).toEqual([
      'telegram',
      'max',
      'linkedin',
      'linkedin-page',
      'tumblr',
      'pinterest',
      'vk',
      'vk-group',
      'slack',
      'tiktok',
      'mastodon',
    ]);
  });

  it.each([
    ['linkedin-page', [], { profileIdentifier: 'linkedin', variant: 'feed' }],
    ['slack', [], { variant: 'message' }],
    ['tiktok', [{ type: 'video' }], { variant: 'video' }],
    ['tiktok', [{ type: 'image' }], { variant: 'photo' }],
    ['mastodon', [], { verification: 'runtime', variant: 'status' }],
    ['youtube', [], { verification: 'unverified-adapter', variant: 'adapter' }],
  ] as const)(
    'resolves %s deterministically',
    (identifier, media, expected) => {
      expect(resolvePlatformCapabilityV2(ctx(identifier, media))).toMatchObject(
        {
          identifier,
          ...expected,
        }
      );
    }
  );

  it('models Slack API and recommended limits independently', () => {
    expect(resolvePlatformCapabilityV2(ctx('slack')).fields[0].limit).toEqual({
      max: 40_000,
      recommendedMax: 4_000,
      unit: 'utf16-code-units',
      source: 'platform',
    });
  });

  it('selects Telegram text or media variants without weakening its body limit', () => {
    expect(resolvePlatformCapabilityV2(ctx('telegram'))).toMatchObject({
      variant: 'text',
      fields: [
        expect.objectContaining({
          key: 'body',
          limit: expect.objectContaining({ max: 4_096 }),
        }),
      ],
    });
    expect(
      resolvePlatformCapabilityV2(ctx('telegram', [{ type: 'image' }]))
    ).toMatchObject({
      variant: 'media',
      fields: [
        expect.objectContaining({
          key: 'body',
          limit: expect.objectContaining({ max: 4_096 }),
        }),
        expect.objectContaining({
          key: 'caption',
          limit: expect.objectContaining({ max: 1_024 }),
        }),
      ],
      delivery: { longMediaText: 'split-after-media' },
    });
  });

  it('falls back to the TikTok video variant for empty or mixed media', () => {
    for (const media of [
      [],
      [{ type: 'image' as const }, { type: 'video' as const }],
      [{ type: undefined }],
    ]) {
      const resolved = resolvePlatformCapabilityV2(ctx('tiktok', media));
      expect(resolved.variant).toBe('video');
      expect(resolved.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'invalid-media-variant',
          severity: 'error',
          destination: 'tiktok',
          variant: 'video',
        })
      );
    }
  });

  it('uses Mastodon application-safety defaults when runtime data is missing', () => {
    expect(resolvePlatformCapabilityV2(ctx('mastodon'))).toMatchObject({
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

  it('replaces only declared Mastodon runtime values without changing verification', () => {
    const overlay: CapabilityRuntimeOverlay = {
      observedAt: '2026-08-20T10:00:00.000Z',
      textLimits: {
        body: {
          max: 777,
          unit: 'graphemes',
          source: 'runtime',
        },
      },
      mediaRule: {
        type: 'required',
        images: { min: 1, max: 4 },
      },
    };

    const resolved = resolvePlatformCapabilityV2(
      ctx('mastodon', [], {
        runtimeOverlay: overlay,
        now: '2026-08-20T10:30:00.000Z',
      })
    );

    expect(resolved).toMatchObject({
      verification: 'runtime',
      fields: [
        expect.objectContaining({
          limit: { max: 777, unit: 'graphemes', source: 'runtime' },
        }),
      ],
      media: { type: 'required', images: { min: 1, max: 4 } },
      runtimeOverlay: overlay,
      runtimeObservedAt: overlay.observedAt,
    });
    expect(resolved.diagnostics).toEqual([]);
  });

  it('rejects stale Mastodon runtime data using the injected clock', () => {
    const resolved = resolvePlatformCapabilityV2(
      ctx('mastodon', [], {
        now: '2026-08-20T12:00:01.000Z',
        runtimeOverlay: {
          observedAt: '2026-08-20T10:00:00.000Z',
          textLimits: {
            body: {
              max: 777,
              unit: 'graphemes',
              source: 'runtime',
            },
          },
        },
      })
    );

    expect(resolved.fields[0].limit).toMatchObject({
      max: 500,
      source: 'application-safety',
    });
    expect(resolved.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'runtime-data-missing' })
    );
    expect(resolved.runtimeOverlay).toBeUndefined();
  });

  it('does not mutate frozen settings, media, or runtime overlay inputs', () => {
    const settings = Object.freeze({ contentWarning: 'CW' });
    const media = Object.freeze([{ type: 'image' as const }]);
    const overlay = Object.freeze({
      observedAt: '2026-08-20T10:00:00.000Z',
      textLimits: Object.freeze({
        body: Object.freeze({
          max: 777,
          unit: 'graphemes' as const,
          source: 'runtime' as const,
        }),
      }),
    });
    const context = Object.freeze({
      ...ctx('mastodon', media, {
        settings,
        runtimeOverlay: overlay,
        now: '2026-08-20T10:01:00.000Z',
      }),
    });

    expect(() => resolvePlatformCapabilityV2(context)).not.toThrow();
    expect(settings).toEqual({ contentWarning: 'CW' });
    expect(media).toEqual([{ type: 'image' }]);
    expect(overlay).toEqual({
      observedAt: '2026-08-20T10:00:00.000Z',
      textLimits: {
        body: { max: 777, unit: 'graphemes', source: 'runtime' },
      },
    });
  });

  it('bridges an unaudited adapter without claiming platform verification', () => {
    const profile = createUnverifiedAdapterProfile(
      ctx('unknown', [], {
        adapter: { editor: 'html', maximum: 321, stripRawUrls: true },
      })
    );

    expect(profile).toMatchObject({
      identifier: 'unknown',
      verification: 'unverified-adapter',
      defaultVariant: 'adapter',
    });
    expect(profile.variants.adapter).toMatchObject({
      fields: [
        expect.objectContaining({
          key: 'body',
          dialect: 'html',
          limit: {
            max: 321,
            unit: 'utf16-code-units',
            source: 'application-safety',
          },
        }),
      ],
      delivery: { stripRawUrls: true },
    });
  });
});
