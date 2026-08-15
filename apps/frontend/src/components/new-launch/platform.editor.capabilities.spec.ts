import { describe, expect, it } from 'vitest';
import { getPlatformCapabilities } from '@gitroom/helpers/utils/platform.capabilities';
import {
  getFormattingControls,
  resolveEditorCapabilities,
} from './platform.editor.capabilities';

const selected = (
  id: string,
  provider: string,
  capabilities = getPlatformCapabilities(provider)
) =>
  ({
    integration: {
      id,
      identifier: provider,
      capabilities,
    },
    settings: {},
  } as any);

const legacySelected = (
  id: string,
  provider: string,
  editor: 'none' | 'normal' | 'markdown' | 'html' = 'normal',
  stripLinks = false
) =>
  ({
    integration: {
      id,
      identifier: provider,
      editor,
      stripLinks,
    },
    settings: {},
  } as any);

describe('platform editor capabilities', () => {
  it('uses selected-channel intersection in global mode', () => {
    const result = resolveEditorCapabilities('global', [
      selected('tg', 'telegram'),
      selected('vk', 'vk'),
    ]);

    expect(result.identifier).toBe('universal');
    expect(result.text.max).toBe(4096);
    expect(getFormattingControls(result)).toEqual(['bold', 'underline']);
  });

  it('excludes internally overridden destinations from the global intersection', () => {
    const pinterest = selected('pinterest-account', 'pinterest');
    const vk = selected('vk-account', 'vk');

    const result = resolveEditorCapabilities(
      'global',
      [pinterest, vk],
      [
        {
          integration: pinterest.integration,
          integrationValue: [],
        },
      ]
    );

    expect(result.text.max).toBe(16_384);
    expect(result.media.required).toBe(false);
    expect(result.media.maxImages).toBeUndefined();
  });

  it('uses the exact profile in platform-specific mode', () => {
    const result = resolveEditorCapabilities('tg', [
      selected('tg', 'telegram'),
      selected('vk', 'vk'),
    ]);

    expect(result.identifier).toBe('telegram');
    expect(result.text.mediaCaptionMax).toBe(1024);
  });

  it('resolves an active profile by identifier when serialized capabilities are missing', () => {
    const result = resolveEditorCapabilities(
      'tg',
      [legacySelected('tg', 'telegram', 'none', true)],
      [],
      { tg: 12 }
    );

    expect(result.identifier).toBe('telegram');
    expect(result.output).toBe('html');
    expect(result.text.max).toBe(4096);
    expect(result.delivery.stripRawUrls).toBe(false);
  });

  it('preserves legacy editor, maximum, and strip flag for an unaudited profile', () => {
    const result = resolveEditorCapabilities(
      'legacy',
      [legacySelected('legacy', 'legacy-html', 'html', true)],
      [],
      { legacy: 321 }
    );

    expect(result.identifier).toBe('legacy-html');
    expect(result.output).toBe('html');
    expect(result.text.max).toBe(321);
    expect(result.delivery.stripRawUrls).toBe(true);
  });

  it('intersects global targets conservatively when capabilities are missing', () => {
    const result = resolveEditorCapabilities(
      'global',
      [
        legacySelected('tg', 'telegram'),
        legacySelected('legacy', 'legacy-none', 'none', true),
      ],
      [],
      { legacy: 700 }
    );

    expect(result.identifier).toBe('universal');
    expect(result.text.max).toBe(700);
    expect(result.formatting.bold).toBe('unsupported');
    expect(result.delivery.stripRawUrls).toBe(true);
  });

  it('hides unsupported Telegram link and heading controls', () => {
    const result = resolveEditorCapabilities('tg', [
      selected('tg', 'telegram'),
    ]);

    expect(getFormattingControls(result)).not.toContain('link');
    expect(getFormattingControls(result)).not.toContain('heading');
  });

  it('hides non-native Markdown link and heading controls', () => {
    const result = resolveEditorCapabilities('markdown', [
      selected('markdown', 'markdown-provider', {
        ...getPlatformCapabilities('telegram'),
        identifier: 'markdown-provider',
        output: 'markdown',
      }),
    ]);

    expect(getFormattingControls(result)).not.toContain('link');
    expect(getFormattingControls(result)).not.toContain('heading');
  });

  it('hides plain-output link and heading controls', () => {
    const result = resolveEditorCapabilities('linkedin', [
      selected('linkedin', 'linkedin'),
    ]);

    expect(getFormattingControls(result)).not.toContain('link');
    expect(getFormattingControls(result)).not.toContain('heading');
  });

  it('installs the link extension when global mode shows the link control', () => {
    const result = resolveEditorCapabilities('global', [
      selected('max', 'max'),
    ]);

    expect(getFormattingControls(result)).toContain('link');
  });

  it('installs the heading extension when global mode shows the heading control', () => {
    const result = resolveEditorCapabilities('global', [
      selected(
        'heading',
        'heading-provider',
        getPlatformCapabilities('heading-provider', {
          editor: 'html',
          maximumCharacters: 1000,
        })
      ),
    ]);

    expect(getFormattingControls(result)).toContain('heading');
  });
});
