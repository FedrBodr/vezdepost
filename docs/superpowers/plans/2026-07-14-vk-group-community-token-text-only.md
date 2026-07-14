Project: postiz-app
Document: implementation-plan

# VK Group Community Token (Text-Only) Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use `executing-plans` to implement
> this plan task-by-task. Use `test-driven-development` for every behavior
> change and `verification-before-completion` before claiming success.

**Goal:** Replace the broken VK ID OAuth group picker with a direct two-field
connection using a VK community link/name and community access token, then
publish text-only posts and comments as that community.

**Architecture:** `VkGroupProvider` becomes an independent
`SocialAbstract`/`SocialProvider` direct-credential provider. Authentication
normalizes the requested group, verifies the token against VK, checks that the
token belongs to that group and has `manage` plus `wall`, and stores the
negative group id as the channel identity. A small optional metadata contract
adds provider-specific instructions to the existing custom-fields modal.
Scheduling rejects all media before enqueueing, and publishing sends the token
in POST form data rather than URLs.

**Tech Stack:** TypeScript, NestJS shared libraries, React/Next.js, React Hook
Form, Vitest, VK API v5.251.

**Approved spec:**
`docs/superpowers/specs/2026-07-14-vk-group-community-token-design.md`

---

## Task 1: Direct community-token authentication

**Files:**

- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts`
- Create: `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts`

### Step 1: Write failing normalization and credential tests

Create a Vitest suite that imports `VkGroupProvider` and an exported
`normalizeVkGroupIdentifier` helper. Cover these inputs:

```ts
it.each([
  ['https://vk.com/fedrbodr_pro', 'fedrbodr_pro'],
  ['vk.com/fedrbodr_pro', 'fedrbodr_pro'],
  ['fedrbodr_pro', 'fedrbodr_pro'],
  ['club123', '123'],
  ['public123', '123'],
  ['123', '123'],
  ['-123', '123'],
])('normalizes %s', (input, expected) => {
  expect(normalizeVkGroupIdentifier(input)).toBe(expected);
});

it.each(['', 'https://example.com/group', 'vk.com/a/b'])(
  'rejects invalid group value %s',
  (input) => expect(normalizeVkGroupIdentifier(input)).toBeNull()
);
```

Mock the provider's inherited `fetch` method and add authentication tests for:

- successful resolution returning `id: '-123'`, the community name/picture,
  and the original token;
- malformed group input;
- invalid token/VK error;
- a token whose own group id differs from the requested group;
- missing `manage` or `wall` permission;
- every returned error string omitting the supplied secret token.

The success mock sequence is:

1. `groups.getById` with `group_ids` resolves the requested public community;
2. `groups.getById` without `group_ids` resolves the token's own community;
3. `groups.getTokenPermissions` returns permissions named `manage` and `wall`.

Also assert that `customFields()` returns a text `group` field and password
`accessToken` field, `isBetweenSteps` is false, and scopes are empty.

### Step 2: Run the focused test and confirm RED

Run:

```bash
pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts
```

Expected: FAIL because the direct-connect fields and normalization helper do
not exist and the current provider still uses OAuth.

### Step 3: Replace OAuth inheritance with direct authentication

Rewrite `VkGroupProvider` to extend `SocialAbstract` and implement
`SocialProvider`. Keep these stable public properties:

```ts
identifier = 'vk-group';
name = 'VK Group';
isBetweenSteps = false;
editor = 'normal' as const;
scopes = [] as string[];

maxLength() {
  return 16384;
}
```

Export a pure normalizer. URL input must use only `vk.com`/`www.vk.com`, allow
one path segment, ignore a trailing slash/query, convert `club123`, `public123`
and signed numeric ids to positive ids, and otherwise return a safe short name
matching `/^[a-zA-Z0-9_.-]+$/`.

Declare the fields:

```ts
async customFields() {
  return [
    {
      key: 'group',
      label: 'VK community link or short name',
      validation: '/^.{1,255}$/',
      type: 'text' as const,
    },
    {
      key: 'accessToken',
      label: 'Community access token',
      validation: '/^.{10,}$/',
      type: 'password' as const,
    },
  ];
}
```

Implement the state-only custom-credentials methods with `makeId` and a
permanent refresh shape. Decode `params.code` from base64 JSON and validate
that both decoded values are strings before any VK call.

Add a private VK caller that always uses a POST body:

```ts
private async callVk(
  method: string,
  accessToken: string,
  params: Record<string, string> = {}
) {
  const body = new FormData();
  body.append('access_token', accessToken);
  body.append('v', '5.251');
  Object.entries(params).forEach(([key, value]) => body.append(key, value));

  return (
    await this.fetch(`https://api.vk.com/method/${method}`, {
      method: 'POST',
      body,
    })
  ).json();
}
```

Do not interpolate tokens into URLs, exceptions, or log calls. Support both VK
group response shapes (`response.groups[0]` and `response[0]`). Return only
these stable authentication errors:

```text
Enter a valid VK community link or short name.
The VK community token is invalid.
This token belongs to a different VK community.
The VK community token must allow community management and wall access.
```

On success return:

```ts
{
  id: String(-Math.abs(Number(group.id))),
  name: group.name,
  accessToken,
  refreshToken: '',
  expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
  picture: group.photo_200 || '',
  username: group.screen_name || '',
}
```

Remove `pages`, `fetchPageInformation`, `reConnect`, OAuth scopes, transient
`g_` identity logic and all media-upload imports/methods.

### Step 4: Run focused tests and confirm GREEN

Run the same Vitest command. Expected: all Task 1 tests pass.

### Step 5: Commit Task 1

```bash
git add libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts
git commit -m "feat: connect VK groups with community tokens"
```

---

## Task 2: Enforce text-only publishing and safe VK requests

**Files:**

- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts`

