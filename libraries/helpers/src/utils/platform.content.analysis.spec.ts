import { describe, expect, it } from 'vitest';
import { resolvePlatformCapabilityV2 } from './platform.capability.resolver';
import type { ResolvedPlatformCapabilityV2 } from './platform.capability.types';
import { analyzePlatformContentV2 } from './platform.content.analysis';

const capability = (
  identifier: string,
  media: ReadonlyArray<{ type?: 'image' | 'video' }> = [],
  settings: Readonly<Record<string, unknown>> = {},
  overrides: {
    runtimeOverlay?: Parameters<
      typeof resolvePlatformCapabilityV2
    >[0]['runtimeOverlay'];
    now?: string;
  } = {}
) =>
  resolvePlatformCapabilityV2({
    identifier,
    settings,
    media,
    adapter: {
      editor: 'normal',
      maximum: 5_000,
      stripRawUrls: false,
    },
    ...overrides,
  });

const analyze = ({
  canonicalHtml,
  settings = {},
  media = [],
  resolved,
}: {
  canonicalHtml: string;
  settings?: Readonly<Record<string, unknown>>;
  media?: ReadonlyArray<{ type?: 'image' | 'video' }>;
  resolved: ResolvedPlatformCapabilityV2;
}) =>
  analyzePlatformContentV2({
    canonicalHtml,
    settings,
    media,
    capability: resolved,
  });

