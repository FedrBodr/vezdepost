// @vitest-environment jsdom

import React, { createRef } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPlatformCapabilities } from '@gitroom/helpers/utils/platform.capabilities';

vi.mock('emoji-picker-react', () => ({
  default: (): null => null,
  Theme: { DARK: 'dark' },
}));
vi.mock('@copilotkit/react-core', () => ({
  useCopilotAction: vi.fn(),
  useCopilotReadable: vi.fn(),
}));
vi.mock('react-dropzone', () => ({
  useDropzone: () => ({
    getRootProps: () => ({}),
    isDragActive: false,
  }),
}));
vi.mock('@uppy/react', () => ({ Dashboard: (): null => null }));
vi.mock('@gitroom/frontend/components/signature', () => ({
  SignatureBox: (): null => null,
}));
vi.mock('@gitroom/frontend/components/media/media.component', () => ({
  MultiMediaComponent: (): null => null,
}));
vi.mock('@gitroom/frontend/components/media/new.uploader', () => ({
  useUppyUploader: () => ({
    addFile: vi.fn(),
    clear: vi.fn(),
  }),
}));
vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));
vi.mock('@gitroom/frontend/components/new-launch/store', () => ({
  useLaunchStore: (selector: (state: any) => unknown) =>
    selector({ current: 'global', internal: [] }),
}));
vi.mock(
  '@gitroom/frontend/components/launches/helpers/use.existing.data',
  () => ({ useExistingData: () => ({}) })
);
vi.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: vi.fn(),
}));

import { Editor, OnlyEditor } from './editor';
import { resolveEditorCapabilities } from './platform.editor.capabilities';

afterEach(() => {
  cleanup();
});

const renderEditor = async (
  capabilities: ReturnType<typeof getPlatformCapabilities>,
  value = '<p></p>'
) => {
  const ref = createRef<{ editor: any }>();
  const result = render(
    <OnlyEditor
      ref={ref}
      capabilities={capabilities}
      value={value}
      onChange={() => undefined}
    />
  );
  await waitFor(() => expect(ref.current?.editor).toBeTruthy());
  return { ...result, editor: ref.current!.editor };
};

const renderPlainEditor = (value = '<p></p>') =>
  renderEditor(getPlatformCapabilities('linkedin'), value);

describe('canonical editor schema and creation policy', () => {
  it('preserves canonical link, heading, and list markup while editing a plain profile', async () => {
    const { editor } = await renderPlainEditor(
      '<h2>Title <a href="https://example.com">linked</a></h2>' +
        '<ul><li><p>First item</p></li></ul><p>Tail</p>'
    );

    act(() => {
      editor.commands.focus('end');
      editor.commands.insertContent(' edited');
    });

    expect(editor.getHTML()).toBe(
      '<h2>Title <a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com">linked</a></h2>' +
        '<ul><li><p>First item</p></li></ul><p>Tail edited</p>'
    );
  });

  it('does not create hidden link, heading, or list markup through editor rules and shortcuts', async () => {
    const listEditor = (await renderPlainEditor()).editor;

    act(() => {
      listEditor.commands.keyboardShortcut('Mod-Shift-8');
    });
    expect(listEditor.getHTML()).toBe('<p></p>');

    const headingEditor = (await renderPlainEditor()).editor;
    act(() => {
      headingEditor.commands.keyboardShortcut('Mod-Alt-1');
    });
    expect(headingEditor.getHTML()).toBe('<p></p>');

    const linkEditor = (await renderPlainEditor()).editor;
    act(() => {
      linkEditor.commands.insertContent('https://example.com ');
    });
    expect(linkEditor.getHTML()).toBe('<p>https://example.com </p>');
    expect(linkEditor.getHTML()).not.toContain('<a');
  });

  it('keeps unicode-supported bold and underline shortcuts editable on a plain profile', async () => {
    const { editor } = await renderPlainEditor('<p>Text</p>');

    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 5 });
      editor.commands.keyboardShortcut('Mod-b');
    });
    expect(editor.getHTML()).toBe('<p><strong>Text</strong></p>');

    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 5 });
      editor.commands.keyboardShortcut('Mod-u');
    });
    expect(editor.getHTML()).toBe('<p><u>Text</u></p>');
  });

  it('keeps native structural and link creation enabled for rich profiles', async () => {
    const capabilities = getPlatformCapabilities('rich-profile', {
      editor: 'html',
      maximumCharacters: 1_000,
    });
    const headingEditor = (await renderEditor(capabilities)).editor;
    act(() => {
      headingEditor.commands.keyboardShortcut('Mod-Alt-1');
    });
    expect(headingEditor.getHTML()).toBe('<h1></h1>');

    const listEditor = (await renderEditor(capabilities)).editor;
    act(() => {
      listEditor.commands.keyboardShortcut('Mod-Shift-8');
    });
    expect(listEditor.getHTML()).toBe('<ul><li><p></p></li></ul>');

    const linkEditor = (await renderEditor(capabilities)).editor;
    act(() => {
      linkEditor.commands.insertContent('https://example.com ');
    });
    expect(linkEditor.getHTML()).toContain('<a');
  });

  it.each(['b', 'u'])(
    'consumes native Mod-%s when the inline mark is unsupported',
    async (key) => {
      const capabilities = getPlatformCapabilities('unsupported-profile', {
        editor: 'none',
        maximumCharacters: 1_000,
      });
      const { editor } = await renderEditor(capabilities, '<p>Text</p>');
      const event = new KeyboardEvent('keydown', {
        key,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });

      act(() => {
        editor.view.dom.dispatchEvent(event);
      });

      expect(event.defaultPrevented).toBe(true);
      expect(editor.getHTML()).toBe('<p>Text</p>');
    }
  );

  it('does not emit destination diagnostics when no global targets remain', () => {
    render(
      <Editor
        identifier="global"
        capabilities={resolveEditorCapabilities('global', [])}
        comments={true}
        chars={{}}
        selectedIntegration={[]}
        onChange={() => undefined}
        value='<p><a href="https://example.com">Source link</a></p>'
        totalPosts={1}
        dummy={false}
      />
    );

    expect(
      screen.queryByText('Some formatting will be converted to plain text.')
    ).toBeNull();
  });
});
