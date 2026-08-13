# VK Group User OAuth Photo Publishing Design

**Date:** 2026-08-12
**Status:** Approved in conversation; pending written-spec review
**Supersedes:** The community-access-key authentication portions of
`2026-08-12-vk-group-photo-publishing-and-onboarding-design.md`

## Problem

VK community access keys can report the `photos` permission while VK still
rejects `photos.getWallUploadServer` with API error 27:
`Group authorization failed: method is unavailable with group auth.` This was
confirmed against the production VK Group integration. As a result, the
existing community-key implementation can publish text but cannot upload a
photograph for a community wall.

The required product behavior remains unchanged: VK Group must publish text
with zero to ten photographs, while videos and other attachment types remain
unsupported. Returning the product to text-only mode is out of scope.

## Goals

- Replace manual VK community-key onboarding with VK user OAuth.
- Let an authenticated administrator select a community they manage.
- Publish text and up to ten photographs from the selected community.
- Keep personal VK and VK Group as independent integrations.
- Refresh VK Group user tokens without changing the selected community.
- Give existing community-key integrations an actionable reconnect path.
- Prove the real VK capability before production rollout.

## Non-goals

- VK Group video, documents, archives, polls, or media in comments.
- Sharing credentials with the personal VK integration.
- Automatically converting existing community keys into user tokens.
- Automatically selecting a community when several are available.
- Changing personal VK publishing behavior or its persisted integrations.

## Authentication Architecture

### Independent VK Group OAuth

`vk-group` becomes a normal, two-step OAuth provider. It uses the existing VK
ID authorization-code flow with PKCE, but has its own redirect URI:

```text
${FRONTEND_URL}/integrations/social/vk-group
```

The provider requests the minimum API capabilities needed for this flow:
identity information plus `wall`, `photos`, and `groups`. The exact VK ID scope
encoding must use the same format and token-exchange endpoint as the existing
personal VK provider. The personal provider's declared scopes and callback are
not changed.

Shared VK ID mechanics—PKCE generation, code exchange, token parsing, user-info
parsing, and refresh—must live behind a small shared module or base abstraction
so that the two providers cannot drift. Provider-specific scopes, callback URI,
identifier, and post behavior remain explicit inputs.

The callback returns a temporary integration with a namespaced internal ID,
for example `vk-group-oauth:<vk-user-id>`. This avoids the repository's
organization-wide `internalId` uniqueness constraint colliding with an
existing personal VK integration for the same user.

The temporary integration stores the user access token, refresh token, token
expiry, and device binding required by VK ID. It remains
`inBetweenSteps=true`; the refresh workflow already ignores integrations in
that state.

### Community Selection

After OAuth, the backend calls `groups.get` with `filter=admin`, `extended=1`,
and the fields required to render the community name, public identifier, and
avatar. Only the returned managed communities are presented in the existing
two-step selection screen.

When the user selects a community, the backend must not trust the submitted
ID. It fetches the managed-community list again with the stored access token
and requires an exact ID match. It then performs a non-mutating capability
preflight:

```text
photos.getWallUploadServer(group_id=<positive group id>)
```

The selection is saved only if VK returns a valid HTTPS upload URL. The final
integration fields are:

- `internalId`: the signed community owner ID, `-<groupId>`;
- `rootInternalId`: remains the OAuth root identifier used by reconnect logic;
- `name`, `picture`, `profile`: from the server-verified VK community record;
- `token`, `refreshToken`, `tokenExpiration`: the administrator's VK user OAuth
  credentials and expiry;
- `inBetweenSteps`: `false`.

If the organization already has the same signed community ID, reconnect must
update that integration rather than create a duplicate. The implementation
must preserve the existing repository semantics for deleted/reconnected
channels.

## Token Refresh Invariants

VK Group uses the same VK ID refresh exchange as personal VK, including the
device-bound refresh value. A refresh result updates access token, refresh
token, and expiry only. The selected `internalId=-<groupId>`, community name,
avatar, and profile must not be replaced with VK user identity data.

After refresh, publishing continues with the refreshed user token. A failed or
revoked refresh follows the existing channel reconnect path and must not retry
publishing indefinitely.

## Publishing Flow

The validation contract from the prior design remains binding:

- text-only posts are valid;
- the main post may contain one to ten images;
- eleven or more images are rejected before enqueue;
- videos and every other attachment type are rejected before enqueue;
- media in follow-up comments is rejected;
- worker-side validation repeats the same checks before any VK call.

For a valid publication, the worker:

1. Parses the signed integration ID and derives the positive community ID.
2. For each photograph, calls `photos.getWallUploadServer` with `group_id`,
   downloads the Postiz media, uploads the multipart body to the validated
   HTTPS upload URL, and calls `photos.saveWallPhoto` with `group_id`.
3. Validates that every saved photograph has a well-formed, non-zero signed
   `owner_id` and a positive `id`, then builds `photo<owner_id>_<id>` attachment
   identifiers in the original media order. `group_id` selects the destination
   community wall, while the returned photo `owner_id` identifies the saved
   attachment and may be the positive VK user ID under user OAuth; it is not
   required to equal `-<groupId>`.
4. Calls `wall.post` only after every photograph succeeds, with:

```text
owner_id=-<groupId>
from_group=1
message=<post text>
attachments=<comma-separated saved photographs, when present>
```

5. Stores the returned post ID and the direct release URL:
   `https://vk.com/wall-<groupId>_<postId>`.

