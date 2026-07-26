# Plain-text Paste Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve every plain-text line break, including empty lines, when text is pasted into the post editor.

**Architecture:** Add a focused Tiptap extension that converts `text/plain` clipboard data into one paragraph node per source line. Register the extension in the shared `OnlyEditor`; file-containing clipboard events and clipboard payloads without usable plain text continue through existing handlers.

**Tech Stack:** TypeScript, React, Tiptap 3, ProseMirror, Vitest, jsdom, PNPM.

## Global Constraints

- Preserve each individual line break, including leading, trailing, and consecutive empty lines.
- Normalize LF, CRLF, and CR line endings to the same paragraph structure.
- Preserve plain-text characters, list markers, emoji, and Unicode without Markdown interpretation.
- Use `text/plain` as canonical for text-only clipboard events, even if HTML is also present.
- Do not intercept clipboard events containing files.
- Do not add dependencies, database changes, API changes, migrations, or provider-specific behavior.
- Run all project commands from the repository root with PNPM and the `rtk` prefix.

---

### Task 1: Plain-text paste extension

**Files:**
- Create: `apps/frontend/src/components/new-launch/plain-text-paste.extension.ts`
- Test: `apps/frontend/src/components/new-launch/plain-text-paste.extension.spec.ts`

**Interfaces:**
- Consumes: Tiptap `Extension`, `JSONContent`, and ProseMirror `Plugin`.
- Produces: `plainTextToParagraphs(text: string): JSONContent[]` and `PlainTextPasteExtension`.

- [ ] **Step 1: Write failing conversion and editor-level tests**

Create `apps/frontend/src/components/new-launch/plain-text-paste.extension.spec.ts`:

```ts
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
) =>
  editor.view.someProp('handlePaste', (handler) =>
    handler(
      editor.view,
      {
        clipboardData: {
          getData: (type: string) => (type === 'text/plain' ? text : ''),
          items,
        },
      } as unknown as ClipboardEvent,
      Slice.empty
    )
  );

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
      extensions: [
        Document,
        Paragraph,
        Text,
        PlainTextPasteExtension,
      ],
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
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
rtk pnpm exec vitest run apps/frontend/src/components/new-launch/plain-text-paste.extension.spec.ts
```

Expected: FAIL because `./plain-text-paste.extension` does not exist.

- [ ] **Step 3: Implement the minimal extension**

Create `apps/frontend/src/components/new-launch/plain-text-paste.extension.ts`:

```ts
import { Extension, JSONContent } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

export const plainTextToParagraphs = (text: string): JSONContent[] =>
  text.replace(/\r\n?/g, '\n').split('\n').map((line) => ({
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
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
rtk pnpm exec vitest run apps/frontend/src/components/new-launch/plain-text-paste.extension.spec.ts
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit the extension and tests**

```bash
rtk git add apps/frontend/src/components/new-launch/plain-text-paste.extension.ts apps/frontend/src/components/new-launch/plain-text-paste.extension.spec.ts
rtk git commit -m "feat: preserve blank lines in plain text paste"
```

---

### Task 2: Register the extension in the shared post editor

**Files:**
- Modify: `apps/frontend/src/components/new-launch/editor.tsx`
- Test: `apps/frontend/src/components/new-launch/plain-text-paste.extension.spec.ts`

**Interfaces:**
- Consumes: `PlainTextPasteExtension` from Task 1.
- Produces: all `OnlyEditor` instances use the custom plain-text paste behavior.

- [ ] **Step 1: Import and register the extension**

Add the import near the other new-launch component imports in `editor.tsx`:

```ts
import { PlainTextPasteExtension } from '@gitroom/frontend/components/new-launch/plain-text-paste.extension';
```

Add the extension once in the `OnlyEditor` `extensions` array, after `Text`:

```ts
      Document,
      Paragraph,
      Text,
      PlainTextPasteExtension,
      Underline,
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
rtk pnpm exec vitest run apps/frontend/src/components/new-launch/plain-text-paste.extension.spec.ts apps/frontend/src/components/new-launch/providers/linkedin/linkedin.provider.spec.tsx
```

Expected: all tests PASS.

- [ ] **Step 3: Run frontend TypeScript/build verification**

Run:

```bash
rtk pnpm build:frontend
```

Expected: frontend build exits with status 0 and reports no TypeScript or bundling errors.

- [ ] **Step 4: Review the final diff**

Run:

```bash
rtk git diff --check HEAD~1..HEAD
rtk git diff -- apps/frontend/src/components/new-launch/editor.tsx apps/frontend/src/components/new-launch/plain-text-paste.extension.ts apps/frontend/src/components/new-launch/plain-text-paste.extension.spec.ts
```

Expected: no whitespace errors; diff contains only extension registration, parser logic, and focused tests.

- [ ] **Step 5: Commit editor registration**

```bash
rtk git add apps/frontend/src/components/new-launch/editor.tsx
rtk git commit -m "feat: use plain text paste formatting in post editor"
```

---

### Task 3: Final verification

**Files:**
- Verify only; no planned file changes.

**Interfaces:**
- Consumes: completed Tasks 1 and 2.
- Produces: evidence that the feature is ready for review.

- [ ] **Step 1: Run all directly relevant tests from a clean state**

Run:

```bash
rtk pnpm exec vitest run apps/frontend/src/components/new-launch/plain-text-paste.extension.spec.ts apps/frontend/src/components/new-launch/providers/linkedin/linkedin.provider.spec.tsx
```

Expected: all tests PASS.

- [ ] **Step 2: Run the frontend build from the final commit**

Run:

```bash
rtk pnpm build:frontend
```

Expected: exit status 0.

- [ ] **Step 3: Confirm repository scope**

Run:

```bash
rtk git status --short
rtk git log -3 --oneline
```

Expected: no uncommitted task files; recent commits contain the spec, extension/tests, and editor registration.
