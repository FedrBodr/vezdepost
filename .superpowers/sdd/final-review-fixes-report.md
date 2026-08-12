# Final whole-branch review fixes

## Status

Implemented and locally verified on `feature/vk-group-photo-onboarding`. No VK
request, push, deployment, or other external mutation was performed. The
controlled capability gate remains `Pending authorized execution`.

## Implementation

- The capability runner now authenticates the injected credential before every
  photo side effect:
  1. `groups.getById` with `group_ids=<requested positive ID>`;
  2. token-owned `groups.getById` without `group_ids`;
  3. `groups.getTokenPermissions` with enabled `manage`, `wall`, and `photos`.
- Runner group arrays, exact positive IDs, permission arrays, names, and
  settings are structurally validated. Personal tokens, wrong-community
  tokens, missing/disabled permissions, malformed envelopes, and VK/transport
  failures stop before `photos.*`, upload, publication, or cleanup.
- Runner evidence remains restricted to fixed phases/methods, numeric VK codes
  when supplied, status decisions, and already verified success post IDs. It
  does not emit either group ID, the token, permission payloads, URLs, or raw
  responses.
- Existing VK Group photo publications call
  `groups.getTokenPermissions` exactly once before the first upload-server
  request. Only exact enabled `photos` access is required for this legacy
  publication check; text-only posts do not call the permission method.
- Missing/disabled `photos` access throws the existing exact
  `PHOTO_ACCESS_MISSING` guidance. Permission VK envelopes, error 5, ordinary
  denials, transport failures, JSON failures, and malformed structures use the
  sanitized `vk-group` error path without falling back to text.
- Multipart upload sets Axios `maxRedirects: 0`. Redirect/downgrade failures are
  sanitized and cannot reach `photos.saveWallPhoto` or `wall.post`.
- `photos.saveWallPhoto` must return an array of exactly one object before its
  owner/photo IDs are accepted.
- `wall.createComment` now uses the same sanitized group-specific transport,
  VK-envelope, error-code, and ID parsing path as publication. Request shape,
  `from_group`, no-attachment behavior, and response shape are unchanged.
- The runbook now documents credential proof as phases 1–3, the resulting
  phase order, fail-closed decisions, and the restricted evidence record.

## Media type retention audit

No additional production gap was found, so no DTO or persistence behavior was
broadened:

- `PostsService.mapTypeToPost` spreads the incoming post and uses transformation
  without whitelist/extraneous-value stripping.
- `PostsRepository.createOrUpdatePost` persists the complete `value.image`
  value with `JSON.stringify(value.image)`.
- The orchestrator parses that stored JSON and passes it to
  `PostsService.updateMedia`.
- `updateMedia` spreads each media value and retains `m.type`; it infers a type
  only for legacy media where `type` is missing.
- Existing service regressions prove compose validation receives the media
  type, stored-media lookup retains it, explicit video is not converted as an
  image, and only missing legacy types are inferred.

## TDD evidence

Baseline before the review tests:

- `vitest` provider + runner: 2 files, 158 tests passed.

RED after adding the review regressions and before production changes:

- 25 expected failures across runner authorization, publication permission
  gating, upload redirect blocking, save cardinality, and comment sanitization;
  157 existing tests still passed.
- One eager rejected-promise table fixture also produced an unhandled rejection;
  the fixture was corrected to construct the rejection inside its test before
  implementation continued.

GREEN after the minimal implementation and fixture updates:

- provider + runner: 2 files, 182 tests passed.
- focused VK/media/UI/hygiene matrix: 8 files, 287 tests passed.

## Verification

All commands used Node `22.20.0` where applicable.

- `pnpm run verify:workspace`: passed.
- Focused provider, runner, hygiene, UI, response, personal-VK, and media-path
  tests: 287 passed, 0 failed.
- Canonical `pnpm test`: 508 passed, 0 failures, 0 errors (JUnit record).
- `pnpm run build:backend`: passed.
- `pnpm run build:orchestrator`: passed.
- `pnpm run build:frontend`: passed, including production compile and
  TypeScript.
- `node --check` for both changed runner JavaScript files: passed.
- Prettier write/check for all changed implementation, test, and runbook files:
  passed.
- `git diff --check`: passed before commit.

## Files

- `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts`
- `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts`
- `scripts/vk-group-photo-capability-check.mjs`
- `scripts/vk-group-photo-capability-check.spec.mjs`
- `docs/devops/vk-group-photo-capability-check.md`
- `.superpowers/sdd/final-review-fixes-report.md`

## Self-review

- Photo permission validation deliberately requires only `photos` during
  publication so existing text-only integrations remain compatible and legacy
  photo publication follows the approved spec. New connection authentication
  and the controlled runner still require `manage`, `wall`, and `photos`.
- Authorization failures create no remote artifact, so the runner does not
  invoke cleanup after them.
- Redirect protection is applied to the credential-adjacent multipart upload;
  the runner's Fetch path remains `redirect: 'error'`.
- No upstream exception object, response payload, redirect location, media URL,
  upload URL, or token is serialized into provider or runner errors.

## Remaining concern

The real-community capability result is intentionally still pending. An
authorized operator must later execute the secret-aware runner against the
named disposable community; this work neither authorizes nor performs that
external check.