The operation remains atomic with respect to wall publication: no wall post is
created if an upload or save fails. VK may retain an uploaded/saved photograph
without a wall post; automatic deletion of such media is not introduced in
this change. A returned photo owner that differs from the wall owner is not by
itself a failure: `wall.post.owner_id` still targets `-<groupId>`, and the
attachment uses the exact validated owner/photo pair returned by
`photos.saveWallPhoto`.

## Existing Community-Key Integrations

Existing integrations are not silently rewritten. Text-only publication may
continue with their stored community key. When an old integration attempts a
photo post and VK returns group-auth error 27 from a photo method, Postiz must
return a stable actionable error instructing the user to reconnect VK Group
through VK OAuth. The UI localizes this message in Russian and English.

New VK Group connections never show or accept the manual community-link and
community-key fields. The old instructions are replaced by a collapsible RU/EN
explanation of the OAuth permissions, community selection, community
authorship, the ten-photo limit, and the fact that video remains unsupported.
No access or refresh token is rendered to the browser after the OAuth callback.

## Error Handling and Privacy

- VK API error 5 triggers the existing refresh/reconnect mechanism.
- VK photo API error 15 maps to an actionable missing-access/reconnect error.
- VK photo API error 27 maps to the legacy-community-key reconnect error.
- A selected community absent from the second `groups.get filter=admin` result
  is rejected as unauthorized.
- Invalid/malformed VK payloads and non-HTTPS upload URLs fail closed.
- Provider errors may include method name and numeric VK error code, but never
  tokens, upload URLs, response bodies containing secrets, media URLs, post
  text, or personal profile data.
- Logs and tests must not include the original user screenshots or any real
  token value.

## Frontend Flow

Clicking VK Group now starts OAuth directly. After the callback, the existing
two-step page renders a VK Group selector with verified community avatar,
name, and public identifier. Saving a selection shows the ordinary connected
channel success state.

If no managed communities are returned, the page explains that the signed-in
VK account must be an administrator of at least one community. If capability
preflight fails, the page keeps the integration incomplete and shows a safe,
localized reconnect/access message.

The selector must be registered explicitly for `vk-group`; it must not reuse a
provider component whose submitted field names or semantics differ.

## Testing

### Automated tests

- Shared VK OAuth tests cover PKCE URL generation, callback URI separation,
  token parsing, device-bound refresh, malformed payloads, and required scopes.
- Personal VK regression tests prove its identifier, callback, scopes,
  authentication result, refresh, and publishing behavior remain unchanged.
- VK Group authentication tests cover the namespaced temporary ID, managed
  group listing, exact selection verification, forged/unmanaged IDs, duplicate
  reconnect, capability preflight, and safe errors.
- Refresh tests prove a token rotation cannot change the signed group ID or
  community metadata.
- Provider tests cover text-only, one photo, ten photos, upload order, positive
  user-owned and negative community-owned saved-media identifiers, atomic
  failure, error 15, error 27, malformed responses, and direct release URLs.
- Pre-enqueue and worker-path tests retain the media count/type/comment
  boundaries from the prior design.
- Frontend tests cover OAuth start, VK Group two-step selector registration,
  RU/EN onboarding copy, no manual key field, empty managed-group state, and
  safe reconnect errors.

### Real VK capability gate

The capability runner is changed to accept a VK **user OAuth token** with
administrator access to the target community. It must first prove the target
appears in `groups.get filter=admin` and that `photos.getWallUploadServer`
succeeds.

The mutating phase uses a UUID marker and a repository-owned non-sensitive test
image. It uploads and saves one photograph, accepts the validated signed photo
owner returned by VK, publishes one community-authored wall post, reads it back
with `wall.getById`, and verifies exact wall owner, author, marker, and returned
attachment identity. Cleanup may delete only the exact photo returned by the
save call after the marked wall post proves that attachment identity. The
runner must verify absence after cleanup. Any ambiguous identity or cleanup
result is `PENDING_CLEANUP`, never `GO`.

Production rollout requires the runner's machine-readable final status to be
exactly `GO`. A conversational approval such as "go" is authorization to run
the gate, not evidence that the gate passed.

## Rollout

1. Run focused provider, worker, OAuth, refresh, frontend, privacy, and hygiene
   suites under the repository's pinned Node 22 toolchain.
2. Run the full repository test suite and production builds.
3. Run the history-aware release hygiene check against `prod`.
4. Run the real VK capability gate with a user OAuth token for a disposable or
   approved target community and require exact `GO` plus verified cleanup.
5. Merge and push only after review and user approval; production deploy still
   requires separate explicit confirmation.
6. After deployment, reconnect VK Group through OAuth and perform one normal
   user-facing text-plus-photo publication.
7. Verify the direct VK wall URL, community authorship, attachment, Postiz
   `PUBLISHED` state, readiness ports, and Temporal pollers.

## Acceptance Criteria

- A VK administrator can connect VK Group through OAuth without entering a
  community access key.
- The second step lists only communities the authenticated user manages and
  rejects a forged selection.
- A selected community passes a real photo upload-server preflight before the
  integration becomes active.
- Text-only and one-to-ten-photo posts publish from the community and produce a
  direct working wall URL.
- Video, other attachments, comment media, and more than ten photos are rejected
  before enqueue and again before worker-side VK calls.
- Tokens refresh without changing the selected community.
- Personal VK remains behaviorally unchanged.
- Existing community-key integrations receive an actionable OAuth reconnect
  message for photo attempts.
- The real capability runner reports exact `GO` and leaves no test post behind
  before production rollout.
