# VK Group Photo Publishing and Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the separate VK Group integration to publish text with zero to ten ordered photographs and give Russian- and English-speaking users a safe, expandable community-key setup guide.

**Architecture:** Keep publishing inside `VkGroupProvider`: validate media before enqueue, upload and save every photo before calling `wall.post`, then post ordered `photo{owner_id}_{id}` attachments to the negative community owner ID with `from_group=1`. Extend the existing custom-field metadata with optional localized/collapsible fields so every other provider keeps its current rendering, and translate server-provided English fallback strings at the frontend boundary.

**Tech Stack:** TypeScript, NestJS integration services, React, react-hook-form/Yup, i18next, Axios streams, `form-data`, Vitest, pnpm.

## Global Constraints

- Work only in the isolated worktree created from local `prod` commit `558afee`: `.tmp/worktrees/vk-group-photo-onboarding` on `feature/vk-group-photo-onboarding`.
- Use pnpm only; run `pnpm install --frozen-lockfile` and `pnpm run verify:workspace` before tests/builds in every fresh worktree.
- Keep personal `VkProvider` behavior unchanged; do not refactor its uploader into shared code in this release.
- VK Group supports text plus zero through ten photographs; reject video, documents, stories, products, mixed/other attachments, and eleven or more photographs before enqueue.
- Never call `wall.post` until every selected photograph has uploaded and saved successfully; never fall back to a partial or text-only publication.
- Keep final `wall.post` parameters `owner_id=<negative community id>`, `from_group=1`, and preserve user-selected attachment order.
- Newly connected community tokens require exactly the documented `manage`, `wall`, and `photos` capabilities; an already-connected token without `photos` may still post text but a photo post must fail with reconnect guidance.
- Accept `vk.ru`, `vk.com`, scheme-less URLs, short names, numeric IDs, `club<ID>`, and `public<ID>`; reject foreign domains, nested paths, query-only/malformed identifiers, and unsafe input.
- Every upload target must parse as an HTTPS URL.
- Errors may name `vk-group`, the VK method/phase, a safe error class, and a published post ID, but must never include tokens, upload URLs, media URLs, multipart bodies, or full upstream payloads.
- The access key remains a password input and is never echoed after submission.
- The expandable guide is collapsed by default, complete without screenshots, and localized at least in Russian and English; Callback API and Long Poll API are explicitly unnecessary.
- Do not add the supplied VK screenshots to Git. Any later product screenshots must be newly captured or irreversibly cropped/redacted and contain no key fragment or personal data.
- Do not push, open a non-draft release path, run a production deploy, or perform the controlled real-community check without the separately supplied safe test credentials and rollout authorization.

---

## File Map

- `libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts` — backwards-compatible optional metadata for localized custom fields and a collapsible rich guide.
- `libraries/nestjs-libraries/src/integrations/social.abstract.ts` — optional media `type` carried into pre-enqueue provider validation.
- `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts` — pass media type to `checkValidity()` without changing controller/service/repository layering.
- `apps/frontend/src/components/new-launch/manage.modal.tsx` — preserve media type in `/posts/valid` input and translate provider validation fallbacks.
- `apps/frontend/src/components/launches/custom-fields-instructions.tsx` — render legacy static instructions unchanged and the new VK Group disclosure when requested.
- `apps/frontend/src/components/launches/add.provider.component.tsx` — localize custom-field labels/placeholders/errors and surface actionable connection failures.
- `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts` — normalize both VK domains, require three permissions, validate media, upload/save photos, and publish ordered attachments.
- `libraries/react-shared-libraries/src/translation/locales/en/translation.json` — English VK Group form, guide, validation, media, and reconnect copy.
- `libraries/react-shared-libraries/src/translation/locales/ru/translation.json` — Russian equivalents of the same copy.
- `apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx` — disclosure, localization contract, password field, and legacy-rendering coverage.
- `apps/frontend/src/components/launches/add.provider.analytics.spec.tsx` — actionable custom-field connection error propagation without analytics regressions.
- `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts` — normalization, permission, validity, upload, ordering, atomicity, and redaction coverage.
- `docs/devops/vk-group-photo-capability-check.md` — credential-safe controlled-check and rollout stop/go procedure; contains no token or real URL.

