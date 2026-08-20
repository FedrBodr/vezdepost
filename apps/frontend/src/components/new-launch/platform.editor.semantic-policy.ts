import type {
  FormattingSupport,
  TextFieldCapability,
} from '@gitroom/helpers/utils/platform.capability.types';

export type SemanticEditorCapability = Pick<TextFieldCapability, 'formatting'>;

export interface EditorSemanticPolicy {
  bold: boolean;
  underline: boolean;
  link: boolean;
  list: boolean;
  heading: boolean;
}

const supportsInlineFormatting = (support: FormattingSupport): boolean =>
  support === 'native' || support === 'unicode';

export const getEditorSemanticPolicy = (
  capability: SemanticEditorCapability
): EditorSemanticPolicy => ({
  bold: supportsInlineFormatting(capability.formatting.bold),
  underline: supportsInlineFormatting(capability.formatting.underline),
  link: capability.formatting.links === 'native',
  list: capability.formatting.lists === 'native',
  heading: capability.formatting.headings === 'native',
});

export const getEditorSemanticPolicyKey = (
  capability: SemanticEditorCapability
): string =>
  Object.values(getEditorSemanticPolicy(capability))
    .map((enabled) => (enabled ? '1' : '0'))
    .join('');
