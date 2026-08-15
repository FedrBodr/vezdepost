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
