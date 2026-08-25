# Composer italic, strike, and ordered-list design

## Goal

Make the canonical composer able to preserve and create italic text,
strikethrough text, and ordered lists when the active destination supports
them, while retaining readable plain-text output on destinations that do not.

The first production acceptance target is a Telegram-only rich post. The
prepared publication must remain unpublished until this change is verified.

## Scope

- Add `italic`, `strike`, and `orderedLists` to the V2 formatting capability
  model.
- Keep the existing `lists` key as the bullet-list capability. This avoids a
  breaking rename in serialized capability data and existing integrations.
- Register capability-aware Tiptap Italic, Strike, and OrderedList extensions
  in the canonical editor schema.
- Add toolbar controls for italic, strikethrough, and ordered lists.
- Enable the native keyboard shortcuts supplied by Tiptap only when the
  corresponding capability is enabled; consume/reject disabled commands.
- Detect these formats in formatting-loss diagnostics.
- Preserve Telegram rich normalization as `<i>`, `<s>`, and `<ol>` output.
- Add focused schema, policy, toolbar, intersection, diagnostic, and Telegram
  normalization regression tests.

## Capability behavior

`italic` and `strike` use the same four support levels as existing formatting:
`native`, `unicode`, `plain`, and `unsupported`. The editor exposes their
creation controls for `native` or `unicode`, but current profiles only claim
`native` where the destination/dialect already preserves the semantics.

`orderedLists` is structural and its control is exposed only for `native`,
matching the existing `lists` and `headings` behavior.

Profile defaults follow existing dialect behavior:

- Telegram rich HTML: all three new capabilities are `native`.
- Generic HTML/Markdown adapters: all three are `native`.
- Plain/unicode social profiles: italic and strike are `plain`; ordered lists
  mirror the existing `lists` support. Bold and underline Unicode behavior is
  unchanged.
- Explicitly unsupported editors remain `unsupported`.
- Existing verified dialect profiles mirror their current closest semantic:
  italic/strike follow the dialect's native inline support, and ordered lists
  follow `lists` unless a profile already distinguishes otherwise.

## Editor schema and commands

The three extensions are always registered so existing canonical HTML can be
parsed and round-tripped even when the current destination cannot create that
format. Capability-aware wrappers reject mutation commands, input rules, paste
rules, and shortcuts when disabled, following the existing Bold, Underline,
Heading, and BulletList pattern.

Expected canonical HTML:

- italic: `<em>text</em>`
- strikethrough: `<s>text</s>`
- ordered list: `<ol><li><p>item</p></li></ol>`

The Telegram rich normalizer remains responsible for translating canonical
HTML to Telegram's accepted rich dialect (`<em>` to `<i>`, `<s>` unchanged,
and ordered-list structure preserved).

## Toolbar

Add three small controls alongside the existing inline/list controls:

- Italic (`toggleItalic`)
- Strikethrough (`toggleStrike`)
- Numbered list (`toggleOrderedList`)

Each control is rendered only when returned by `getFormattingControls`, uses
the same tooltip and focus behavior as the existing controls, and does not
introduce a new menu or editor mode.

## Compatibility and fallback

No existing capability key is renamed. Resolved capabilities are regenerated
from current profiles, so older serialized V2 snapshots continue to provide
adapter metadata while the resolver supplies the new formatting fields.

Destinations without native support normalize the canonical HTML through their
existing plain formatter. Tags must never leak into published text. A
formatting-loss warning is emitted when italic, strikethrough, or ordered-list
markup is present and the destination cannot preserve it natively or through a
declared Unicode representation.

## Verification

Follow strict red-green-refactor cycles:

1. Capability and policy tests fail because the new keys/controls do not exist.
2. Schema tests fail because commands and pasted markup are absent or changed.
3. Diagnostic tests fail because the new tags are not detected.
4. Minimal implementation makes each focused test pass.
5. Run the affected frontend/helper suites, typecheck, and the repository's
   workspace verification command.
6. Re-open the existing Telegram-only draft and manually confirm italic,
   strikethrough, and ordered-list rendering before publishing anything.

## Out of scope

- Publishing the waiting article or control post.
- Redesigning the composer toolbar.
- Adding Unicode italic/strike transformations to plain social platforms.
- Changing Telegram delivery or its existing fallback transport.
