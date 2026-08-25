# Composer italic, strike, and ordered-list implementation plan

**Goal:** Add capability-aware italic, strikethrough, and ordered-list editing
without leaking unsupported markup to destination payloads.

**Architecture:** Extend the shared V2 formatting matrix, derive a semantic
editor policy from it, and register always-present but command-gated Tiptap
extensions. The toolbar consumes the same policy-derived control list, while
existing destination normalizers remain the final platform-aware fallback.

**Tech stack:** TypeScript, React, Tiptap 3, Vitest, Testing Library, PNPM.

---

## Task 1: Extend the capability contract

**Files:**

- Modify: `libraries/helpers/src/utils/platform.capability.types.ts`
- Modify: `libraries/helpers/src/utils/platform.capability.profiles.ts`
- Modify: `libraries/helpers/src/utils/platform.capability.resolver.ts`
- Test: `libraries/helpers/src/utils/platform.capability.resolver.spec.ts`

1. Add failing assertions that Telegram and native adapters expose
   `italic`, `strike`, and `orderedLists`, while plain and unsupported
   adapters degrade them conservatively.
2. Run the focused resolver test and confirm it fails because the keys are
   absent.
3. Add the new required capability keys and update every formatting literal.
   Keep `lists` unchanged as the bullet-list capability.
4. Re-run the focused test and the resolver suite.

## Task 2: Extend semantic policy and control intersection

**Files:**

- Modify: `apps/frontend/src/components/new-launch/platform.editor.semantic-policy.ts`
- Modify: `apps/frontend/src/components/new-launch/platform.editor.capabilities.ts`
- Test: `apps/frontend/src/components/new-launch/platform.editor.capabilities.spec.ts`
- Test: `apps/frontend/src/components/new-launch/platform.editor.extensions.spec.ts`

1. Add failing tests for Telegram controls, plain-profile hiding, native/global
   intersection, and creation-policy keys.
2. Run the two focused specs and confirm the expected assertion/type failures.
3. Add `italic`, `strike`, and `orderedList` policy fields plus
   `italic`, `strike`, and `ordered-list` toolbar-control identifiers.
4. Extend default and intersection formatting for all three capability keys.
5. Re-run the two focused specs.

## Task 3: Register capability-aware Tiptap extensions

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/frontend/src/components/new-launch/platform.editor.extensions.ts`
- Modify: `apps/frontend/src/components/new-launch/editor.tsx`
- Test: `apps/frontend/src/components/new-launch/editor.schema.spec.tsx`

1. Add failing schema tests for native `setItalic`, `setStrike`, and
   `toggleOrderedList`; disabled command rejection; disabled shortcut
   consumption; and canonical round-tripping of `<em>`, `<s>`, and `<ol>`.
2. Run the focused schema spec and confirm failures are caused by absent
   commands/schema nodes.
3. Add direct Tiptap Italic and Strike dependencies and import OrderedList from
   the existing list package.
4. Implement capability-aware wrappers, including command, shortcut,
   input-rule, and paste-rule gating.
5. Thread the new capability fields through `OnlyEditor` memoization.
6. Re-run the focused schema spec.

## Task 4: Add toolbar controls

**Files:**

- Create: `apps/frontend/src/components/new-launch/italic.text.tsx`
- Create: `apps/frontend/src/components/new-launch/strike.text.tsx`
- Create: `apps/frontend/src/components/new-launch/ordered-list.component.tsx`
- Modify: `apps/frontend/src/components/new-launch/editor.tsx`
- Test: `apps/frontend/src/components/new-launch/editor.schema.spec.tsx`

1. Add a failing rendering test that the Telegram toolbar contains all three
   controls and a plain profile does not.
2. Add the three minimal controls, following existing toolbar sizing,
   tooltips, command calls, and editor focus behavior.
3. Re-run the focused schema spec.

## Task 5: Detect formatting loss and verify Telegram output

**Files:**

- Modify: `libraries/helpers/src/utils/platform.content.analysis.ts`
- Test: `libraries/helpers/src/utils/platform.content.analysis.spec.ts`
- Test: `libraries/helpers/src/utils/platform.content.normalizers.spec.ts`

1. Add failing diagnostics tests for `<em>/<i>`, `<s>/<del>`, and `<ol>` on a
   plain destination, plus a no-warning Telegram test.
2. Extend formatting-tag detection with distinct new capability keys and split
   bullet-list versus ordered-list detection.
3. Extend the existing Telegram rich-normalization regression to assert an
   ordered list alongside italic and strikethrough.
4. Run both focused helper specs.

## Task 6: Verify the complete change

1. Run the affected specs together:

   `pnpm exec vitest run libraries/helpers/src/utils/platform.capability.resolver.spec.ts libraries/helpers/src/utils/platform.content.analysis.spec.ts libraries/helpers/src/utils/platform.content.normalizers.spec.ts apps/frontend/src/components/new-launch/platform.editor.capabilities.spec.ts apps/frontend/src/components/new-launch/platform.editor.extensions.spec.ts apps/frontend/src/components/new-launch/editor.schema.spec.tsx`

2. Run `pnpm run verify:workspace`.
3. Run the relevant TypeScript/frontend check available in the workspace.
4. Run `git diff --check` and inspect the final diff for unrelated changes.
5. Open the existing Telegram-only draft, confirm the three controls and rich
   round-trip manually, and leave the post unpublished for explicit user
   confirmation.
