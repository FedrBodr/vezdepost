# Remediation 4: global editor targets and canonical schema

## Result

- Added one pure `deriveGlobalTargets()` policy: selected integrations whose IDs are absent from the Zustand `internal` override list.
- Applied that target set to global capability intersection, analysis/notices, counters, and preview context selection.
- Preserved the global source when every selected destination has an internal copy and replaced the misleading destination preview with a neutral state.
- Kept the canonical TipTap parser schema mounted across profiles while independently gating toolbar controls, autolink/link-on-paste/paste rules, structural input rules, and keyboard shortcuts.
- Made repeated notice keys unique and stable across reordering.

## Root cause

- Global consumers read `selectedIntegrations` directly even though an entry in `state.internal` means that destination no longer consumes the global content.
- Link and Heading extension presence encoded both parser capability and authoring capability. Plain profiles therefore dropped canonical markup, while always-mounted list nodes retained their creation shortcuts and input rules.
- Notice keys omitted message text and occurrence identity, so multiple messages with the same platform, severity, and code reconciled under one key.

## TDD evidence

Initial RED command:

```text
pnpm exec vitest run platform.editor.capabilities editor.schema information.component show.all.providers platform.content.notice
```

- 5 files failed; 8 tests failed and 9 passed.
- Pinterest still imposed the 500-character/media constraints after override.
- Global preview still chose the overridden first integration and rendered a destination when no global targets remained.
- Plain-profile parsing changed `<h2><a>...</a></h2>` to a paragraph, and `Mod-Shift-8` still created a list.
- Overridden Pinterest remained in universal counters, and repeated notice nodes lost stable identity.

Two follow-up RED cases found during self/code review:

- A source-only global editor still emitted a formatting-loss notice with zero destination consumers: 1/4 editor tests failed.
- Unsupported native `Mod-b` and `Mod-u` events were not consumed (`defaultPrevented=false`): 2/7 editor tests failed.

GREEN after each minimal fix:

- Primary remediation suite: 5 files, 22 tests passed.
- Final editor/schema suite: 7 tests passed, including canonical markup preservation, disabled and enabled creation paths, Unicode bold/underline, native shortcut blocking, and no-target diagnostics.

## Final checks

- Focused and adjacent platform/editor/notice/preview suites:
  - 12 files, 95 tests passed.
- Frontend ES2022 typecheck:
  - `pnpm --use-node-version=22.20.0 exec tsc --noEmit -p apps/frontend/tsconfig.json --target es2022 --incremental false`
  - Exit 0.
- Prettier check across all changed TypeScript/TSX files:
  - All matched files use Prettier code style.
- `git diff --check`:
  - Exit 0.
- `pnpm run verify:workspace` ran before tests and confirmed lifecycle artifacts were ready.
- Independent review found and verified the native shortcut issue above; follow-up review approved the corrected implementation with no remaining findings.

## Files

- `apps/frontend/src/components/new-launch/global.targets.ts`
  - Shared pure target derivation from selected integration IDs and internal override IDs.
- `apps/frontend/src/components/new-launch/platform.editor.capabilities.ts`
  - Intersects only global targets while preserving exact specific-channel capability lookup.
- `apps/frontend/src/components/new-launch/platform.editor.extensions.ts`
  - Builds the canonical schema and separates profile-specific creation hooks.
- `apps/frontend/src/components/new-launch/editor.tsx`
  - Supplies global targets to analysis, retains neutral source-only analysis, and remounts only when creation policy changes.
- `apps/frontend/src/components/launches/information.component.tsx`
  - Shows only actual global consumers in universal counters/diagnostics.
- `apps/frontend/src/components/new-launch/providers/show.all.providers.tsx`
  - Previews the first actual global target or the neutral no-target state.
- `apps/frontend/src/components/new-launch/platform.content.notice.tsx`
  - Uses message identity plus occurrence for stable unique keys.
- Five focused spec files cover capabilities/store semantics, rendered editor behavior, counters, preview, source preservation, and notice reconciliation.

## Self-review

- Parser support remains broader than authoring support: Bold, Underline, Link, Heading, BulletList, and ListItem always parse canonical content.
- Unsupported/plain authoring cannot create hidden structure through the toolbar, autolink, link paste rules, heading/list input rules, or keyboard shortcuts. Unsupported browser-native bold/underline shortcuts are explicitly consumed; Unicode-supported profiles retain them.
- Specific-channel content and capabilities still come from the exact selected integration and its internal copy.
- No normalization, sanitizer, `stripLinks`, server validation, or publication logic changed.
- Global content is never removed when all selected destinations become internal.

