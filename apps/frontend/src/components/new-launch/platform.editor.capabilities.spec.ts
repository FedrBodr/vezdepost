import { describe, expect, it } from 'vitest';
import { getPlatformCapabilities } from '@gitroom/helpers/utils/platform.capabilities';
import {
  getFormattingControls,
  resolveEditorCapabilities,
} from './platform.editor.capabilities';

const selected = (id: string, provider: string) =>
  ({
    integration: {
      id,
      identifier: provider,
      capabilities: getPlatformCapabilities(provider),
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
});