### Task 1: Backwards-Compatible Localized Connection UI Contract

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts`
- Modify: `apps/frontend/src/components/launches/custom-fields-instructions.tsx`
- Modify: `apps/frontend/src/components/launches/add.provider.component.tsx`
- Modify: `apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx`
- Modify: `apps/frontend/src/components/launches/add.provider.analytics.spec.tsx`

**Interfaces:**
- Consumes: existing `SocialProvider.customFields()`, `CustomFieldsInstructionsData`, `useT()`, and `submitCustomFieldConnection()`.
- Produces: optional `placeholder`, `validationMessage`, and `translationKey` on a custom field; optional `collapsible`, `summary`, `warning`, and `notRequired` instruction fields; `onFailed(message?: string)` for safe upstream messages.

- [ ] **Step 1: Write failing disclosure and backwards-compatibility tests**

Add tests that initialize i18next to `en`, render a collapsible guide, and assert it starts closed, exposes an accessible button with `aria-expanded="false"`, opens after a click in a DOM-capable test, contains all six ordered steps plus the three permissions, says Callback/Long Poll are unnecessary, and contains the secret warning. Retain the existing legacy static-guide and `undefined` tests so the union remains backwards compatible.

```tsx
const instructions = {
  collapsible: true,
  summary: 'Where to get the link and key',
  title: 'Connect a VK community',
  items: [
    'Open the community in the desktop VK website and select Management.',
    'Open More → API usage → Access keys.',
    'Select Create key.',
    'Grant only community management, community wall, and photographs access.',
    'Copy the generated community access key into Vezdepost.',
    'Copy the public community address, for example https://vk.ru/fedrbodr_pro, into the first field.',
  ],
  notRequired: 'Callback API and Long Poll API are not required.',
  warning:
    'The access key is secret. Do not send it to support, put it in screenshots, or share it with third parties.',
};

expect(renderToStaticMarkup(
  <CustomFieldsInstructions instructions={instructions} />
)).toContain('aria-expanded="false"');
```

- [ ] **Step 2: Run the UI tests and verify the new contract fails**

Run: `pnpm exec vitest run apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx apps/frontend/src/components/launches/add.provider.analytics.spec.tsx`

Expected: FAIL because the old instruction type has no disclosure fields and `submitCustomFieldConnection` discards `connectResult.msg`.

- [ ] **Step 3: Extend the provider metadata types without changing existing providers**

Use optional fields only. Keep the existing `title/items/note` shape valid.

```ts
export type CustomFieldDefinition = {
  key: string;
  label: string;
  translationKey?: string;
  placeholder?: string;
  placeholderTranslationKey?: string;
  validation: string;
  validationMessage?: string;
  validationMessageTranslationKey?: string;
  type: 'text' | 'password';
  defaultValue?: string;
  hint?: string;
};

export type CustomFieldsInstructionsDefinition = {
  title: string;
  items: string[];
  note?: string;
  collapsible?: boolean;
  summary?: string;
  notRequired?: string;
  warning?: string;
};
```

Have `SocialProvider.customFields` and `customFieldsInstructions` use those exported definitions. Mirror/import the instruction definition in the frontend rather than maintaining a divergent duplicate.

- [ ] **Step 4: Implement translated legacy/static and optional disclosure rendering**

Call `t(copy, copy)` for every server-provided string, render the legacy block when `collapsible !== true`, and use a controlled native `<button type="button">` with `aria-expanded` and `aria-controls` plus a conditionally rendered region. This gives keyboard behavior, an explicit accessibility state, and collapsed-by-default semantics. Style with existing `border-tableBorder`, `bg-sixth`, `textTextColor`, and responsive width classes only; do not introduce deprecated `--color-custom*` tokens.

```tsx
const body = (
  <div className="p-[14px] text-[14px] text-textColor">
    <p>{t(instructions.title, instructions.title)}</p>
    <ol className="mt-[8px] list-decimal space-y-[6px] ps-[20px]">
      {instructions.items.map((item) => (
        <li key={item}>{t(item, item)}</li>
      ))}
    </ol>
    {instructions.notRequired ? <p>{t(instructions.notRequired, instructions.notRequired)}</p> : null}
    {instructions.warning ? <p>{t(instructions.warning, instructions.warning)}</p> : null}
  </div>
);

