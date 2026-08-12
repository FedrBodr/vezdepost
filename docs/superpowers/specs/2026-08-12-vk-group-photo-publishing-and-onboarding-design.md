# VK Group Photo Publishing and Onboarding Design

## Status

Approved in conversation on 2026-08-12. Implementation has not started.

## Goal

Make the separate `VK Group` integration publish text-only posts and posts with
up to 10 photographs to a VK community. Make connecting a community clear for
a non-technical user without requiring Callback API or Long Poll API setup.

Personal VK remains a separate integration and is not a substitute or fallback
for community publishing.

## User-facing scope

- A VK Group post may contain text and zero through ten photographs.
- A text-only post continues to work as it does today.
- Video, documents, stories, products, and other attachment types remain out of
  scope and must be rejected before the post is enqueued.
- An eleven-photo post must be rejected with a clear localized message.
- A failed photo upload must fail the publication. The provider must not publish
  a partial post with only some of the selected photographs.
- The resulting wall post is published on the selected community wall and from
  the community.

## Connection contract

The connection form keeps two credentials:

1. `VK community link` accepts:
   - `https://vk.ru/fedrbodr_pro`;
   - `https://vk.com/fedrbodr_pro`;
   - `vk.ru/fedrbodr_pro` or `vk.com/fedrbodr_pro`;
   - the short name `fedrbodr_pro`;
   - numeric, `club<ID>`, and `public<ID>` identifiers already supported by the
     provider.
2. `Community access token` is a password field containing the access key made
   for that exact community. A personal token and a VK application ID are not
   accepted substitutes.

The full `https://vk.ru/<community>` form is shown as the recommended example,
even though the parser accepts all forms above. Validation and authentication
errors are specific and actionable instead of appending the generic English
phrase `is invalid` to a field label.

## Expandable connection guide

The `VK Group` form contains a collapsed-by-default section named “Где взять
ссылку и ключ”. Expanding it shows:

1. Open the community in the desktop VK website and select “Управление”.
2. Open “Дополнительно” → “Работа с API” → “Ключи доступа”.
3. Select “Создать ключ”.
4. Grant only community management, community wall, and photographs access.
5. Copy the generated community access key into Vezdepost.
6. Copy the public community address, for example
   `https://vk.ru/fedrbodr_pro`, into the first field.

The guide states explicitly that Callback API and Long Poll API are not needed.
It also warns that the access key is a secret and must not be sent to support,
placed in screenshots, or shared with third parties.

The supplied screenshots are reference material only. They must not be added to
the repository in their current form: one shows a real key fragment and an
owner name. Product screenshots must be newly captured or irreversibly cropped
and redacted, contain no key fragment or personal data, and cover only these
useful states:

- the community management entry point;
- “Работа с API” and the “Ключи доступа” tab;
- the create-key permission selector;
- the resulting permission list with the key itself fully hidden.

Callback API and Long Poll screenshots are excluded because those tabs are not
part of the setup.

## Provider architecture

The change is isolated to `VkGroupProvider`; the working personal `VkProvider`
photo pipeline is not refactored in this release.

For every photograph, `VkGroupProvider`:

1. requests a community-wall upload URL from VK for the positive community ID;
2. downloads the Vezdepost media URL as a stream without logging the URL;
3. uploads the stream to the VK-provided HTTPS endpoint;
4. validates the upload response;
5. saves the wall photograph for the community;
6. validates and retains both returned `owner_id` and `id`;
7. supplies `photo{owner_id}_{id}` in the final `wall.post` attachments list.

The final `wall.post` keeps the existing negative `owner_id`, `from_group=1`,
message, and verified response handling. Attachment order matches the order in
which the user selected the photographs. Concurrent upload is permitted, but
the ordered result must be preserved.

No post is submitted until all selected photographs have uploaded and saved
successfully.

## VK capability gate

Automated tests mock VK responses, so the release also requires one controlled
real-community check with a newly created community token that has `manage`,
`wall`, and `photos` permissions.

The check must prove that the current production VK API version accepts the
community token for both the wall upload-server request and saving a wall
photo. If VK rejects either operation despite the declared permissions, stop
the rollout and record the returned VK method/error code. Do not silently use a
personal token, request broader unrelated permissions, or publish a partial
text-only post.

## Permission validation

Connection authentication continues to prove that the token belongs to the
requested community. It additionally requires the VK `photos` permission along
with `manage` and `wall`. The form guide and provider validation must describe
the same three permissions.

An existing connected integration whose old token lacks `photos` may continue
to publish text-only posts. A photo publication with that token must fail with
an actionable reconnect/recreate-key message; it must not degrade to a
text-only publication. Newly connected integrations require all three
permissions.

## Errors, privacy, and observability

- VK API envelopes and identifiers are structurally validated before use.
- Upload URLs must be valid HTTPS URLs.
- Errors name the failed VK phase without including access tokens, upload URLs,
  media URLs, form bodies, or full upstream payloads.
- Retriable authentication expiry follows the existing VK refresh/error
  classification behavior only where applicable. A community key has no
  personal-token fallback.
- The access key remains a password input and is never echoed after submission.
- Logs may include the provider identifier, VK method name, post ID, and safe
  error class, but no credentials or private URLs.

## UI contract

The existing custom-field instruction contract is extended in a backwards
compatible way so only `VK Group` receives the expandable rich guide. Other
providers keep their current rendering.

The guide content is localized at least in Russian and English. Labels,
examples, validation messages, media-limit errors, unsupported-media errors,
and reconnect guidance use the existing translation mechanism rather than
hard-coded mixed-language text.

The layout must remain usable in the existing provider modal on desktop and
mobile. Screenshots are optional visual steps: the text instructions remain
complete if an image cannot load.

## Verification

Automated coverage includes:

- normalization of `vk.ru`, `vk.com`, scheme-less, short-name, numeric,
  `club<ID>`, and `public<ID>` community inputs;
- rejection of foreign domains, nested paths, and malformed identifiers;
- connection permission validation for `manage`, `wall`, and `photos`;
- text-only publication unchanged;
- one-photo publication;
- ten-photo publication with stable attachment ordering;
- rejection of eleven photographs;
- rejection of video and other unsupported media before enqueueing;
- malformed or unsafe upload URL;
- media download failure;
- VK upload failure;
- malformed photo upload/save response and identifiers;
- no `wall.post` call after any partial upload failure;
- token, upload URL, and media URL redaction in every failure path;
- expandable guide collapsed and expanded states;
- Russian/English guide copy and the statement that Callback/Long Poll are not
  required;
- existing personal VK and text-only VK Group regressions.

Release verification includes the repository workspace preflight, focused VK
tests, the canonical test suite, backend/orchestrator/frontend builds, the
controlled real-community photo post, and production health checks.

## Explicit non-goals

- VK Group video publishing.
- Documents, stories, products, or mixed attachment types.
- Callback API or Long Poll API configuration.
- Sharing or storing screenshots containing real access keys.
- Refactoring the personal VK provider into a shared uploader during this
  release.