describe('analyzePlatformContentV2', () => {
  it('emits a complete hard-limit diagnostic', () => {
    const result = analyze({
      canonicalHtml: `<p>${'a'.repeat(32_769)}</p>`,
      resolved: capability('telegram'),
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'text-too-long',
        severity: 'error',
        destination: 'telegram',
        variant: 'text',
        field: 'body',
        measured: 32_769,
        limit: 32_768,
        unit: 'utf16-code-units',
        message: 'Body exceeds the 32768-UTF-16-code-unit limit.',
      },
    ]);
    expect(result.blocking).toBe(true);
  });

  it('emits a non-blocking recommended-limit diagnostic', () => {
    const result = analyze({
      canonicalHtml: `<p>${'a'.repeat(4_001)}</p>`,
      resolved: capability('slack'),
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'recommended-limit-exceeded',
        severity: 'warning',
        destination: 'slack',
        variant: 'message',
        field: 'body',
        measured: 4_001,
        limit: 4_000,
        unit: 'utf16-code-units',
        message: 'Body exceeds the recommended 4000-UTF-16-code-unit limit.',
      },
    ]);
    expect(result.blocking).toBe(false);
  });

  it('reports a required structured provider setting with its field identity', () => {
    const media = [{ type: 'image' as const }];
    const result = analyze({
      canonicalHtml: '<p>Pin</p>',
      media,
      resolved: capability('pinterest', media),
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'required-field-missing',
        severity: 'error',
        destination: 'pinterest',
        variant: 'pin',
        field: 'board',
        message: 'Board is required.',
      },
    ]);
    expect(result.blocking).toBe(true);
  });

  it('merges runtime fallback diagnostics without changing their payload', () => {
    const result = analyze({
      canonicalHtml: '<p>Status</p>',
      resolved: capability('mastodon'),
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'runtime-data-missing',
        severity: 'warning',
        destination: 'mastodon',
        variant: 'status',
        message:
          'Current platform capability data is unavailable; a safe fallback is in use.',
      },
    ]);
    expect(result.blocking).toBe(false);
  });

  it('emits a complete unsupported-media diagnostic', () => {
    const media = [{ type: 'video' as const }];
    const result = analyze({
      canonicalHtml: '<p>Post</p>',
      media,
      resolved: capability('vk-group', media),
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'unsupported-media',
        severity: 'error',
        destination: 'vk-group',
        variant: 'post',
        message: 'Attached media does not match the post variant requirements.',
      },
    ]);
    expect(result.blocking).toBe(true);
  });

  it('blocks media that exceeds a runtime total even when per-type maxima pass', () => {
    const media = [
      ...Array.from({ length: 6 }, () => ({ type: 'image' as const })),
      ...Array.from({ length: 6 }, () => ({ type: 'video' as const })),
    ];
    const result = analyze({
      canonicalHtml: '<p>Status</p>',
      media,
      resolved: capability(
        'mastodon',
        media,
        {},
        {
          now: '2026-08-20T10:01:00.000Z',
          runtimeOverlay: {
            observedAt: '2026-08-20T10:00:00.000Z',
            mediaRule: {
              type: 'optional',
              images: { min: 1, max: 6 },
              videos: { min: 1, max: 6 },
              mixed: true,
              maxTotal: 6,
            },
          },
        }
      ),
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'too-many-media',
        severity: 'error',
        destination: 'mastodon',
        variant: 'status',
        measured: 12,
        limit: 6,
        message: 'Attached media exceeds the 6-item total limit.',
      },
    ]);
    expect(result.blocking).toBe(true);
  });

  it.each([
    ['no media', []],
    [
      'six images',
      Array.from({ length: 6 }, () => ({ type: 'image' as const })),
    ],
    ['a video without its cover image', [{ type: 'video' as const }]],
  ])('rejects Pinterest %s', (_case, media) => {
    const result = analyze({
      canonicalHtml: '<p>Pin</p>',
      settings: { board: 'board-1' },
      media,
      resolved: capability('pinterest', media, { board: 'board-1' }),
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'unsupported-media',
        destination: 'pinterest',
        variant: 'pin',
      })
    );
  });

  it('accepts Pinterest image carousels and one video with one cover image', () => {
    for (const media of [
      Array.from({ length: 5 }, () => ({ type: 'image' as const })),
      [{ type: 'video' as const }, { type: 'image' as const }],
    ]) {
      const result = analyze({
        canonicalHtml: '<p>Pin</p>',
        settings: { board: 'board-1' },
        media,
        resolved: capability('pinterest', media, { board: 'board-1' }),
      });

      expect(result.diagnostics).toEqual([]);
      expect(result.blocking).toBe(false);
    }
  });

  it('preserves a resolver invalid-variant diagnostic while validating media', () => {
    const result = analyze({
      canonicalHtml: '<p>Post</p>',
      resolved: capability('tiktok'),
    });

    expect(result.diagnostics).toContainEqual({
      code: 'invalid-media-variant',
      severity: 'error',
      destination: 'tiktok',
      variant: 'video',
      message: 'TikTok requires exactly one video or one to 35 images.',
    });
    expect(result.diagnostics).toContainEqual({
      code: 'unsupported-media',
      severity: 'error',
      destination: 'tiktok',
      variant: 'video',
      message: 'Attached media does not match the video variant requirements.',
    });
    expect(result.blocking).toBe(true);
  });

  it('accepts a YouTube description within its UTF-8 byte limit', () => {
    const media = [{ type: 'video' as const }];
    const result = analyze({
      canonicalHtml: `<p>${'あ'.repeat(100)}</p>`,
      settings: { title: 'Title' },
      media,
      resolved: capability('youtube', media, { title: 'Title' }),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.blocking).toBe(false);
  });

  it('blocks a YouTube description beyond its UTF-8 byte limit', () => {
    const media = [{ type: 'video' as const }];
    const result = analyze({
      canonicalHtml: `<p>${'あ'.repeat(1_700)}</p>`,
      settings: { title: 'Title' },
      media,
      resolved: capability('youtube', media, { title: 'Title' }),
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'text-too-long',
        severity: 'error',
        destination: 'youtube',
        variant: 'upload',
        field: 'description',
        measured: 5_100,
        limit: 5_000,
        unit: 'utf8-bytes',
      })
    );
    expect(result.blocking).toBe(true);
  });

  it('requires a YouTube title provider setting', () => {
    const media = [{ type: 'video' as const }];
    const result = analyze({
      canonicalHtml: '<p>Body</p>',
      media,
      resolved: capability('youtube', media),
    });

    expect(result.diagnostics).toContainEqual({
      code: 'required-field-missing',
      severity: 'error',
      destination: 'youtube',
      variant: 'upload',
      field: 'title',
      message: 'Title is required.',
    });
    expect(result.blocking).toBe(true);
  });

  it('measures wrapcast casts in platform utf8 bytes', () => {
    const passing = analyze({
      canonicalHtml: `<p>${'あ'.repeat(100)}</p>`,
      resolved: capability('wrapcast'),
    });
    expect(passing.blocking).toBe(false);

    const blocked = analyze({
      canonicalHtml: `<p>${'あ'.repeat(107)}</p>`,
      resolved: capability('wrapcast'),
    });
    expect(blocked.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'text-too-long',
        severity: 'error',
        destination: 'wrapcast',
        variant: 'cast',
        field: 'body',
        measured: 321,
        limit: 320,
        unit: 'utf8-bytes',
      })
    );
    expect(blocked.blocking).toBe(true);
  });

  it('accepts mixed-content wrapcast casts at exactly 320 utf8 bytes', () => {
    const emojiRun = '😀'.repeat(78);
    const padding = 'a'.repeat(320 - Buffer.byteLength(emojiRun, 'utf8'));
    const content = emojiRun + padding;
    expect(Buffer.byteLength(content, 'utf8')).toBe(320);

    const result = analyze({
      canonicalHtml: `<p>${content}</p>`,
      resolved: capability('wrapcast'),
    });
    expect(result.blocking).toBe(false);
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'text-too-long' })
    );
  });

  it('blocks wrapcast casts beyond two images', () => {
    const media = [
      { type: 'image' as const },
      { type: 'image' as const },
      { type: 'image' as const },
    ];
    const result = analyze({
      canonicalHtml: '<p>hi</p>',
      media,
      resolved: capability('wrapcast', media),
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'unsupported-media',
        destination: 'wrapcast',
        variant: 'cast',
      })
    );
    expect(result.blocking).toBe(true);
  });

  it('accepts nostr mixed optional media', () => {
    for (const media of [
      [],
      [{ type: 'image' as const }],
      [{ type: 'video' as const }],
      [{ type: 'image' as const }, { type: 'video' as const }],
    ]) {
      const result = analyze({
        canonicalHtml: '<p>note</p>',
        media,
        resolved: capability('nostr', media),
      });
      expect(result.diagnostics).not.toContainEqual(
        expect.objectContaining({ code: 'unsupported-media' })
      );
      expect(result.blocking).toBe(false);
    }
  });

  it('warns when normalization loses declared formatting', () => {
    const result = analyze({
      canonicalHtml:
        '<p>Read <a href="https://example.com/path">the article</a>.</p>',
      resolved: capability('linkedin'),
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'formatting-loss',
        severity: 'warning',
        destination: 'linkedin',
        variant: 'feed',
        field: 'body',
        message: 'Some formatting in Body will be converted or removed.',
      },
    ]);
    expect(result.blocking).toBe(false);
  });

  it('reports Telegram media splitting without blocking on caption overflow', () => {
    const media = [{ type: 'image' as const }];
    const result = analyze({
      canonicalHtml: `<p>${'a'.repeat(1_025)}</p>`,
      media,
      resolved: capability('telegram', media),
    });

    expect(result.fields).toEqual({
      body: { value: `<p>${'a'.repeat(1_025)}</p>`, facets: undefined },
      caption: { value: 'a'.repeat(1_025), facets: undefined },
    });
    expect(result.diagnostics).toEqual([
      {
        code: 'media-text-split',
        severity: 'information',
        destination: 'telegram',
        variant: 'media',
        field: 'caption',
        measured: 1_025,
        limit: 1_024,
        unit: 'utf16-code-units',
        message:
          'Media will be published first, followed by the full text as a separate message.',
      },
    ]);
    expect(result.blocking).toBe(false);
  });

  it('allows Telegram media across multiple ten-item delivery groups', () => {
    const media = Array.from({ length: 11 }, () => ({
      type: 'image' as const,
    }));
    const resolved = capability('telegram', media);
    const result = analyze({
      canonicalHtml: '<p>album</p>',
      media,
      resolved,
    });

    expect(result.blocking).toBe(false);
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'unsupported-media' })
    );
    expect(resolved.delivery.mediaGroupMaxItems).toBe(10);
  });

  it('uses Telegram transport UTF-16 boundaries for astral emoji', () => {
    const media = [{ type: 'image' as const }];
    const atCaptionLimit = analyze({
      canonicalHtml: `<p>${'😀'.repeat(512)}</p>`,
      media,
      resolved: capability('telegram', media),
    });
    const overCaptionLimit = analyze({
      canonicalHtml: `<p>${'😀'.repeat(513)}</p>`,
      media,
      resolved: capability('telegram', media),
    });
    const overBodyLimit = analyze({
      canonicalHtml: `<p>${'😀'.repeat(16_385)}</p>`,
      media,
      resolved: capability('telegram', media),
    });

    expect(atCaptionLimit.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'media-text-split' })
    );
    expect(overCaptionLimit.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'media-text-split',
        measured: 1_026,
        limit: 1_024,
        unit: 'utf16-code-units',
      })
    );
    expect(overBodyLimit.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'text-too-long',
        field: 'body',
        measured: 32_770,
        limit: 32_768,
        unit: 'utf16-code-units',
      })
    );
  });

  it('still blocks Telegram body overflow in split-after-media delivery', () => {
    const media = [{ type: 'image' as const }];
    const result = analyze({
      canonicalHtml: `<p>${'a'.repeat(32_769)}</p>`,
      media,
      resolved: capability('telegram', media),
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'text-too-long',
        field: 'body',
        measured: 32_769,
        limit: 32_768,
      })
    );
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'text-too-long', field: 'caption' })
    );
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'media-text-split', field: 'caption' })
    );
    expect(result.blocking).toBe(true);
  });

  it('measures verified HTML as visible content rather than markup', () => {
    const result = analyze({
      canonicalHtml: `<p><strong>${'a'.repeat(4_096)}</strong></p>`,
      resolved: capability('telegram'),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.blocking).toBe(false);
  });

  it('counts generic HTML structural boundaries as visible content', () => {
    const resolved = resolvePlatformCapabilityV2({
      identifier: 'legacy-html',
      settings: {},
      media: [],
      adapter: {
        editor: 'html',
        maximum: 2,
        stripRawUrls: false,
      },
    });
    const result = analyze({
      canonicalHtml: '<p>a</p><p>b</p>',
      resolved,
    });

    expect(result.diagnostics).toContainEqual({
      code: 'text-too-long',
      severity: 'error',
      destination: 'legacy-html',
      variant: 'adapter',
      field: 'body',
      measured: 3,
      limit: 2,
      unit: 'utf16-code-units',
      message: 'Body exceeds the 2-UTF-16-code-unit limit.',
    });
  });

  it('treats markup-only required HTML as missing', () => {
    const telegram = capability('telegram');
    const requiredBody: ResolvedPlatformCapabilityV2 = {
      ...telegram,
      fields: telegram.fields.map((field) => ({ ...field, required: true })),
    };
    const result = analyze({
      canonicalHtml: '<p><strong></strong></p>',
      resolved: requiredBody,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'required-field-missing',
        severity: 'error',
        destination: 'telegram',
        variant: 'text',
        field: 'body',
        message: 'Body is required.',
      },
    ]);
  });

  it('flags a dribbble shot without media as a required-media violation', () => {
    const result = analyze({
      canonicalHtml: '<p>Shot</p>',
      resolved: capability('dribbble'),
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'required-field-missing',
        severity: 'error',
        destination: 'dribbble',
        variant: 'shot',
        field: 'title',
        message: 'Title is required.',
      },
      {
        code: 'unsupported-media',
        severity: 'error',
        destination: 'dribbble',
        variant: 'shot',
        message: 'Attached media does not match the shot variant requirements.',
      },
    ]);
    expect(result.blocking).toBe(true);
  });

  it('accepts a dribbble shot with exactly one image and a title', () => {
    const media = [{ type: 'image' as const }];
    const result = analyze({
      canonicalHtml: '<p>Shot</p>',
      settings: { title: 'My shot' },
      media,
      resolved: capability('dribbble', media),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.blocking).toBe(false);
  });

  it('rejects a dribbble shot with a second media block', () => {
    const media = [{ type: 'image' as const }, { type: 'image' as const }];
    const result = analyze({
      canonicalHtml: '<p>Shot</p>',
      settings: { title: 'My shot' },
      media,
      resolved: capability('dribbble', media),
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'unsupported-media',
        severity: 'error',
        destination: 'dribbble',
        variant: 'shot',
        message: 'Attached media does not match the shot variant requirements.',
      },
    ]);
    expect(result.blocking).toBe(true);
  });
});