return instructions.collapsible ? (
  <div className="w-full rounded-[8px] border border-tableBorder bg-sixth">
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={contentId}
      onClick={() => setExpanded((value) => !value)}
      className="w-full cursor-pointer p-[14px] text-start text-[14px] text-textColor"
    >
      {t(instructions.summary!, instructions.summary!)}
    </button>
    {expanded ? <div id={contentId}>{body}</div> : null}
  </div>
) : body;
```

- [ ] **Step 5: Localize field validation and safely surface connection errors**

Build Yup messages from `validationMessageTranslationKey`/`validationMessage` instead of appending `is invalid`. Pass `translationKey` and translated `placeholder` into `Input`. Change `onFailed` to accept an optional safe message, extract only a string `connectResult.msg`, and translate it at the component boundary; keep the generic fallback for malformed/network failures.

```ts
const validationMessage = t(
  item.validationMessageTranslationKey || item.validationMessage || 'field_is_invalid',
  item.validationMessage || 'This value is invalid.'
);

if (!connectResponse.ok) {
  onFailed(typeof connectResult.msg === 'string' ? connectResult.msg : undefined);
  return;
}
```

Do not include submitted `data`, the encoded `code`, response bodies, or token-shaped strings in UI/analytics logging.

- [ ] **Step 6: Run focused UI tests**

Run: `pnpm exec vitest run apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx apps/frontend/src/components/launches/add.provider.analytics.spec.tsx`

Expected: PASS, including legacy guide rendering and actionable safe-message propagation.

- [ ] **Step 7: Commit the UI contract**

```bash
git add libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts apps/frontend/src/components/launches/custom-fields-instructions.tsx apps/frontend/src/components/launches/add.provider.component.tsx apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx apps/frontend/src/components/launches/add.provider.analytics.spec.tsx
git commit -m "feat: add localized provider connection guides"
```

### Task 2: VK Group Identifier, Fields, Guide, and Permission Authentication

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts`
- Modify: `libraries/react-shared-libraries/src/translation/locales/en/translation.json`
- Modify: `libraries/react-shared-libraries/src/translation/locales/ru/translation.json`

**Interfaces:**
- Consumes: the optional custom-field/guide metadata from Task 1 and existing `authenticate()` string-error contract.
- Produces: normalized community identifier, exact `manage`/`wall`/`photos` connection gate, localized English fallbacks, recommended `https://vk.ru/fedrbodr_pro` placeholder, and the full disclosure payload.

- [ ] **Step 1: Expand failing normalization and authentication tests**

Add table cases for both domains and malformed variants.

```ts
it.each([
  ['https://vk.ru/fedrbodr_pro', 'fedrbodr_pro'],
  ['https://vk.com/fedrbodr_pro', 'fedrbodr_pro'],
  ['vk.ru/fedrbodr_pro', 'fedrbodr_pro'],
  ['vk.com/fedrbodr_pro', 'fedrbodr_pro'],
  ['fedrbodr_pro', 'fedrbodr_pro'],
  ['club123', '123'],
  ['public123', '123'],
  ['123', '123'],
])('normalizes %s', (input, expected) => {
  expect(normalizeVkGroupIdentifier(input)).toBe(expected);
});

it.each([
  'https://example.com/fedrbodr_pro',
  'https://vk.ru/a/b',
  'vk.com/a/b',
  'https://vk.ru/',
  'https://vk.ru/fedrbodr_pro/extra',
  'club',
  'public-1',
])('rejects %s', (input) => {
  expect(normalizeVkGroupIdentifier(input)).toBeNull();
});
```

Update credential tests so successful auth includes `{name:'photos', setting:4}` and each missing/zero `manage`, `wall`, or `photos` case returns: `The VK community key must allow community management, community wall, and photographs access. Recreate the key and reconnect VK Group.` Assert the result never contains the token or upstream payload.