## Concerns

- No remaining remediation-specific concerns.

## Final-review follow-up

### Result

- Universal diagnostics now retain an optional exact target integration ID in addition to the readable provider identifier. The editor supplies aligned IDs for its derived global targets, notice actions pass the exact ID, and customization resolves by `integration.id`.
- Notice keys include the exact target ID, so identical messages from two accounts on the same provider retain stable identities.
- The canonical TipTap schema remains mounted, while unsupported Bold, Underline, Link, Heading, and BulletList command APIs now return `false` without mutating content. Unicode-capable bold/underline commands and native rich-profile commands remain enabled.
- Global preview copy now distinguishes zero selected channels from the separate state where all selected channels use customized content.

### Root cause

- Selected-content analysis carried only a provider identifier, which is not unique when multiple accounts use the same provider. The customization callback consequently found the first provider match, even if a different account still consumed global content.
- Capability gating covered toolbar controls, rules, autolink, and keyboard shortcuts, but inherited TipTap `addCommands()` registrations remained callable.
- Both zero selected integrations and all-selected integrations overridden produce an empty `globalTargets` array, but the preview rendered one shared message for those distinct states.

### TDD evidence

Exact-target RED:

- The initial three-file run had four failures: aligned target IDs were absent, notice actions still passed the provider identifier, exact-target keys did not survive reordering, and the first EditorWrapper run exposed an unrelated missing visual-component mock.
- After correcting that harness mock, the duplicate-provider EditorWrapper regression still failed functionally: clicking the remaining global account's warning did not call `addRemoveInternal('pinterest-second')` because the callback selected the already-internal first Pinterest account.

Exact-target GREEN:

- `libraries/helpers/src/utils/platform.content.spec.ts`, `platform.content.notice.spec.tsx`, and `editor.schema.spec.tsx`: 3 files, 34 tests passed.

Command-gate RED:

- `editor.schema.spec.tsx`: all 12 unsupported direct-command cases returned `true` before the fix (`set`/`toggle`/`unset` marks, Link, Heading, and BulletList). One additional assertion exposed only TipTap's canonical nested-mark ordering and was corrected without changing behavior.

Command-gate GREEN:

- `editor.schema.spec.tsx`: 24 tests passed, including false/no-mutation checks for every requested hidden command, parsed-mark preservation, direct Unicode bold/underline commands, and allowed native link/heading/list commands.

Empty-copy RED/GREEN:

- Before the copy branch, `show.all.providers.spec.tsx` had 1 failed and 2 passed tests because zero selected channels rendered “All selected channels use customized content.”
- After separating the states, all 3 preview tests passed and the global source remained intact.

### Final checks

- Reconstructed 12-suite adjacent regression command from the coordinator: 12 files, 111 tests passed.
- Frontend ES2022 typecheck: `pnpm --use-node-version=22.20.0 exec tsc --noEmit -p apps/frontend/tsconfig.json --target es2022 --incremental false` exited 0.
- Prettier check across all changed TypeScript/TSX files passed.
- `git diff --check` exited 0.
- `pnpm run verify:workspace` exited 0 and confirmed workspace lifecycle artifacts are ready.
- Independent follow-up review reported no Critical, Important, or Minor findings.

### Follow-up files

- `libraries/helpers/src/utils/platform.content.ts` and `.spec.ts`: optional aligned target IDs on selected analyses.
- `apps/frontend/src/components/new-launch/editor.tsx` and `editor.schema.spec.tsx`: exact-ID customization plus rendered duplicate-account and direct-command regressions.
- `apps/frontend/src/components/new-launch/platform.content.notice.tsx` and `.spec.tsx`: exact-ID actions and keys while preserving provider labels.
- `apps/frontend/src/components/new-launch/platform.editor.extensions.ts`: capability-aware wrappers for inherited TipTap commands.
- `apps/frontend/src/components/new-launch/providers/show.all.providers.tsx` and `.spec.tsx`: distinct zero-selection copy.

### Follow-up self-review

- Exact account identity is carried separately from the provider label and is derived from the same ordered `globalTargets` list as the matching capability profiles.
- Unsupported profiles keep every canonical parsing extension; only authoring entry points are rejected. Allowed Unicode and native policies delegate to the original TipTap parent commands.
- No normalization, publication, sanitizer, server-validation, or unrelated store behavior changed.

### Follow-up concerns

- No remaining follow-up-specific concerns.
