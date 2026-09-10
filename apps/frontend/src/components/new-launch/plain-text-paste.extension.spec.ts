// @vitest-environment jsdom

import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Italic from '@tiptap/extension-italic';
import Paragraph from '@tiptap/extension-paragraph';
import Strike from '@tiptap/extension-strike';
import Text from '@tiptap/extension-text';
import { Slice } from '@tiptap/pm/model';
import { describe, expect, it, vi } from 'vitest';
import {
  plainTextToParagraphs,
  PlainTextPasteExtension,
} from './plain-text-paste.extension';

class TestDataTransfer {
  private readonly data = new Map<string, string>();
  readonly items: Array<{ kind: string }> = [];

  getData(type: string) {
    return this.data.get(type) ?? '';
  }

  setData(type: string, value: string) {
    this.data.set(type, value);
  }
}

class TestClipboardEvent extends Event {
  readonly clipboardData: TestDataTransfer | null;

  constructor(
    type: string,
    init?: EventInit & { clipboardData?: TestDataTransfer }
  ) {
    super(type, init);
    this.clipboardData = init?.clipboardData ?? null;
  }
}

vi.stubGlobal('DataTransfer', TestDataTransfer);
vi.stubGlobal('ClipboardEvent', TestClipboardEvent);

const dispatchPaste = (editor: Editor, text: string) => {
  const clipboardData = new TestDataTransfer();
  clipboardData.setData('text/plain', text);
  const event = new TestClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData,
  });

  return !editor.view.dom.dispatchEvent(event);
};

const paragraph = (text?: string) => ({
  type: 'paragraph',
  ...(text ? { content: [{ type: 'text', text }] } : {}),
});

const paste = (
  editor: Editor,
  text: string,
  items: Array<{ kind: string }> = [],
  html = ''
) => {
  let handled = false;

  editor.view.someProp('handlePaste', (handler) => {
    handled =
      handler(
        editor.view,
        {
          clipboardData: {
            getData: (type: string) =>
              type === 'text/plain' ? text : type === 'text/html' ? html : '',
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
    expect(plainTextToParagraphs('**bold**')).toEqual([paragraph('**bold**')]);
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

  it('does not flatten a rich HTML clipboard payload to plain text', () => {
    const editor = createEditor();

    expect(paste(editor, 'soft', [], '<p><em>soft</em></p>')).toBe(false);
    expect(editor.getHTML()).toBe('<p>replace me</p>');

    editor.destroy();
  });

  it('applies enabled native paste rules while preserving paragraph breaks', () => {
    const editor = new Editor({
      extensions: [
        Document,
        Paragraph,
        Text,
        Italic,
        Strike,
        PlainTextPasteExtension.configure({ applyPasteRules: true }),
      ],
      content: '<p>replace me</p>',
    });
    editor.commands.selectAll();

    expect(paste(editor, '*soft* ~~gone~~\n\nnext')).toBe(false);
    expect(dispatchPaste(editor, '*soft* ~~gone~~\n\nnext')).toBe(true);
    expect(editor.getHTML()).toBe(
      '<p><em>soft</em> <s>gone</s></p><p></p><p>next</p>'
    );

    editor.destroy();
  });

  it('does not intercept an empty plain-text payload', () => {
    const editor = createEditor();

    expect(paste(editor, '')).toBe(false);
    expect(editor.getHTML()).toBe('<p>replace me</p>');

    editor.destroy();
  });
});
