import { Extension, type Extensions } from '@tiptap/core';
import Bold from '@tiptap/extension-bold';
import Heading from '@tiptap/extension-heading';
import Italic from '@tiptap/extension-italic';
import Link from '@tiptap/extension-link';
import { BulletList, ListItem, OrderedList } from '@tiptap/extension-list';
import Strike from '@tiptap/extension-strike';
import Underline from '@tiptap/extension-underline';
import {
  getEditorSemanticPolicy,
  getEditorSemanticPolicyKey,
  type EditorSemanticPolicy,
  type SemanticEditorCapability,
} from './platform.editor.semantic-policy';

export type { SemanticEditorCapability } from './platform.editor.semantic-policy';

export type EditorCreationPolicy = EditorSemanticPolicy;

export const getEditorCreationPolicy = (
  capabilities: SemanticEditorCapability
): EditorCreationPolicy => getEditorSemanticPolicy(capabilities);

export const getEditorCreationPolicyKey = (
  capabilities: SemanticEditorCapability
): string => getEditorSemanticPolicyKey(capabilities);

const InterceptBoldShortcut = Extension.create({
  name: 'preventBoldWithUnderline',

  addKeyboardShortcuts() {
    return {
      'Mod-b': () => {
        this.editor.commands.unsetUnderline();
        return this.editor.commands.toggleBold();
      },
    };
  },
});

const InterceptUnderlineShortcut = Extension.create({
  name: 'preventUnderlineWithUnderline',

  addKeyboardShortcuts() {
    return {
      'Mod-u': () => {
        this.editor.commands.unsetBold();
        return this.editor.commands.toggleUnderline();
      },
    };
  },
});

const isAllowedLinkUri = (
  url: string,
  ctx: {
    defaultValidate: (url: string) => boolean;
    protocols: Array<string | { scheme: string }>;
    defaultProtocol: string;
  }
) => {
  try {
    const trimmed = String(url).trim();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailPattern.test(trimmed)) {
      return false;
    }

    const parsedUrl = url.includes(':')
      ? new URL(url)
      : new URL(`${ctx.defaultProtocol}://${url}`);
    if (!ctx.defaultValidate(parsedUrl.href)) {
      return false;
    }

    const disallowedProtocols = ['ftp', 'file', 'mailto'];
    const protocol = parsedUrl.protocol.replace(':', '');
    if (disallowedProtocols.includes(protocol)) {
      return false;
    }

    const allowedProtocols = ctx.protocols.map((item) =>
      typeof item === 'string' ? item : item.scheme
    );
    return allowedProtocols.includes(protocol);
  } catch {
    return false;
  }
};

const shouldAutoLink = (url: string) => {
  try {
    const trimmed = String(url).trim();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailPattern.test(trimmed)) {
      return false;
    }

    const parsedUrl = url.includes(':')
      ? new URL(url)
      : new URL(`https://${url}`);
    const disallowedDomains = [
      'example-no-autolink.com',
      'another-no-autolink.com',
    ];
    return !disallowedDomains.includes(parsedUrl.hostname);
  } catch {
    return false;
  }
};

const rejectEditorCommand = () => () => false;

