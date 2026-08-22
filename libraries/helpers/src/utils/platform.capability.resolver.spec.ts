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
import { normalizePlatformFields } from './platform.content.normalizers';
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
      'youtube',
      'x',
      'reddit',
      'instagram',
      'instagram-standalone',
      'facebook',
      'discord',
      'twitch',
      'kick',
      'lemmy',
      'wrapcast',
      'nostr',
      'medium',
      'devto',
      'hashnode',
      'wordpress',
    ]);
  });

  it.each([
    [
      'story with media',
      { post_type: 'story' },
      [{ type: 'image' as const }],
      { variant: 'story', diagnostics: [] },
    ],
    [
      'single video reel',
      {},
      [{ type: 'video' as const }],
      { variant: 'reel', diagnostics: [] },
    ],
    [
      'two images feed',
      {},
      [{ type: 'image' as const }, { type: 'image' as const }],
      { variant: 'feed', diagnostics: [] },
    ],
    [
      'trial reel with one video',
      { is_trial_reel: true },
      [{ type: 'video' as const }],
      { variant: 'trial-reel', diagnostics: [] },
    ],
  ] as const)(
    'selects instagram variant for %s',
    (_name, settings, media, expected) => {
      expect(
        resolvePlatformCapabilityV2(ctx('instagram', media, { settings }))
      ).toMatchObject({
        identifier: 'instagram',
        profileIdentifier: 'instagram',
        verification: 'verified',
        ...expected,
      });
    }
  );

  it('falls back to feed with an error diagnostic for trial reels without a single video', () => {
    const resolved = resolvePlatformCapabilityV2(
      ctx('instagram', [{ type: 'image' }, { type: 'image' }], {
        settings: { is_trial_reel: true },
      })
    );
    expect(resolved.variant).toBe('feed');
    expect(resolved.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'invalid-media-variant',
        severity: 'error',
        destination: 'instagram',
        variant: 'feed',
      })
    );
  });

  it('resolves instagram-standalone through the instagram profile alias', () => {
    expect(resolvePlatformCapabilityV2(ctx('instagram-standalone'))).toEqual(
      expect.objectContaining({
        identifier: 'instagram-standalone',
        profileIdentifier: 'instagram',
        verification: 'verified',
        variant: 'feed',
      })
    );
  });

  it.each([
    [
      'story setting',
      { post_type: 'story' },
      [{ type: 'image' as const }],
      { variant: 'story', diagnostics: [] },
    ],
    [
      'first video media',
      {},
      [{ type: 'video' as const }],
      { variant: 'video', diagnostics: [] },
    ],
    [
      'image media',
      {},
      [{ type: 'image' as const }],
      { variant: 'feed', diagnostics: [] },
    ],
    [
      'no media',
      {},
      [],
      { variant: 'feed', diagnostics: [] },
    ],
  ] as const)(
    'selects facebook variant for %s',
    (_name, settings, media, expected) => {
      expect(
        resolvePlatformCapabilityV2(ctx('facebook', media, { settings }))
      ).toMatchObject({
        identifier: 'facebook',
        profileIdentifier: 'facebook',
        verification: 'verified',
        ...expected,
      });
    }
  );

  it('limits facebook feed body to 63,206 utf16 units with an optional link field', () => {
    const resolved = resolvePlatformCapabilityV2(ctx('facebook'));
    expect(resolved.variant).toBe('feed');
    expect(resolved.fields[0].limit).toEqual({
      max: 63_206,
      unit: 'utf16-code-units',
      source: 'platform',
    });
    expect(resolved.fields[0].dialect).toBe('plain');
    expect(resolved.structuredFields).toEqual([
      { key: 'link', label: 'Link', required: false },
    ]);
  });

  it('gives the facebook story variant no canonical-editor fields so analysis cannot block on text', () => {
    const resolved = resolvePlatformCapabilityV2(
      ctx(
        'facebook',
        [{ type: 'image' }],
        { settings: { post_type: 'story' } }
      )
    );
    expect(resolved.variant).toBe('story');
    expect(resolved.fields).toEqual([]);
    expect(resolved.media).toEqual({
      type: 'required',
      images: { min: 1 },
      videos: { min: 1 },
      mixed: true,
    });
    const analysis = analyzePlatformContentV2({
      canonicalHtml: `<p>${'x'.repeat(70_000)}</p>`,
      settings: { post_type: 'story' },
      media: [{ type: 'image' }],
      capability: resolved,
    });
    expect(analysis.blocking).toBe(false);
  });

  it('requires exactly one video for the facebook video variant with the body as description', () => {
    const resolved = resolvePlatformCapabilityV2(
      ctx('facebook', [{ type: 'video' }])
    );
    expect(resolved.variant).toBe('video');
    expect(resolved.fields.map((field) => field.key)).toEqual(['body']);
    expect(resolved.fields[0].limit).toMatchObject({ max: 63_206 });
    expect(resolved.media).toEqual({
      type: 'required',
      videos: { min: 1, max: 1 },
    });
  });


  it.each([
    ['linkedin-page', [], { profileIdentifier: 'linkedin', variant: 'feed' }],
    ['slack', [], { variant: 'message' }],
    ['tiktok', [{ type: 'video' }], { variant: 'video' }],
    ['tiktok', [{ type: 'image' }], { variant: 'photo' }],
    ['mastodon', [], { verification: 'runtime', variant: 'status' }],
    ['youtube', [], { verification: 'verified', variant: 'upload' }],
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

  it('falls back to weighted 280 without an x runtime overlay', () => {
    const capability = resolvePlatformCapabilityV2(ctx('x'));
    expect(capability.verification).toBe('runtime');
    expect(capability.fields[0].limit).toMatchObject({
      max: 280,
      unit: 'weighted',
      counter: 'x-weighted',
    });
    expect(
      capability.diagnostics.some((d) => d.code === 'runtime-data-missing')
    ).toBe(true);
  });

  it('raises x to premium 4000 only through a trusted overlay', () => {
    const capability = resolvePlatformCapabilityV2({
      ...ctx('x'),
      runtimeOverlay: {
        observedAt: new Date().toISOString(),
        textLimits: {
          body: { max: 4000, unit: 'weighted', counter: 'x-weighted', source: 'runtime' },
        },
      },
    });
    expect(capability.fields[0].limit).toMatchObject({ max: 4000, source: 'runtime' });
    expect(capability.diagnostics).toHaveLength(0);
  });

  it('clamps a forged x runtime overlay above the 4,000 ceiling', () => {
    const capability = resolvePlatformCapabilityV2({
      ...ctx('x'),
      runtimeOverlay: {
        observedAt: new Date().toISOString(),
        textLimits: {
          body: {
            max: 10_000,
            unit: 'weighted',
            counter: 'x-weighted',
            source: 'runtime',
          },
        },
      },
    });
    expect(capability.fields[0].limit).toEqual({
      max: 4_000,
      unit: 'weighted',
      counter: 'x-weighted',
      source: 'runtime',
    });
    expect(capability.runtimeOverlay?.textLimits?.body).toMatchObject({
      max: 4_000,
    });
    expect(capability.diagnostics).toEqual([
      {
        code: 'runtime-limit-clamped',
        severity: 'information',
        destination: 'x',
        variant: 'post',
        field: 'body',
        measured: 10_000,
        limit: 4_000,
        unit: 'weighted',
        message:
          'Runtime body limit 10000 exceeds the application-safety ceiling; clamped to 4000 weighted.',
      },
    ]);
  });

  it('keeps a legitimate premium x overlay exactly at its ceiling', () => {
    const capability = resolvePlatformCapabilityV2({
      ...ctx('x'),
      runtimeOverlay: {
        observedAt: new Date().toISOString(),
        textLimits: {
          body: {
            max: 3_999,
            unit: 'weighted',
            counter: 'x-weighted',
            source: 'runtime',
          },
        },
      },
    });
    expect(capability.fields[0].limit).toMatchObject({ max: 3_999 });
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

  it('models youtube as video-first with byte-counted description', () => {
    const capability = resolvePlatformCapabilityV2(ctx('youtube'));
    expect(capability.variant).toBe('upload');
    expect(capability.fields.map((f) => f.key)).toEqual([
      'title',
      'description',
    ]);
    expect(capability.fields[0]).toMatchObject({
      source: 'provider-setting',
      required: true,
    });
    expect(capability.fields[1].limit).toEqual({
      max: 5000,
      unit: 'utf8-bytes',
      source: 'platform',
    });
    expect(capability.media).toEqual({ type: 'required', videos: { min: 1, max: 1 } });
  });

  it('selects reddit variants from url and media signals', () => {
    expect(
      resolvePlatformCapabilityV2(
        ctx('reddit', [], { settings: { url: 'https://example.test' } })
      ).variant
    ).toBe('link');
    expect(
      resolvePlatformCapabilityV2(ctx('reddit', [{ type: 'image' }])).variant
    ).toBe('image');
    expect(
      resolvePlatformCapabilityV2(ctx('reddit', [{ type: 'video' }])).variant
    ).toBe('video');
    expect(resolvePlatformCapabilityV2(ctx('reddit')).variant).toBe('self');
  });

  it('models reddit self posts as markdown bodies with a 300-unit title', () => {
    const resolved = resolvePlatformCapabilityV2(ctx('reddit'));
    expect(resolved).toMatchObject({
      verification: 'runtime',
      profileIdentifier: 'reddit',
      variant: 'self',
    });
    expect(resolved.fields.map((field) => field.key)).toEqual([
      'title',
      'body',
    ]);
    expect(resolved.fields[0]).toMatchObject({
      source: 'provider-setting',
      required: true,
      limit: { max: 300, unit: 'utf16-code-units', source: 'platform' },
    });
    expect(resolved.fields[1].dialect).toBe('markdown');
    expect(resolved.media).toEqual({ type: 'none' });
  });

  it('requires a url for reddit link posts', () => {
    expect(
      resolvePlatformCapabilityV2(
        ctx('reddit', [], { settings: { url: 'https://example.test' } })
      ).structuredFields
    ).toEqual([{ key: 'url', label: 'URL', required: true }]);
  });

  it('keeps the 10,000 reddit application-safety body when runtime data is missing', () => {
    const resolved = resolvePlatformCapabilityV2(ctx('reddit'));
    expect(
      resolved.fields.find((field) => field.key === 'body')?.limit
    ).toEqual({
      max: 10_000,
      unit: 'graphemes',
      source: 'application-safety',
    });
    expect(resolved.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'runtime-data-missing' })
    );
  });

  it('lowers the reddit title limit only through a trusted overlay', () => {
    const resolved = resolvePlatformCapabilityV2(
      ctx('reddit', [], {
        runtimeOverlay: {
          observedAt: new Date().toISOString(),
          textLimits: {
            title: { max: 40, unit: 'utf16-code-units', source: 'runtime' },
          },
        },
      })
    );
    expect(
      resolved.fields.find((field) => field.key === 'title')?.limit
    ).toMatchObject({ max: 40, source: 'runtime' });
    expect(
      resolved.fields.find((field) => field.key === 'body')?.limit
    ).toMatchObject({ max: 10_000, source: 'application-safety' });
    expect(resolved.diagnostics).toEqual([]);
  });

  it('clamps a reddit title overlay above the 300 ceiling', () => {
    const resolved = resolvePlatformCapabilityV2(
      ctx('reddit', [], {
        runtimeOverlay: {
          observedAt: new Date().toISOString(),
          textLimits: {
            title: { max: 500, unit: 'utf16-code-units', source: 'runtime' },
          },
        },
      })
    );
    expect(
      resolved.fields.find((field) => field.key === 'title')?.limit
    ).toMatchObject({ max: 300, unit: 'utf16-code-units', source: 'runtime' });
    expect(resolved.runtimeOverlay?.textLimits?.title).toMatchObject({
      max: 300,
    });
    expect(resolved.diagnostics).toEqual([
      expect.objectContaining({
        code: 'runtime-limit-clamped',
        severity: 'information',
        destination: 'reddit',
        variant: 'self',
        field: 'title',
        measured: 500,
        limit: 300,
        unit: 'utf16-code-units',
      }),
    ]);
  });

  it('leaves mastodon runtime overlays unclamped without a declared ceiling', () => {
    const resolved = resolvePlatformCapabilityV2(
      ctx('mastodon', [], {
        now: '2026-08-20T10:30:00.000Z',
        runtimeOverlay: {
          observedAt: '2026-08-20T10:00:00.000Z',
          textLimits: {
            body: { max: 5_000, unit: 'graphemes', source: 'runtime' },
          },
        },
      })
    );
    expect(resolved.fields[0].limit).toMatchObject({ max: 5_000 });
  });

  it.each([
    ['link', { url: 'https://example.test' }, [], { type: 'none' }],
    ['image', {}, [{ type: 'image' as const }], {
      type: 'required',
      images: { min: 1, max: 1 },
    }],
    [
      'video',
      {},
      [{ type: 'video' as const }],
      { type: 'required', videos: { min: 1, max: 1, coverRequired: true } },
    ],
  ] as const)('models reddit %s media as %j', (variant, settings, media, expected) => {
    expect(
      resolvePlatformCapabilityV2(ctx('reddit', media, { settings })).media
    ).toEqual(expected);
  });

  it('resolves discord as a verified message profile with a 1980-unit application-safety body', () => {
    const capability = resolvePlatformCapabilityV2(ctx('discord'));
    expect(capability).toMatchObject({
      verification: 'verified',
      profileIdentifier: 'discord',
      variant: 'message',
    });
    expect(capability.fields[0].limit).toEqual({
      max: 1_980,
      unit: 'utf16-code-units',
      source: 'application-safety',
    });
    expect(capability.fields[0].dialect).toBe('discord-markdown');
    expect(capability.structuredFields).toEqual([
      { key: 'channel', label: 'Channel', required: true },
    ]);
  });

  it.each([
    [
      'twitch',
      [{ key: 'messageType', label: 'Message type', required: false }],
    ],
    ['kick', []],
  ] as const)('resolves %s as a verified chat profile', (identifier, structuredFields) => {
    const capability = resolvePlatformCapabilityV2(ctx(identifier));
    expect(capability).toMatchObject({
      verification: 'verified',
      profileIdentifier: identifier,
      variant: 'chat',
    });
    expect(capability.fields[0].limit).toEqual({
      max: 500,
      unit: 'utf16-code-units',
      source: 'platform',
    });
    expect(capability.fields[0].dialect).toBe('plain');
    expect(capability.media).toEqual({ type: 'none' });
    expect(capability.structuredFields).toEqual(structuredFields);
  });

  it('resolves lemmy as a verified markdown post profile with an unlimited title', () => {
    const capability = resolvePlatformCapabilityV2(ctx('lemmy'));
    expect(capability).toMatchObject({
      verification: 'verified',
      profileIdentifier: 'lemmy',
      variant: 'post',
    });
    expect(capability.fields.map((field) => field.key)).toEqual([
      'title',
      'body',
    ]);
    expect(capability.fields[0]).toMatchObject({
      source: 'provider-setting',
      required: true,
      dialect: 'plain',
    });
    expect(capability.fields[0]).not.toHaveProperty('limit');
    expect(capability.fields[1].dialect).toBe('markdown');
    expect(capability.fields[1].limit).toEqual({
      max: 10_000,
      unit: 'utf16-code-units',
      source: 'application-safety',
    });
    expect(capability.media).toEqual({
      type: 'optional',
      images: { min: 1, max: 1 },
    });
    expect(capability.structuredFields).toEqual([
      { key: 'url', label: 'URL', required: false },
    ]);
  });

  it('resolves wrapcast as a verified 320-utf8-byte cast profile', () => {
    const capability = resolvePlatformCapabilityV2(ctx('wrapcast'));
    expect(capability).toMatchObject({
      verification: 'verified',
      profileIdentifier: 'wrapcast',
      variant: 'cast',
    });
    expect(capability.fields[0].limit).toEqual({
      max: 320,
      unit: 'utf8-bytes',
      source: 'platform',
    });
    expect(capability.fields[0].dialect).toBe('plain');
    expect(capability.media).toEqual({
      type: 'optional',
      images: { min: 1, max: 2 },
    });
    expect(capability.structuredFields).toEqual([
      { key: 'channelId', label: 'Channel ID', required: false },
    ]);
  });

  it('resolves nostr as a verified application-safety note profile', () => {
    const capability = resolvePlatformCapabilityV2(ctx('nostr'));
    expect(capability).toMatchObject({
      verification: 'verified',
      profileIdentifier: 'nostr',
      variant: 'note',
    });
    expect(capability.fields[0].limit).toEqual({
      max: 100_000,
      unit: 'utf16-code-units',
      source: 'application-safety',
    });
    expect(capability.fields[0].dialect).toBe('plain');
    expect(capability.media).toEqual({
      type: 'optional',
      images: { min: 1 },
      videos: { min: 1 },
      mixed: true,
    });
  });

  it('resolves medium as a verified markdown article profile with a required title setting', () => {
    const capability = resolvePlatformCapabilityV2(ctx('medium'));
    expect(capability).toMatchObject({
      verification: 'verified',
      profileIdentifier: 'medium',
      variant: 'article',
    });
    expect(capability.fields.map((field) => field.key)).toEqual(['body']);
    expect(capability.fields[0].dialect).toBe('markdown');
    expect(capability.fields[0].limit).toEqual({
      max: 100_000,
      unit: 'utf16-code-units',
      source: 'application-safety',
    });
    expect(
      capability.fields.some((field) => field.key === 'title')
    ).toBe(false);
    expect(capability.media).toEqual({ type: 'none' });
    expect(capability.structuredFields[0]).toEqual({
      key: 'title',
      label: 'Title',
      required: true,
    });
  });

  it('resolves devto like medium but with one optional image and its own settings', () => {
    const capability = resolvePlatformCapabilityV2(ctx('devto'));
    expect(capability).toMatchObject({
      verification: 'verified',
      profileIdentifier: 'devto',
      variant: 'article',
    });
    expect(capability.fields[0].dialect).toBe('markdown');
    expect(capability.fields[0].limit).toEqual({
      max: 100_000,
      unit: 'utf16-code-units',
      source: 'application-safety',
    });
    expect(capability.fields.some((field) => field.key === 'title')).toBe(
      false
    );
    expect(capability.media).toEqual({
      type: 'optional',
      images: { min: 1, max: 1 },
    });
    expect(capability.structuredFields).toEqual([
      { key: 'title', label: 'Title', required: true },
      { key: 'tags', label: 'Tags', required: false },
      { key: 'organization', label: 'Organization', required: false },
      { key: 'canonical', label: 'Canonical', required: false },
    ]);
  });

  it('resolves hashnode as a verified markdown article profile requiring a publication', () => {
    const capability = resolvePlatformCapabilityV2(ctx('hashnode'));
    expect(capability).toMatchObject({
      verification: 'verified',
      profileIdentifier: 'hashnode',
      variant: 'article',
    });
    expect(capability.fields[0].dialect).toBe('markdown');
    expect(capability.fields[0].limit).toEqual({
      max: 10_000,
      unit: 'utf16-code-units',
      source: 'application-safety',
    });
    expect(capability.media).toEqual({
      type: 'optional',
      images: { min: 1, max: 1 },
    });
    expect(capability.structuredFields).toEqual([
      { key: 'title', label: 'Title', required: true },
      { key: 'publication', label: 'Publication', required: true },
      { key: 'tags', label: 'Tags', required: false },
      { key: 'subtitle', label: 'Subtitle', required: false },
      { key: 'canonical', label: 'Canonical', required: false },
    ]);
  });

  it('resolves wordpress as a verified HTML post profile and keeps markup through normalization', () => {
    const capability = resolvePlatformCapabilityV2(ctx('wordpress'));
    expect(capability).toMatchObject({
      verification: 'verified',
      profileIdentifier: 'wordpress',
      variant: 'post',
    });
    expect(capability.fields[0].dialect).toBe('html');
    expect(capability.fields[0].limit).toEqual({
      max: 100_000,
      unit: 'utf16-code-units',
      source: 'application-safety',
    });
    expect(capability.media).toEqual({
      type: 'optional',
      images: { min: 1, max: 1 },
    });
    expect(capability.structuredFields).toEqual([
      { key: 'title', label: 'Title', required: true },
      { key: 'type', label: 'Type', required: true },
      { key: 'status', label: 'Status', required: false },
      { key: 'categories', label: 'Categories', required: false },
      { key: 'tags', label: 'Tags', required: false },
    ]);
    expect(
      normalizePlatformFields({
        canonicalHtml: '<p>Hello <strong>world</strong></p>',
        settings: {},
        capability,
      }).body.value
    ).toBe('<p>Hello <strong>world</strong></p>');
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
