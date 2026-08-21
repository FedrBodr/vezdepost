import { describe, expect, it } from 'vitest';
import {
  PLATFORM_CAPABILITY_PROFILES,
  PROFILE_IDENTIFIERS,
} from './platform.capability.profiles';
import {
  createUnverifiedAdapterProfile,
  resolvePlatformCapabilityV2,
} from './platform.capability.resolver';
import { analyzePlatformContentV2 } from './platform.content.analysis';
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
  it('registers every profile destination exactly once', () => {
    expect(PROFILE_IDENTIFIERS).toEqual([
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
      'bluesky',
      'threads',
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

  it('requires explicit adapter metadata for an unverified destination', () => {
    expect(() =>
      resolvePlatformCapabilityV2({
        identifier: 'future-provider',
        settings: {},
        media: [],
      })
    ).toThrow(
      'Unverified platform future-provider requires explicit adapter capabilities'
    );
  });

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

  it('carries required structured fields into the resolved capability', () => {
    const resolved = resolvePlatformCapabilityV2(
      ctx('pinterest', [{ type: 'image' }])
    );

    expect(resolved.structuredFields).toEqual([
      { key: 'title', label: 'Title', required: false },
      { key: 'link', label: 'Link', required: false },
      { key: 'board', label: 'Board', required: true },
    ]);
    expect(resolved.structuredFields).not.toBe(
      PLATFORM_CAPABILITY_PROFILES.pinterest.variants.pin.structuredFields
    );
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

  it('normalizes accepted runtime text-limit provenance to runtime', () => {
    const resolved = resolvePlatformCapabilityV2(
      ctx('mastodon', [], {
        now: '2026-08-20T10:30:00.000Z',
        runtimeOverlay: {
          observedAt: '2026-08-20T10:00:00.000Z',
          textLimits: {
            body: {
              max: 777,
              unit: 'graphemes',
              source: 'platform',
            },
          },
        },
      })
    );

    expect(resolved.fields[0].limit).toMatchObject({
      max: 777,
      source: 'runtime',
    });
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

  it('rejects stale Mastodon runtime data using the real clock by default', () => {
    const resolved = resolvePlatformCapabilityV2(
      ctx('mastodon', [], {
        runtimeOverlay: {
          observedAt: '2000-01-01T00:00:00.000Z',
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

  it('deep-freezes a fully cloned resolved capability graph', () => {
    const overlay: CapabilityRuntimeOverlay = {
      observedAt: '2026-08-20T10:00:00.000Z',
      textLimits: {
        body: {
          max: 777,
          unit: 'graphemes',
          source: 'platform',
        },
      },
      mediaRule: {
        type: 'exclusive',
        alternatives: [{ kind: 'images', min: 1, max: 4 }],
        maxTotal: 4,
      },
    };
    const resolved = resolvePlatformCapabilityV2(
      ctx('mastodon', [], {
        runtimeOverlay: overlay,
        now: '2026-08-20T10:01:00.000Z',
      })
    );
    const pinterest = resolvePlatformCapabilityV2(
      ctx('pinterest', [{ type: 'image' }])
    );
    const invalidTiktok = resolvePlatformCapabilityV2(ctx('tiktok'));

    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.fields)).toBe(true);
    expect(Object.isFrozen(resolved.fields[0])).toBe(true);
    expect(Object.isFrozen(resolved.fields[0].limit)).toBe(true);
    expect(Object.isFrozen(resolved.fields[0].formatting)).toBe(true);
    expect(Object.isFrozen(resolved.structuredFields)).toBe(true);
    expect(Object.isFrozen(resolved.structuredFields[0])).toBe(true);
    expect(Object.isFrozen(resolved.media)).toBe(true);
    expect(
      resolved.media.type === 'provider-runtime'
        ? resolved.media.fallback.maxTotal
        : resolved.media.maxTotal
    ).toBe(4);
    expect(Object.isFrozen(resolved.delivery)).toBe(true);
    expect(Object.isFrozen(resolved.diagnostics)).toBe(true);
    expect(Object.isFrozen(resolved.runtimeOverlay)).toBe(true);
    expect(Object.isFrozen(resolved.runtimeOverlay?.textLimits)).toBe(true);
    expect(Object.isFrozen(resolved.runtimeOverlay?.textLimits?.body)).toBe(
      true
    );
    expect(Object.isFrozen(resolved.runtimeOverlay?.mediaRule)).toBe(true);
    expect(
      Object.isFrozen(
        resolved.runtimeOverlay?.mediaRule?.type === 'exclusive'
          ? resolved.runtimeOverlay.mediaRule.alternatives
          : undefined
      )
    ).toBe(true);
    expect(
      Object.isFrozen(
        resolved.runtimeOverlay?.mediaRule?.type === 'exclusive'
          ? resolved.runtimeOverlay.mediaRule.alternatives[0]
          : undefined
      )
    ).toBe(true);
    expect(Object.isFrozen(pinterest.structuredFields[2])).toBe(true);
    expect(Object.isFrozen(pinterest.media)).toBe(true);
    expect(
      Object.isFrozen(
        pinterest.media.type === 'exclusive'
          ? pinterest.media.alternatives
          : undefined
      )
    ).toBe(true);
    expect(
      Object.isFrozen(
        pinterest.media.type === 'exclusive'
          ? pinterest.media.alternatives[0]
          : undefined
      )
    ).toBe(true);
    expect(Object.isFrozen(invalidTiktok.diagnostics[0])).toBe(true);

    expect(resolved.runtimeOverlay).not.toBe(overlay);
    expect(resolved.runtimeOverlay?.textLimits).not.toBe(overlay.textLimits);
    expect(resolved.runtimeOverlay?.mediaRule).not.toBe(overlay.mediaRule);
    expect(Object.isFrozen(overlay)).toBe(false);
    expect(Object.isFrozen(overlay.textLimits)).toBe(false);
    expect(Object.isFrozen(overlay.mediaRule)).toBe(false);

    expect(() => {
      (resolved.fields[0].limit as unknown as { max: number }).max = 999_999;
    }).toThrow(TypeError);
    expect(() => {
      (
        pinterest.structuredFields[2] as unknown as { required: boolean }
      ).required = false;
    }).toThrow(TypeError);
    expect(resolved.fields[0].limit?.max).toBe(777);
    expect(pinterest.structuredFields[2].required).toBe(true);
  });

  it('resolves bluesky as a verified grapheme-limited profile', () => {
    const capability = resolvePlatformCapabilityV2(ctx('bluesky'));
    expect(capability).toMatchObject({
      verification: 'verified',
      profileIdentifier: 'bluesky',
      variant: 'post',
    });
    expect(capability.fields[0].limit).toEqual({
      max: 300,
      unit: 'graphemes',
      source: 'platform',
    });
    expect(capability.fields[0].dialect).toBe('bluesky-facets');
  });

  it('rejects five bluesky images beyond the exclusive rule', () => {
    const analysis = analyzePlatformContentV2({
      canonicalHtml: '<p>hi</p>',
      settings: {},
      media: Array.from({ length: 5 }, () => ({ type: 'image' as const })),
      capability: resolvePlatformCapabilityV2(ctx('bluesky')),
    });
    expect(analysis.blocking).toBe(true);
  });

  it('does not mutate frozen bluesky inputs', () => {
    const settings = Object.freeze({ languages: 'en' });
    const media = Object.freeze([{ type: 'image' as const }]);
    const context = Object.freeze({ ...ctx('bluesky', media, { settings }) });

    expect(() => resolvePlatformCapabilityV2(context)).not.toThrow();
    expect(settings).toEqual({ languages: 'en' });
    expect(media).toEqual([{ type: 'image' }]);
  });

  it.each([
    [[], 'text'],
    [[{ type: 'image' }], 'single'],
    [[{ type: 'video' }], 'single'],
    [[{ type: 'image' }, { type: 'image' }], 'carousel'],
  ])('selects threads variant %j -> %s', (media, variant) => {
    expect(resolvePlatformCapabilityV2(ctx('threads', media)).variant).toBe(
      variant
    );
  });

  it('limits threads body to 500 utf16 units', () => {
    expect(resolvePlatformCapabilityV2(ctx('threads')).fields[0].limit).toEqual(
      {
        max: 500,
        unit: 'utf16-code-units',
        source: 'platform',
      }
    );
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