export const createCanonicalEditorExtensions = (
  capabilities: SemanticEditorCapability
): Extensions => {
  const policy = getEditorCreationPolicy(capabilities);
  const CapabilityAwareUnderline = Underline.extend({
    addCommands() {
      const parentCommands = this.parent?.() || {};
      return policy.underline
        ? parentCommands
        : {
            ...parentCommands,
            setUnderline: rejectEditorCommand,
            toggleUnderline: rejectEditorCommand,
            unsetUnderline: rejectEditorCommand,
          };
    },
    addKeyboardShortcuts() {
      return policy.underline
        ? this.parent?.() || {}
        : { 'Mod-u': () => true, 'Mod-U': () => true };
    },
  });
  const CapabilityAwareBold = Bold.extend({
    addCommands() {
      const parentCommands = this.parent?.() || {};
      return policy.bold
        ? parentCommands
        : {
            ...parentCommands,
            setBold: rejectEditorCommand,
            toggleBold: rejectEditorCommand,
            unsetBold: rejectEditorCommand,
          };
    },
    addKeyboardShortcuts() {
      return policy.bold
        ? this.parent?.() || {}
        : { 'Mod-b': () => true, 'Mod-B': () => true };
    },
    addInputRules() {
      return policy.bold ? this.parent?.() || [] : [];
    },
    addPasteRules() {
      return policy.bold ? this.parent?.() || [] : [];
    },
  });
  const CapabilityAwareItalic = Italic.extend({
    addCommands() {
      const parentCommands = this.parent?.() || {};
      return policy.italic
        ? parentCommands
        : {
            ...parentCommands,
            setItalic: rejectEditorCommand,
            toggleItalic: rejectEditorCommand,
            unsetItalic: rejectEditorCommand,
          };
    },
    addKeyboardShortcuts() {
      return policy.italic
        ? this.parent?.() || {}
        : { 'Mod-i': () => true, 'Mod-I': () => true };
    },
    addInputRules() {
      return policy.italic ? this.parent?.() || [] : [];
    },
    addPasteRules() {
      return policy.italic ? this.parent?.() || [] : [];
    },
  });
  const CapabilityAwareStrike = Strike.extend({
    addCommands() {
      const parentCommands = this.parent?.() || {};
      return policy.strike
        ? parentCommands
        : {
            ...parentCommands,
            setStrike: rejectEditorCommand,
            toggleStrike: rejectEditorCommand,
            unsetStrike: rejectEditorCommand,
          };
    },
    addKeyboardShortcuts() {
      return policy.strike
        ? this.parent?.() || {}
        : { 'Mod-Shift-s': () => true, 'Mod-Shift-S': () => true };
    },
    addInputRules() {
      return policy.strike ? this.parent?.() || [] : [];
    },
    addPasteRules() {
      return policy.strike ? this.parent?.() || [] : [];
    },
  });
  const CapabilityAwareLink = Link.extend({
    addCommands() {
      const parentCommands = this.parent?.() || {};
      return policy.link
        ? parentCommands
        : {
            ...parentCommands,
            setLink: rejectEditorCommand,
            toggleLink: rejectEditorCommand,
            unsetLink: rejectEditorCommand,
          };
    },
    addPasteRules() {
      return policy.link ? this.parent?.() || [] : [];
    },
  }).configure({
    openOnClick: false,
    autolink: policy.link,
    linkOnPaste: policy.link,
    defaultProtocol: 'https',
    protocols: ['http', 'https'],
    isAllowedUri: isAllowedLinkUri,
    shouldAutoLink,
  });
  const CapabilityAwareHeading = Heading.extend({
    addCommands() {
      const parentCommands = this.parent?.() || {};
      return policy.heading
        ? parentCommands
        : {
            ...parentCommands,
            setHeading: rejectEditorCommand,
            toggleHeading: rejectEditorCommand,
          };
    },
    addKeyboardShortcuts() {
      return policy.heading ? this.parent?.() || {} : {};
    },
    addInputRules() {
      return policy.heading ? this.parent?.() || [] : [];
    },
  }).configure({ levels: [1, 2, 3] });
  const CapabilityAwareBulletList = BulletList.extend({
    addCommands() {
      const parentCommands = this.parent?.() || {};
      return policy.list
        ? parentCommands
        : {
            ...parentCommands,
            toggleBulletList: rejectEditorCommand,
          };
    },
    addKeyboardShortcuts() {
      return policy.list ? this.parent?.() || {} : {};
    },
    addInputRules() {
      return policy.list ? this.parent?.() || [] : [];
    },
  });
  const CapabilityAwareOrderedList = OrderedList.extend({
    addCommands() {
      const parentCommands = this.parent?.() || {};
      return policy.orderedList
        ? parentCommands
        : {
            ...parentCommands,
            toggleOrderedList: rejectEditorCommand,
          };
    },
    addKeyboardShortcuts() {
      return policy.orderedList
        ? this.parent?.() || {}
        : { 'Mod-Shift-7': () => true };
    },
    addInputRules() {
      return policy.orderedList ? this.parent?.() || [] : [];
    },
  });
  const CapabilityAwareListItem = ListItem.extend({
    addKeyboardShortcuts() {
      return policy.list || policy.orderedList ? this.parent?.() || {} : {};
    },
  });

  return [
    CapabilityAwareUnderline,
    CapabilityAwareBold,
    CapabilityAwareItalic,
    CapabilityAwareStrike,
    ...(policy.bold ? [InterceptBoldShortcut] : []),
    ...(policy.underline ? [InterceptUnderlineShortcut] : []),
    CapabilityAwareLink,
    CapabilityAwareHeading,
    CapabilityAwareBulletList,
    CapabilityAwareOrderedList,
    CapabilityAwareListItem,
  ];
};
