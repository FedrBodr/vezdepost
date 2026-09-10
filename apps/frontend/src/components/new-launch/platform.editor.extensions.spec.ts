import { describe, expect, it } from 'vitest';
import type {
  FormattingSupport,
  TextFieldCapability,
} from '@gitroom/helpers/utils/platform.capability.types';
import { getFormattingControls } from './platform.editor.capabilities';
import {
  getEditorCreationPolicy,
  getEditorCreationPolicyKey,
} from './platform.editor.extensions';

const capability = (
  inlineSupport: FormattingSupport
): Pick<TextFieldCapability, 'formatting'> => ({
  formatting: {
    bold: inlineSupport,
    underline: inlineSupport,
    italic: 'plain',
    strike: 'plain',
    links: 'unsupported',
    lists: 'unsupported',
    orderedLists: 'unsupported',
    headings: 'unsupported',
  },
});

describe('semantic editor creation policy', () => {
  it.each([
    ['unsupported', false],
    ['plain', false],
    ['unicode', true],
    ['native', true],
  ] as const)(
    'keeps toolbar controls and extensions aligned for %s inline formatting',
    (support, enabled) => {
      const semanticCapability = capability(support);

      expect(getEditorCreationPolicy(semanticCapability)).toMatchObject({
        bold: enabled,
        underline: enabled,
        italic: false,
        strike: false,
        orderedList: false,
      });
      expect(getFormattingControls(semanticCapability)).toEqual(
        enabled ? ['bold', 'underline'] : []
      );
    }
  );

  it('uses a disabled policy key for plain inline formatting', () => {
    const plainKey = getEditorCreationPolicyKey(capability('plain'));
    const unicodeKey = getEditorCreationPolicyKey(capability('unicode'));
    const nativeKey = getEditorCreationPolicyKey(capability('native'));

    expect(plainKey).not.toBe(unicodeKey);
    expect(plainKey).not.toBe(nativeKey);
    expect(unicodeKey).toBe(nativeKey);
  });
});
