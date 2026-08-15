import { describe, expect, it } from 'vitest';
import { getPlatformCapabilities } from '@gitroom/helpers/utils/platform.capabilities';
import {
  getControlDependentEditorExtensions,
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

  it('uses the exact profile in platform-specific mode', () => {
    const result = resolveEditorCapabilities('tg', [
      selected('tg', 'telegram'),
      selected('vk', 'vk'),
    ]);

    expect(result.identifier).toBe('telegram');
    expect(result.text.mediaCaptionMax).toBe(1024);
  });

  it('installs the link extension when global mode shows the link control', () => {
    const result = resolveEditorCapabilities('global', [
      selected('max', 'max'),
    ]);

    expect(getFormattingControls(result)).toContain('link');
    expect(getControlDependentEditorExtensions(result)).toContain('link');
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
    expect(getControlDependentEditorExtensions(result)).toContain('heading');
  });
});