- [ ] **Step 2: Run provider credential tests and verify failure**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts -t "identifier|credentials"`

Expected: FAIL for `vk.ru`, missing `photos`, the new field metadata, and full guide payload.

- [ ] **Step 3: Normalize only a single VK community path segment**

Parse any URL-looking input with an injected `https://`, accept hostnames matching `^(?:www\.)?vk\.(?:com|ru)$`, reject credentials/ports/non-root nested paths, strip an optional trailing slash, and then validate numeric/prefixed/short-name forms. Do not coerce large digit strings through `Number`; normalize a leading minus by slicing so IDs retain exact digits.

```ts
const hostPattern = /^(?:www\.)?vk\.(?:com|ru)$/i;
const prefixedId = candidate.match(/^(?:club|public)([1-9]\d*)$/i);
if (/^-?[1-9]\d*$/.test(candidate)) return candidate.replace(/^-/, '');
return /^[a-zA-Z0-9_.-]+$/.test(candidate) ? candidate : null;
```

- [ ] **Step 4: Publish the exact field and collapsible-guide metadata**

The first field uses label `VK community link`, placeholder `https://vk.ru/fedrbodr_pro`, and a specific invalid-link message; the second remains `type: 'password'` and uses `Community access key`. The guide has the exact six steps from the specification, includes only `manage`, `wall`, and `photos`, says Callback/Long Poll are not required, and includes the secret warning. Do not add screenshot paths.

- [ ] **Step 5: Require all three permissions for new connections**

Keep group ownership verification before permission acceptance. Filter enabled permission entries as today, then require:

```ts
const requiredPermissions = ['manage', 'wall', 'photos'];
if (
  permissionsPayload?.error ||
  requiredPermissions.some((name) => !permissionNames.includes(name))
) {
  return MISSING_PERMISSIONS;
}
```

Keep invalid-token, wrong-community, malformed input, and missing-permission messages as English fallback strings so API clients remain actionable; add those complete English strings as i18next keys in `en` and map them to natural Russian in `ru`.

- [ ] **Step 6: Add EN/RU copy and verify both locales**

Add translations for all field labels, placeholder/validation text, guide summary/title/steps, permission note, Callback/Long Poll statement, secret warning, invalid token, wrong community, missing permissions, photo limit, unsupported media, and photo reconnect guidance. In the UI spec switch i18next between `en` and `ru` and assert `Where to get the link and key` / `Где взять ссылку и ключ`, plus both language versions of the Callback/Long Poll sentence.

- [ ] **Step 7: Run credential and guide tests**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx`

Expected: PASS for normalization, permission enforcement, password field, collapsed/expanded copy, and both locales.

- [ ] **Step 8: Commit onboarding and authentication**

```bash
git add libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts libraries/react-shared-libraries/src/translation/locales/en/translation.json libraries/react-shared-libraries/src/translation/locales/ru/translation.json
git commit -m "feat: improve VK Group onboarding"
```

### Task 3: Pre-Enqueue VK Group Media Gate

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social.abstract.ts`
- Modify: `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts`
- Modify: `apps/frontend/src/components/new-launch/manage.modal.tsx`
- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts`

**Interfaces:**
- Consumes: media records with `path` and optional `type` from the compose request.
- Produces: `ValidityMedia.type?: 'image' | 'video' | string`; clear English fallback errors translated by Task 2; provider-level defense-in-depth validation before network calls.

- [ ] **Step 1: Write failing validity tests for the complete boundary**

Cover text-only, one image, ten images, eleven images, video in the main post, a non-image attachment type, and media on a comment. Use exact expected messages:

```ts
const tooMany = 'VK Group supports up to 10 photographs per post.';
const unsupported =
  'VK Group supports photographs only. Remove videos and other attachments.';

