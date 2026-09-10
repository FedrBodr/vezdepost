import { Extension, JSONContent } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';

interface PlainTextPasteOptions {
  applyPasteRules: boolean;
}

export const plainTextToParagraphs = (text: string): JSONContent[] =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => ({
      type: 'paragraph',
      ...(line ? { content: [{ type: 'text', text: line }] } : {}),
    }));

export const PlainTextPasteExtension = Extension.create<PlainTextPasteOptions>({
  name: 'plainTextPaste',

  addOptions() {
    return {
      applyPasteRules: false,
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          clipboardTextParser: (text) =>
            new Slice(
              Fragment.fromArray(
                plainTextToParagraphs(text).map((node) =>
                  this.editor.schema.nodeFromJSON(node)
                )
              ),
              0,
              0
            ),
          handlePaste: (_view, event) => {
            const clipboard = event.clipboardData;
            if (!clipboard) {
              return false;
            }

            const hasFiles = Array.from(clipboard.items).some(
              (item) => item.kind === 'file'
            );
            const html = clipboard.getData('text/html');
            const text = clipboard.getData('text/plain');

            if (hasFiles || html || !text || this.options.applyPasteRules) {
              return false;
            }

            return this.editor.commands.insertContent(
              plainTextToParagraphs(text)
            );
          },
        },
      }),
    ];
  },
});
