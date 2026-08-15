# Remediation 5: transport-level raw URL stripping

## Outcome

- Added the required `delivery.stripRawUrls` capability with a false default for every verified profile, legacy fallback, and empty/universal intersection.
- Derived the fallback capability from `provider.stripLinks?.()` and overlaid an explicit true value even for a future verified provider that strips raw URLs.
- Added the nonblocking `raw-url-removed` shared diagnostic when content contains an HTTP(S) URL, using the same URL detector as the existing transport removal and short-link flow.
- Kept `formatting.links`, the X provider transport, the separate account `stripLinks` metadata, and short-link filtering unchanged. Existing `PlatformContentNotice` renders the warning without custom UI.

## TDD evidence

RED command:

```text
pnpm exec vitest run platform.capabilities platform.content integration.manager platform.content.notice posts.service
```

RED result: 5 files ran; 8 tests failed and 40 passed. Failures were the expected missing `stripRawUrls` contract/default/intersection, missing X fallback/verified overlay, missing shared warning, and missing PostsService propagation. The existing notice rendering test passed because it exercises the generic warning UI.

GREEN result for the same focused command: 5 files and 48/48 tests passed.

## Final verification

- Adjacent capability/content/formatting/manager/editor/notice/information/PostsService suites: 9 files, 97/97 tests passed.
- Frontend ES2022 typecheck under Node 22.20.0: exit 0.
- Backend production build under Node 22.20.0: exit 0.
- Orchestrator production build under Node 22.20.0: exit 0.
- Workspace bootstrap verification: exit 0.
- Prettier and `git diff --check`: exit 0.

## Files

- `libraries/helpers/src/utils/platform.capabilities.ts` and spec
- `libraries/helpers/src/utils/platform.content.ts` and spec
- `libraries/nestjs-libraries/src/integrations/integration.manager.ts` and spec
- `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts`
- `apps/frontend/src/components/new-launch/platform.content.notice.spec.tsx`

## Concerns

None identified. URL matching intentionally stays aligned with `strip.links.ts`; no provider publication or short-link code was changed.
