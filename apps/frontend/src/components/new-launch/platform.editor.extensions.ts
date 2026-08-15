import { Extension, type Extensions } from '@tiptap/core';
import Bold from '@tiptap/extension-bold';
import Heading from '@tiptap/extension-heading';
import Link from '@tiptap/extension-link';
import { BulletList, ListItem } from '@tiptap/extension-list';
import Underline from '@tiptap/extension-underline';
import type { PlatformCapabilities } from '@gitroom/helpers/utils/platform.capabilities';

export interface EditorCreationPolicy {
  bold: boolean;
  underline: boolean;
  link: boolean;
  list: boolean;
  heading: boolean;
}

export const getEditorCreationPolicy = (
  capabilities: PlatformCapabilities
): EditorCreationPolicy => ({
  bold: capabilities.formatting.bold !== 'unsupported',
  underline: capabilities.formatting.underline !== 'unsupported',
  link: capabilities.formatting.links === 'native',
  list: capabilities.formatting.lists === 'native',
  heading: capabilities.formatting.headings === 'native',
});

export const getEditorCreationPolicyKey = (
  capabilities: PlatformCapabilities
): string => {
  const policy = getEditorCreationPolicy(capabilities);
  return Object.values(policy)
    .map((enabled) => (enabled ? '1' : '0'))
    .join('');
};

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

export const createCanonicalEditorExtensions = (
  capabilities: PlatformCapabilities
): Extensions => {
  const policy = getEditorCreationPolicy(capabilities);
  const CapabilityAwareUnderline = Underline.extend({
    addKeyboardShortcuts() {
      return policy.underline
        ? this.parent?.() || {}
        : { 'Mod-u': () => true, 'Mod-U': () => true };
    },
  });
  const CapabilityAwareBold = Bold.extend({
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
  const CapabilityAwareLink = Link.extend({
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
    addKeyboardShortcuts() {
      return policy.heading ? this.parent?.() || {} : {};
    },
    addInputRules() {
      return policy.heading ? this.parent?.() || [] : [];
    },
  }).configure({ levels: [1, 2, 3] });
  const CapabilityAwareBulletList = BulletList.extend({
    addKeyboardShortcuts() {
      return policy.list ? this.parent?.() || {} : {};
    },
    addInputRules() {
      return policy.list ? this.parent?.() || [] : [];
    },
  });
  const CapabilityAwareListItem = ListItem.extend({
    addKeyboardShortcuts() {
      return policy.list ? this.parent?.() || {} : {};
    },
  });

  return [
    CapabilityAwareUnderline,
    CapabilityAwareBold,
    ...(policy.bold ? [InterceptBoldShortcut] : []),
    ...(policy.underline ? [InterceptUnderlineShortcut] : []),
    CapabilityAwareLink,
    CapabilityAwareHeading,
    CapabilityAwareBulletList,
    CapabilityAwareListItem,
  ];
};