### Step 1: Write failing validity and publishing tests

Add tests for `checkValidity()`:

```ts
const mediaError =
  'VK Group temporarily supports text-only posts. Remove all media and try again.';

expect(await provider.checkValidity([[]], {}, [])).toBe(true);
expect(
  await provider.checkValidity([[{ path: 'photo.jpg' }]], {}, [])
).toBe(mediaError);
expect(
  await provider.checkValidity([[{ path: 'video.mp4' }]], {}, [])
).toBe(mediaError);
expect(
  await provider.checkValidity([[], [{ path: 'photo.jpg' }]], {}, [])
).toBe(mediaError);
```

Mock `provider.fetch` for `post()` and assert:

- URL is exactly `https://api.vk.com/method/wall.post`;
- URL contains neither the access token nor `client_id`;
- `FormData` contains `access_token`, `v=5.251`, `owner_id=-123`,
  `from_group=1`, and the message;
- there is no `attachments` field;
- response maps to the expected Postiz completed response and VK wall URL;
- a VK HTTP-200 `{ error: ... }` body throws `BadBody`.

Add equivalent `comment()` assertions for `wall.createComment`, including
`owner_id=-123`, positive `from_group=123`, `post_id`, and no attachments.

### Step 2: Run focused tests and confirm RED

Run the provider suite. Expected: the validity and safe request-shape tests
fail against the current publishing implementation.

### Step 3: Implement strict text-only publishing

Override `checkValidity(posts: Array<ValidityMedia[]>)`. If any inner array is
non-empty, return the exact approved error; otherwise return true.

Build both VK calls with `FormData` and the `callVk` helper from Task 1. Do not
call any upload method. `post()` sends:

```ts
const result = await this.callVk('wall.post', accessToken, {
  owner_id: userId,
  from_group: '1',
  message: firstPost.message,
});
```

`comment()` sends:

```ts
const result = await this.callVk('wall.createComment', accessToken, {
  owner_id: userId,
  from_group: String(Math.abs(Number(userId))),
  message: commentPost.message,
  post_id: postId,
});
```

On `{error}` or missing response, throw `BadBody` without including the access
token. Preserve existing Postiz response ids/status/release URLs.

### Step 4: Run focused tests and confirm GREEN

Run the provider suite. Expected: all authentication, validity, post and
comment tests pass.

### Step 5: Commit Task 2

```bash
git add libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts
git commit -m "fix: make VK group publishing text only"
```

---

## Task 3: Render VK permission guidance and remove the OAuth picker

**Files:**

- Modify: `libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/integration.manager.ts`
- Modify: `apps/backend/src/api/routes/integrations.controller.ts`
- Create: `apps/frontend/src/components/launches/custom-fields-instructions.tsx`
- Create: `apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx`
- Modify: `apps/frontend/src/components/launches/add.provider.component.tsx`
- Modify: `apps/frontend/src/components/launches/menu/menu.tsx`
- Modify: `apps/frontend/src/components/launches/continue.integration.tsx`
- Modify: `apps/frontend/src/components/new-launch/providers/continue-provider/list.tsx`
- Delete: `apps/frontend/src/components/new-launch/providers/continue-provider/vk/vk.continue.tsx`

### Step 1: Write failing instruction-component tests

Create a small presentational component test with Vitest and
`react-dom/server`'s `renderToStaticMarkup`. Assert the rendered HTML contains:

```text
When creating the VK access key, select only:
Allow the application to manage the community
Allow the application to access the community wall
Messages, photos, documents, stories, and products/orders are not required.
```