await expect(provider.checkValidity([[]], {}, [])).resolves.toBe(true);
await expect(provider.checkValidity([[{ path: 'one.jpg', type: 'image' }]], {}, [])).resolves.toBe(true);
await expect(provider.checkValidity([images(10)], {}, [])).resolves.toBe(true);
await expect(provider.checkValidity([images(11)], {}, [])).resolves.toBe(tooMany);
await expect(provider.checkValidity([[{ path: 'clip.mp4', type: 'video' }]], {}, [])).resolves.toBe(unsupported);
await expect(provider.checkValidity([[{ path: 'file.pdf', type: 'document' }]], {}, [])).resolves.toBe(unsupported);
await expect(provider.checkValidity([[], [{ path: 'reply.jpg', type: 'image' }]], {}, [])).resolves.toBe(unsupported);
```

- [ ] **Step 2: Run validity tests and verify failure**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts -t "validity"`

Expected: FAIL because all media is currently rejected and media type is not carried to server validation.

- [ ] **Step 3: Carry media type into `/posts/valid` and provider validation**

Add optional `type` to `ValidityMedia`. Preserve `type` when the frontend maps selected media into the validation request and when `PostsService` maps `post.value[].image` for `checkValidity`. Keep it optional for old drafts/clients; when absent, reject known video/document extensions and accept the existing image record shape.

```ts
export type ValidityMedia = {
  path: string;
  thumbnail?: string;
  type?: 'image' | 'video' | string;
};
```

- [ ] **Step 4: Implement the pre-enqueue rule and translate returned errors**

Validate only the main post for photos; comments remain text-only. Reject `type !== 'image'`, `.mp4`, and known document/archive extensions before checking count; reject more than ten. In `manage.modal.tsx`, display `t(item.errors, item.errors)` so the English fallback returned by the server becomes Russian when selected.

```ts
const [mainPost = [], ...comments] = posts || [];
if (comments.some((comment) => comment.length > 0)) return UNSUPPORTED_MEDIA;
if (mainPost.some((media) => media.type && media.type !== 'image')) return UNSUPPORTED_MEDIA;
if (mainPost.some((media) => isUnsupportedAttachmentPath(media.path))) return UNSUPPORTED_MEDIA;
if (mainPost.length > 10) return TOO_MANY_PHOTOS;
return true;
```

- [ ] **Step 5: Add defense-in-depth validation at `post()` entry**

Before any VK or media request, reject more than ten media items and every `PostDetails.media` item whose `type !== 'image'`. This is required even though `checkValidity()` normally runs first, because workers and retries must never enqueue a forbidden fallback publication.

- [ ] **Step 6: Run focused validity and post-service tests**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts`

Expected: PASS; if the repository has no `posts.service.spec.ts`, run the existing test file returned by `rg --files | rg 'posts.*service.*spec'` and record that substitution in the execution log.

- [ ] **Step 7: Commit the pre-enqueue gate**

```bash
git add libraries/nestjs-libraries/src/integrations/social.abstract.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts apps/frontend/src/components/new-launch/manage.modal.tsx libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts
git commit -m "feat: validate VK Group photo posts"
```

### Task 4: Atomic Ordered VK Group Photo Upload and Publication

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts`

**Interfaces:**
- Consumes: `PostDetails.media` containing zero to ten image items and negative `userId` for the community.
- Produces: `uploadPhoto(positiveGroupId, accessToken, media): Promise<{ownerId:string; id:string}>`; final `attachments` in selection order.

- [ ] **Step 1: Write a failing one-photo happy-path test**

Mock in this sequence: `photos.getWallUploadServer`, Axios media download stream, Axios multipart upload, `photos.saveWallPhoto`, `wall.post`. Assert:

```ts
expect(getUploadBody.get('group_id')).toBe('123');
expect(saveBody.get('group_id')).toBe('123');
expect(wallBody.get('owner_id')).toBe('-123');
expect(wallBody.get('from_group')).toBe('1');
expect(wallBody.get('attachments')).toBe('photo-123_456');
```

Also assert the access token is only in VK API request bodies, not URLs, and the upload/media URLs are absent from thrown/serialized errors.

- [ ] **Step 2: Write failing ten-photo ordering and atomicity tests**

