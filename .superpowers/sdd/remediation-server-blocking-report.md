# Remediation 3: server-side shared content blocking

## Result

`PostsController.createPost()` now rejects non-draft posts when validation returns a non-empty `contentError`. The existing draft policy is unchanged, and the check runs before the legacy too-long check. The exact provider identifier, provider name, and shared error text are passed through `PostValidationException`.

## TDD evidence

- RED: `pnpm exec vitest run apps/backend/src/api/routes/posts.controller.spec.ts --reporter=verbose`
  - 1 test failed as expected: the invalid non-draft request resolved instead of rejecting.
  - The draft and clean non-draft cases passed.
- GREEN: the same controller spec passed after adding the controller gate.

## Checks

- `pnpm exec vitest run apps/backend/src/api/routes/posts.controller.spec.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts --reporter=verbose`
  - 2 test files passed, 10 tests passed.
- `pnpm exec prettier --write apps/backend/src/api/routes/posts.controller.ts apps/backend/src/api/routes/posts.controller.spec.ts`
  - Completed successfully.
- `pnpm --filter ./apps/backend run build`
  - Passed. pnpm emitted the existing Node engine warning (`v23.7.0`; project requests `>=22.12.0 <23.0.0`).
- `git diff --check`
  - Passed.
- Final verification re-ran Prettier in check mode. It exposed an existing
  controller signature reflow that had been restored after formatting; the
  controller is now kept in Prettier's canonical form and the format check
  passes.

## Files

- `apps/backend/src/api/routes/posts.controller.ts`: enforce non-empty `contentError` for non-drafts.
- `apps/backend/src/api/routes/posts.controller.spec.ts`: controller regression coverage for non-draft rejection, draft continuation, and clean non-draft continuation.

## Concerns

- The build environment is running Node 23.7.0 despite the repository engine constraint. The backend build still passed.
- No public API or service behavior was changed.