Also test that passing `undefined` renders an empty string, protecting every
existing custom-fields provider.

Extend the provider suite to assert the exact `customFieldsInstructions`
metadata and add a source-level contract test or exported-list test confirming
`continueProviderList` does not contain `vk-group`.

### Step 2: Run the focused frontend/provider tests and confirm RED

```bash
pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx
```

Expected: FAIL because the metadata and component do not exist.

### Step 3: Add the optional metadata contract

Add to `SocialProvider`:

```ts
customFieldsInstructions?: {
  title: string;
  items: string[];
  note?: string;
};
```

Set this property on `VkGroupProvider` using the exact four approved strings.
Expose it alongside `customFields` in both provider-list paths:

```ts
...(p.customFieldsInstructions
  ? { customFieldsInstructions: p.customFieldsInstructions }
  : {}),
```

and the equivalent `findIntegration` mapping in the authenticated integrations
controller. Never include field values or tokens in this metadata.

### Step 4: Render instructions in both custom-field entry points

Implement `CustomFieldsInstructions` as a neutral informational block using
the project's current `bg-sixth`, `border-tableBorder`, and `text-textColor`
tokens. Render the title, a two-item unordered list, and optional note.

Add the optional prop to `CustomVariables`, render the component above the
inputs, extend the provider response type in `AddProviderComponent`, and pass
the metadata in:

1. Add Channel custom-fields flow;
2. `menu.tsx` update-credentials custom-fields flow.

Do not alter existing providers that omit the prop.

### Step 5: Remove VK Group from the between-steps flow

In `continue.integration.tsx`, change:

```ts
if (provider === 'vk' || provider === 'vk-group')
```

to:

```ts
if (provider === 'vk')
```

This keeps VK ID's `code&&&&device_id` encoding for the personal provider but
leaves the VK Group base64 JSON intact.

Remove the `VkGroupContinue` import and `vk-group` entry from
`continue-provider/list.tsx`, then delete the obsolete picker component. Keep
the personal `vk` provider and all VK Group listing/icon/editor registrations.

### Step 6: Run focused tests and confirm GREEN

Run the Task 3 focused command. Expected: all tests pass.

### Step 7: Commit Task 3

```bash
git add libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts libraries/nestjs-libraries/src/integrations/integration.manager.ts apps/backend/src/api/routes/integrations.controller.ts apps/frontend/src/components/launches/custom-fields-instructions.tsx apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx apps/frontend/src/components/launches/add.provider.component.tsx apps/frontend/src/components/launches/menu/menu.tsx apps/frontend/src/components/launches/continue.integration.tsx apps/frontend/src/components/new-launch/providers/continue-provider/list.tsx apps/frontend/src/components/new-launch/providers/continue-provider/vk/vk.continue.tsx
git commit -m "feat: guide VK community token setup"
```

---

## Task 4: Regression verification and handoff

**Files:**

- Modify only if verification reveals a defect in the approved scope.

### Step 1: Run all focused tests

```bash
pnpm exec vitest run libraries/nestjs-libraries/src/integrations/social/vk.group.provider.spec.ts apps/frontend/src/components/launches/custom-fields-instructions.spec.tsx
```

### Step 2: Build both affected applications

```bash
pnpm build:backend
pnpm build:frontend
```

Fix only failures caused by this branch, rerun the failed command, and keep
unrelated user work untouched.

### Step 3: Review the complete diff

```bash
git diff --check prod...HEAD
git diff --stat prod...HEAD
git status --short
```

Confirm explicitly:

- personal `vk` still uses VK ID OAuth and device id handling;
- `vk-group` exposes two custom fields and no continue picker;
- no VK community token is placed in a URL, message, log, test snapshot, or
  committed fixture;
- no photo/video upload method remains reachable from `vk-group`;
- exact text-only validation error is unchanged;
- no unrelated primary-checkout files are included.

### Step 4: Request code review

Use `requesting-code-review` on `prod...HEAD`. Address blocking findings with
tests first, rerun the complete verification, and record the final verdict.

### Step 5: Present integration options

Use `finishing-a-development-branch`. Do not merge or push to `prod` until the
user explicitly chooses deployment.

After deployment only, remove the failed transient `vk-group` row whose
`internalId` starts with `g_`, then perform production acceptance:

1. Add Channel -> VK Group shows two fields and the permission guide.
2. Connect `https://vk.com/fedrbodr_pro` with its community token.
3. Publish one text post and verify it appears as the community.
4. Verify image/video scheduling is rejected with the approved message.
5. Verify the token does not appear in UI, browser URL, application logs, or
   errors.
