// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { EditorContent, useEditor } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signatureState = vi.hoisted(() => ({
  value: '',
  openModal: vi.fn(),
}));

vi.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal: signatureState.openModal }),
}));
vi.mock(
  '@gitroom/frontend/components/settings/signatures.component',
  async () => {
    const ReactModule = await import('react');
    return {
      SignaturesComponent: ({
        appendSignature,
      }: {
        appendSignature: (value: string) => void;
      }) =>
        ReactModule.createElement(
          'button',
          { onClick: () => appendSignature(signatureState.value) },
          'Insert signature'
        ),
    };
  }
);

import { SignatureBox } from './signature';

vi.stubGlobal('React', React);

const TipTapSignatureHarness = () => {
  const editor = useEditor({
    extensions: [Document, Paragraph, Text],
    content: '<p>Before</p>',
    immediatelyRender: false,
  });

  return (
    <>
      <EditorContent editor={editor} />
      {!!editor && <SignatureBox editor={editor} />}
    </>
  );
};

const insertSignature = (value: string) => {
  signatureState.value = value;
  const editor = {
    commands: {
      insertContent: vi.fn(),
      focus: vi.fn(),
    },
  };
  const { container } = render(<SignatureBox editor={editor} />);

  fireEvent.click(
    container.querySelector<HTMLElement>(
      '[data-tooltip-content="Add Signature"]'
    )!
  );
  const modal = signatureState.openModal.mock.calls[0][0];
  render(modal.children(vi.fn()));
  fireEvent.click(screen.getByRole('button', { name: 'Insert signature' }));

  return editor;
};

beforeEach(() => {
  signatureState.value = '';
  signatureState.openModal.mockClear();
});

afterEach(cleanup);

describe('SignatureBox', () => {
  it('renders hostile signature markup as text in a real TipTap document', async () => {
    const signature =
      '<h1>hello</h1><script>alert(1)</script><ul><li>item</li></ul>';
    signatureState.value = signature;
    const view = render(<TipTapSignatureHarness />);

    const addSignature = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>(
        '[data-tooltip-content="Add Signature"]'
      );
      expect(element).toBeTruthy();
      return element!;
    });
    fireEvent.click(addSignature);
    const modal = signatureState.openModal.mock.calls[0][0];
    render(modal.children(vi.fn()));
    fireEvent.click(screen.getByRole('button', { name: 'Insert signature' }));

    const editable = view.container.querySelector('.ProseMirror');
    await waitFor(() => expect(editable?.textContent).toContain(signature));
    expect(editable?.querySelector('h1, script, ul, li')).toBeNull();
    expect(editable?.innerHTML).toContain('&lt;h1&gt;hello&lt;/h1&gt;');
  });

  it('inserts format-like and hostile signatures as literal text', () => {
    const signature =
      '<h1>hello</h1><script>alert(1)</script><ul><li>item</li></ul>';
    const editor = insertSignature(signature);

    expect(editor.commands.insertContent).toHaveBeenCalledWith([
      { type: 'paragraph' },
      { type: 'paragraph' },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: signature }],
      },
    ]);
    expect(editor.commands.focus).toHaveBeenCalledOnce();
  });

  it('preserves multiline signatures as readable paragraphs', () => {
    const editor = insertSignature('Kind regards,\r\nAda\nEngineering');

    expect(editor.commands.insertContent).toHaveBeenCalledWith([
      { type: 'paragraph' },
      { type: 'paragraph' },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Kind regards,' }],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'Ada' }] },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Engineering' }],
      },
    ]);
  });
});
