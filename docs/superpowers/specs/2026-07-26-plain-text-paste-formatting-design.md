# Plain-text paste formatting

## Problem

The post editor delegates textual clipboard parsing to Tiptap/ProseMirror. Its
default plain-text parser treats one or more consecutive line breaks as the
same paragraph boundary. As a result, copying text such as `first\n\nsecond`
into the editor removes the empty line and stores the equivalent of
`first\nsecond`.

This happens before post preview rendering or provider-specific serialization,
so the lost spacing cannot be restored later.

## Scope

This change makes plain-text paste preserve the source text's line structure in
every post editor that uses `OnlyEditor`.

It preserves:

- each individual line break;
- leading, trailing, and consecutive empty lines;
- spaces and visible list characters such as `-`, `—`, and `•`;
- emoji and other Unicode text;
- equivalent behavior for LF, CRLF, and CR line endings.

The change does not parse Markdown or import rich-text formatting from Word,
Google Docs, Notion, or similar sources. Text such as `**bold**` remains
literal text. Provider-specific formatting and publishing behavior remain out
of scope.

## Design

Add a small, reusable Tiptap extension for plain-text paste. The extension will
read the clipboard's `text/plain` value, normalize CRLF and CR line endings to
LF, and split with `"\n"` rather than a regular expression that combines
consecutive breaks.

Each resulting entry becomes a paragraph node:

```text
first

third
```

becomes conceptually:

```html
<p>first</p>
<p></p>
<p>third</p>
```

The extension inserts these nodes at the current selection and marks the paste
event as handled. It uses `text/plain` as the canonical representation for
textual paste, even when the clipboard also contains HTML. This makes the
result independent of source-specific clipboard markup and intentionally
discards imported rich-text styles.

The extension is registered once in `OnlyEditor`, alongside the existing
Tiptap extensions. Existing `onPaste` file handling remains responsible for
clipboard images and other uploaded files.

## Clipboard rules

1. When the clipboard contains one or more file items, the text extension does
   not take over the event. Existing upload behavior continues unchanged.
2. When the clipboard contains non-empty `text/plain` and no file items, the
   extension inserts the normalized paragraph structure.
3. When no usable plain text is present, the extension returns control to the
   existing Tiptap behavior.
4. Pasting over a selection replaces that selection, matching normal editor
   behavior.

Mixed file-and-text clipboard payloads remain governed by the existing file
paste path. Preserving textual blank lines in such uncommon mixed payloads is
not part of this change.

## Data flow

```text
Clipboard text
  -> plain-text paste extension
  -> normalize line endings
  -> one paragraph node per source line
  -> editor HTML, including empty <p> nodes
  -> existing onChange/store flow
  -> existing stripHtmlValidation serialization
  -> provider preview and publishing
```

No database, API, migration, or provider change is required because the editor
already stores HTML paragraphs and the existing serializers already convert
paragraphs to line breaks.

## Failure handling

The parser performs no network or asynchronous work. If the clipboard does not
expose plain text, it declines to handle the event and leaves the current
editor behavior intact. File items always stay on the existing upload path.

## Testing

Add focused unit tests for the plain-text conversion and paste decision logic:

- one line break produces two adjacent non-empty paragraphs;
- two line breaks preserve one empty paragraph;
- three line breaks preserve two empty paragraphs;
- leading and trailing empty lines are retained;
- CRLF and CR input normalize to the same structure as LF;
- spaces, list characters, emoji, and Unicode text are unchanged;
- Markdown markers remain literal;
- file-containing clipboard payloads are not intercepted;
- missing or empty `text/plain` falls back to the existing handler.

Add an editor-level test, if supported by the current frontend test harness,
that pastes `first\n\nsecond` over a selection and verifies the resulting HTML
contains an empty paragraph. Existing relevant frontend and helper tests must
continue to pass.

## Acceptance criteria

- Pasting the Russian post from the reported ChatGPT code block retains every
  visible empty line in both the editor and LinkedIn preview.
- The same plain-text input produces the same paragraph structure regardless of
  LF, CRLF, or CR line endings.
- Clipboard image upload continues to behave as before.
- No Markdown interpretation or rich-text import is introduced.