Resolve upload promises out of order, return distinct `{owner_id,id}` values, and assert `attachments` follows the input order. For each phase failure—upload-server envelope, unsafe/malformed URL, media download, multipart upload, malformed upload fields, save envelope, non-array save response, missing/invalid `owner_id`, and missing/invalid photo `id`—assert rejection and `wall.post` call count zero. Include error-code 5 classification and an ordinary VK error without copying `error_msg`.

- [ ] **Step 3: Run photo tests and verify failure**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts -t "photo|ordering|redact|partial"`

Expected: FAIL because `VkGroupProvider.post()` currently calls only `wall.post`.

- [ ] **Step 4: Add sanitized VK envelope and identifier parsers inside `VkGroupProvider`**

Keep these helpers private to avoid changing personal VK. `unwrapGroupResponse` includes only the VK method and numeric error code, maps code 5 to existing `RefreshToken` behavior with identifier `vk-group`, and maps all other malformed/error envelopes to `BadBody`. Add positive and signed-nonzero decimal parsers that preserve strings and never serialize upstream payloads.

```ts
private unwrapGroupResponse<T>(payload: unknown, method: string): T;
private parsePositiveId(value: unknown, method: string, field: string): string;
private parseSignedId(value: unknown, method: string, field: string): string;
private parseHttpsUploadUrl(value: unknown): string;
```

`parseHttpsUploadUrl` must accept only `new URL(value).protocol === 'https:'`; reject HTTP, credentials, empty strings, and malformed values with `VK photos.getWallUploadServer returned an invalid HTTPS upload URL`.

- [ ] **Step 5: Implement one-photo upload/save without logging private URLs**

Use `callVk('photos.getWallUploadServer', accessToken, {group_id: positiveGroupId})`, Axios `get(media.path, {responseType:'stream'})`, `form-data` with filename derived only for multipart metadata, Axios `post(uploadUrl, formData, {headers: formData.getHeaders()})`, and `callVk('photos.saveWallPhoto', accessToken, {group_id, photo, server, hash})`. Validate upload `photo`, `server`, `hash` and saved array element `owner_id`/`id` before returning.

Every catch must create a fresh safe message naming only the phase, for example `VK Group media download failed` or `VK Group photo upload failed`; never interpolate caught error messages or either URL.

- [ ] **Step 6: Upload all photos before `wall.post` and preserve order**

Use `Promise.all(firstPost.media.map(...))`; it permits concurrency while preserving result index order. Only after it resolves, call:

```ts
const wallPostResult = await this.callVk('wall.post', accessToken, {
  owner_id: userId,
  from_group: '1',
  message: firstPost.message,
  ...(photos.length
    ? { attachments: photos.map(({ ownerId, id }) => `photo${ownerId}_${id}`).join(',') }
    : {}),
});
```

Keep the existing verified `post_id`, response shape, release URL, and text-only no-attachments behavior.

- [ ] **Step 7: Add old-token reconnect guidance for photo failures**

When a VK photo method returns the permissions/access-denied code used by mocked coverage, throw a safe `BadBody`/existing classified error whose message is: `VK Group photo access is missing. Recreate the community key with photographs access and reconnect VK Group.` Do not apply this path to text-only `wall.post`, and do not substitute a personal token.

- [ ] **Step 8: Run VK provider regression tests**

Run: `pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts libraries/nestjs-libraries/src/integrations/social/vk.provider.spec.ts libraries/nestjs-libraries/src/integrations/social/vk.response.spec.ts`

Expected: PASS for text-only, one photo, ten ordered photos, all failure/redaction cases, and unchanged personal VK behavior.

- [ ] **Step 9: Commit atomic photo publishing**

```bash
git add libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts
git commit -m "feat: publish VK Group photo posts"
```

### Task 5: Controlled Capability Gate and Release Verification

**Files:**
- Create: `docs/devops/vk-group-photo-capability-check.md`
- Test: all files changed in Tasks 1–4

**Interfaces:**
- Consumes: a newly created token for a dedicated non-production-impact community with only `manage`, `wall`, and `photos` permissions, supplied out of band at execution time.
- Produces: a credential-free method/error-code result and an explicit rollout stop/go decision; no production deploy.

- [ ] **Step 1: Write the credential-safe controlled-check runbook**

Document prerequisites, commands/API phases, expected result, cleanup, and this decision table:

| Result | Action |
|---|---|
| Upload-server request and wall-photo save both succeed | Record date, VK API version `5.251`, method names, safe test post ID, and `GO` for later rollout approval. |
| Either method fails | Record only method name and VK numeric error code, mark `STOP`, do not broaden permissions, do not use a personal token, do not call `wall.post`, and do not deploy. |

The runbook must explicitly forbid placing tokens, upload URLs, media URLs, multipart bodies, upstream payloads, screenshots, owner names, or personal data in shell history, captured output, Git, or support messages.

- [ ] **Step 2: Run workspace preflight and focused tests**

Run:

```bash
pnpm run verify:workspace
pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts libraries/nestjs-libraries/src/integrations/social/vk.provider.spec.ts libraries/nestjs-libraries/src/integrations/social/vk.response.spec.ts apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx apps/frontend/src/components/launches/add.provider.analytics.spec.tsx
```

Expected: workspace artifacts ready; all focused tests pass with zero failures.

- [ ] **Step 3: Run canonical tests and all application builds**

Run:

```bash
pnpm test
pnpm run build:backend
pnpm run build:orchestrator
pnpm run build:frontend
```

Expected: canonical suite passes and each build exits 0. Record the existing Node engine warning separately; execute with the project-required Node `>=22.12.0 <23.0.0` if build behavior differs under Node 23.

- [ ] **Step 4: Verify repository hygiene and diff scope**

Run:

```bash
git status --short
git diff --check prod...HEAD
git diff --stat prod...HEAD
git ls-files | rg -i 'vk.*\.(png|jpe?g|webp)$'
```

Expected: no whitespace errors, no `.tmp/` contents, no original/reference VK screenshots, no secrets, and only the planned code/tests/translations/runbook changes.

- [ ] **Step 5: Pause for controlled-check credentials and authorization**

Do not improvise this step. Ask for a newly generated dedicated community token and explicit authorization to perform the external check. Never request the user to paste the token into chat, a committed file, or a screenshot; use an approved secret/environment mechanism. This pause is not authorization to push or deploy.

- [ ] **Step 6: Perform the real-community stop/go check only after approval**

Using a disposable photo and the approved secret mechanism, call only the upload-server, upload, and save-photo phases first. If either VK method rejects the community token, record its method/error code, remove the test artifact where possible, mark `STOP`, and end without `wall.post`. If both succeed, publish one controlled community-wall photo post, verify it appears on the selected community wall and is authored by the community, then delete the test post/photo where the approved procedure permits.

- [ ] **Step 7: Record health-check expectations without deploying**

Add to the execution notes the later production checks: integration list loads, VK Group modal works on desktop/mobile in RU/EN, text-only post succeeds, one-photo post succeeds, forbidden media is rejected before enqueue, worker error logs contain no secrets/private URLs, and queue/worker health remains normal. State explicitly that production deploy requires a separate confirmation.

- [ ] **Step 8: Commit the runbook**

```bash
git add docs/devops/vk-group-photo-capability-check.md
git commit -m "docs: add VK Group photo rollout gate"
```

## Plan Self-Review

- Spec coverage: normalization, exact three-permission authentication, old-token text-only compatibility, one/ten/eleven media boundaries, unsupported media before enqueue, ordered atomic upload/save/post, response validation, HTTPS enforcement, redaction, RU/EN disclosure, personal VK regression, controlled capability gate, builds, and production health expectations are each assigned to a task.
- Placeholder scan: no placeholder markers, deferred implementation instruction, unspecified error handling, or screenshot dependency remains.
- Type consistency: `CustomFieldsInstructionsDefinition`, custom-field optional localization metadata, `ValidityMedia.type`, `uploadPhoto()` result `{ownerId,id}`, and `attachments` formatting are consistent across producer/consumer tasks.
- Non-goals retained: no VK Group video/doc/story/product support, no Callback/Long Poll setup, no personal VK uploader refactor, no reference screenshot commit, no push, and no production deploy.
