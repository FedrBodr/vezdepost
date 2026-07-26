// @vitest-environment jsdom

import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Slice } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import {
  plainTextToParagraphs,
  PlainTextPasteExtension,
} from './plain-text-paste.extension';

const paragraph = (text?: string) => ({
  type: 'paragraph',
  ...(text ? { content: [{ type: 'text', text }] } : {}),
});

const paste = (
  editor: Editor,
  text: string,
  items: Array<{ kind: string }> = []
) => {
  let handled = false;

  editor.view.someProp('handlePaste', (handler) => {
    handled =
      handler(
        editor.view,
        {
          clipboardData: {
            getData: (type: string) => (type === 'text/plain' ? text : ''),
            items,
          },
        } as unknown as ClipboardEvent,
        Slice.empty
      ) || handled;

    return handled;
  });

  return handled;
};

describe('plainTextToParagraphs', () => {
  it('preserves every LF line, including leading, consecutive, and trailing empty lines', () => {
    expect(plainTextToParagraphs('\nfirst\n\n• second 🚀\n')).toEqual([
      paragraph(),
      paragraph('first'),
      paragraph(),
      paragraph('• second 🚀'),
      paragraph(),
    ]);
  });

  it('normalizes CRLF and CR line endings', () => {
    expect(plainTextToParagraphs('first\r\n\rthird\r')).toEqual([
      paragraph('first'),
      paragraph(),
      paragraph('third'),
      paragraph(),
    ]);
  });

  it('keeps Markdown markers literal', () => {
    expect(plainTextToParagraphs('**bold**')).toEqual([
      paragraph('**bold**'),
    ]);
  });
});

describe('PlainTextPasteExtension', () => {
  const createEditor = () =>
    new Editor({
      extensions: [Document, Paragraph, Text, PlainTextPasteExtension],
      content: '<p>replace me</p>',
    });

  it('replaces the selection and retains an empty paragraph', () => {
    const editor = createEditor();
    editor.commands.selectAll();

    expect(paste(editor, 'first\n\nsecond')).toBe(true);
    expect(editor.getHTML()).toBe('<p>first</p><p></p><p>second</p>');

    editor.destroy();
  });

  it('does not intercept clipboard payloads containing files', () => {
    const editor = createEditor();

    expect(paste(editor, 'caption', [{ kind: 'file' }])).toBe(false);
    expect(editor.getHTML()).toBe('<p>replace me</p>');

    editor.destroy();
  });

  it('does not intercept an empty plain-text payload', () => {
    const editor = createEditor();

    expect(paste(editor, '')).toBe(false);
    expect(editor.getHTML()).toBe('<p>replace me</p>');

    editor.destroy();
  });
});
