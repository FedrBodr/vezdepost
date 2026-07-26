import { Extension, JSONContent } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

export const plainTextToParagraphs = (text: string): JSONContent[] =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => ({
      type: 'paragraph',
      ...(line ? { content: [{ type: 'text', text: line }] } : {}),
    }));

export const PlainTextPasteExtension = Extension.create({
  name: 'plainTextPaste',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handlePaste: (_view, event) => {
            const clipboard = event.clipboardData;
            if (!clipboard) {
              return false;
            }

            const hasFiles = Array.from(clipboard.items).some(
              (item) => item.kind === 'file'
            );
            const text = clipboard.getData('text/plain');

            if (hasFiles || !text) {
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
