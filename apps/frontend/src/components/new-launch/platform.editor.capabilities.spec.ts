import { describe, expect, it } from 'vitest';
import { resolvePlatformCapabilityV2 } from '@gitroom/helpers/utils/platform.capability.resolver';
import {
  deriveActiveEditorFormatting,
  type EditorDestinationCapabilityV2,
  getFormattingControls,
  resolveEditorCapabilityV2,
} from './platform.editor.capabilities';
import { getEditorCreationPolicyKey } from './platform.editor.extensions';
import type { TextFieldCapability } from '@gitroom/helpers/utils/platform.capability.types';

const selected = (
  id: string,
  identifier: string,
  capabilitiesV2 = resolvePlatformCapabilityV2({
    identifier,
    settings: {},
    media: [],
  }),
  settings: Record<string, unknown> = {}
) =>
  ({
    integration: {
      id,
      identifier,
      name: identifier,
      editor: 'normal',
      additionalSettings: '[]',
      capabilitiesV2,
    },
    settings,
  } as any);

describe('platform editor capabilities v2', () => {
  it('intersects only the active canonical field from each global destination', () => {
    const field = (
      key: string,
      support: TextFieldCapability['formatting']['bold']
    ): TextFieldCapability => ({
      key,
      label: key,
      required: false,
      source: 'canonical-editor',
      dialect: 'html',
      formatting: {
        bold: support,
        underline: support,
        links: support,
        lists: support,
        headings: support,
      },
    });
    const active = field('body', 'native');
    const inactive = field('caption', 'unsupported');
    const destination: Pick<
      EditorDestinationCapabilityV2,
      'canonicalFields' | 'activeField'
    > = {
      canonicalFields: [active, inactive],
      activeField: active,
    };

    const formatting = deriveActiveEditorFormatting([destination]);
    const inactiveChanged = deriveActiveEditorFormatting([
      {
        ...destination,
        canonicalFields: [active, field('caption', 'plain')],
      },
    ]);
    const stricterActive = deriveActiveEditorFormatting([
      { ...destination, activeField: inactive },
    ]);

    expect(getFormattingControls({ formatting })).toEqual([
      'bold',
      'underline',
      'link',
      'list',
      'heading',
    ]);
    expect(inactiveChanged).toEqual(formatting);
    expect(getEditorCreationPolicyKey({ formatting: inactiveChanged })).toBe(
      getEditorCreationPolicyKey({ formatting })
    );
    expect(getFormattingControls({ formatting: stricterActive })).toEqual([]);
    expect(getEditorCreationPolicyKey({ formatting: stricterActive })).not.toBe(
      getEditorCreationPolicyKey({ formatting })
    );
  });

  it('uses Telegram native bold and underline controls', () => {
    const result = resolveEditorCapabilityV2(
      'telegram-account',
      [selected('telegram-account', 'telegram')],
      [],
      '<p><strong>Hello</strong></p>',
      []
    );

    expect(result.destinations[0].capability.identifier).toBe('telegram');
    expect(result.destinations[0].activeField?.formatting).toMatchObject({
      bold: 'native',
      underline: 'native',
    });
    expect(getFormattingControls(result)).toEqual(['bold', 'underline']);
  });

  it('keeps Telegram media caption overflow nonblocking and points the counter at the caption', () => {
    const result = resolveEditorCapabilityV2(
      'telegram-account',
      [selected('telegram-account', 'telegram')],
      [],
      'x'.repeat(1_025),
      [{ path: 'photo.jpg' }]
    );

    expect(result.destinations[0].capability.variant).toBe('media');
    expect(result.destinations[0].activeField?.key).toBe('caption');
    expect(result.counters[0]).toMatchObject({
      measured: 1_025,
      limit: { max: 1_024, unit: 'graphemes' },
    });
    expect(result.blocking).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'media-text-split',
          severity: 'information',
          targetIntegrationId: 'telegram-account',
        }),
      ])
    );
  });

  it('uses LinkedIn Unicode fallbacks without exposing a link button', () => {
    const result = resolveEditorCapabilityV2(
      'linkedin-account',
      [selected('linkedin-account', 'linkedin')],
      [],
      '<p>Hello</p>',
      []
    );

    expect(result.formatting).toMatchObject({
      bold: 'unicode',
      underline: 'unicode',
      links: 'plain',
    });
    expect(getFormattingControls(result)).toEqual(['bold', 'underline']);
  });

  it('uses Slack dialect controls and emits its recommendation separately from the API limit', () => {
    const result = resolveEditorCapabilityV2(
      'slack-account',
      [selected('slack-account', 'slack')],
      [],
      'x'.repeat(4_001),
      []
    );

    expect(result.destinations[0].activeField).toMatchObject({
      dialect: 'slack-mrkdwn',
      limit: {
        max: 40_000,
        recommendedMax: 4_000,
        unit: 'utf16-code-units',
      },
    });
    expect(getFormattingControls(result)).toEqual(['bold', 'link']);
    expect(result.blocking).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'recommended-limit-exceeded',
          severity: 'warning',
          targetIntegrationId: 'slack-account',
          measured: 4_001,
          limit: 4_000,
          unit: 'utf16-code-units',
        }),
      ])
    );
  });

  it('reselects TikTok fields from current media instead of reusing the serialized empty-media variant', () => {
    const integration = selected('tiktok-account', 'tiktok');

    const video = resolveEditorCapabilityV2(
      'tiktok-account',
      [integration],
      [],
      '<p>Caption</p>',
      [{ path: 'clip.mp4' }]
    );
    const photo = resolveEditorCapabilityV2(
      'tiktok-account',
      [integration],
      [],
      '<p>Description</p>',
      [{ path: 'photo.jpg' }]
    );

    expect(video.destinations[0].capability.variant).toBe('video');
    expect(
      video.destinations[0].capability.fields.map(({ key }) => key)
    ).toEqual(['caption']);
    expect(photo.destinations[0].capability.variant).toBe('photo');
    expect(
      photo.destinations[0].capability.fields.map(({ key }) => key)
    ).toEqual(['title', 'description']);
    expect(photo.destinations[0].activeField?.key).toBe('description');
  });

  it('shows Mastodon runtime data as unverified when the connected integration has no overlay', () => {
    const result = resolveEditorCapabilityV2(
      'mastodon-account',
      [selected('mastodon-account', 'mastodon')],
      [],
      '<p>Hello</p>',
      []
    );

    expect(result.destinations[0].capability.verification).toBe('runtime');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'runtime-data-missing',
          severity: 'warning',
          targetIntegrationId: 'mastodon-account',
        }),
      ])
    );
  });

  it('renders LinkedIn Page like LinkedIn while retaining its destination identifier', () => {
    const result = resolveEditorCapabilityV2(
      'linkedin-page-account',
      [selected('linkedin-page-account', 'linkedin-page')],
      [],
      '<p>Hello</p>',
      []
    );

    expect(result.destinations[0].capability).toMatchObject({
      identifier: 'linkedin-page',
      profileIdentifier: 'linkedin',
      variant: 'feed',
    });
    expect(result.formatting.bold).toBe('unicode');
  });

  it('uses the semantic intersection of every active canonical field in global mode', () => {
    const result = resolveEditorCapabilityV2(
      'global',
      [
        selected('telegram-account', 'telegram'),
        selected('linkedin-account', 'linkedin'),
      ],
      [],
      '<p>Hello</p>',
      []
    );

    expect(result.formatting).toMatchObject({
      bold: 'unicode',
      underline: 'unicode',
      links: 'unsupported',
    });
    expect(getFormattingControls(result)).toEqual(['bold', 'underline']);
    expect(
      result.counters.map(({ targetIntegrationId }) => targetIntegrationId)
    ).toEqual(['telegram-account', 'linkedin-account']);
  });

  it('excludes internally overridden destinations from global controls and diagnostics', () => {
    const pinterest = selected('pinterest-account', 'pinterest');
    const vk = selected('vk-account', 'vk');
    const result = resolveEditorCapabilityV2(
      'global',
      [pinterest, vk],
      [{ integration: pinterest.integration, integrationValue: [] }],
      'x'.repeat(600),
      []
    );

    expect(
      result.destinations.map(({ targetIntegrationId }) => targetIntegrationId)
    ).toEqual(['vk-account']);
    expect(result.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetIntegrationId: 'pinterest-account' }),
      ])
    );
  });

  it('reconstructs unverified adapter limits from serialized V2 instead of client-writable legacy metadata', () => {
    const capabilitiesV2 = resolvePlatformCapabilityV2({
      identifier: 'legacy-html',
      settings: {},
      media: [],
      adapter: {
        editor: 'html',
        maximum: 321,
        stripRawUrls: true,
      },
    });
    const legacy = selected('legacy-account', 'legacy-html', capabilitiesV2);
    legacy.integration.editor = 'none';
    legacy.integration.stripLinks = false;
    legacy.integration.additionalSettings = '[{"maximum":999999}]';

    const result = resolveEditorCapabilityV2(
      'legacy-account',
      [legacy],
      [],
      '<p>Hello</p>',
      []
    );

    expect(result.destinations[0].activeField).toMatchObject({
      dialect: 'html',
      limit: { max: 321, source: 'application-safety' },
    });
    expect(result.destinations[0].capability.delivery.stripRawUrls).toBe(true);
  });
});
