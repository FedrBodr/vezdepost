Project: postiz-app
Document: design-spec

# VK Group Provider Design

**Goal:** Add a "VK Group" channel type so Postiz can publish to VK communities (groups/public pages) the user administers — posting as the community itself. The existing VK channel (personal wall) stays untouched.

**Date:** 2026-07-13
**Status:** approved by user (brainstorm 2026-07-13)

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Channel model | Separate channel type `vk-group` (like LinkedIn Page vs LinkedIn). One channel = one group. |
| Post author | As the community (`from_group=1`), not as the user. |
| Fork vs upstream | Fork-first but upstream-compatible: English naming in code, `name = 'VK Group'`, minimal diff to upstream files. Optional upstream PR later. |
| Post length | Real VK wall limit is **16 384 characters** (upstream's 2048 is over-conservative). Bump `maxLength()` in the base `VkProvider` to 16384 — the group provider inherits it. One-line upstream diff, also PR-able upstream. |

## Architecture

`VkGroupProvider extends VkProvider` — same VK ID OAuth (PKCE, same `VK_ID` env var, no secret), plus the two-step "page picker" pattern already used by LinkedIn Page / Facebook Pages:

1. User clicks "Add channel → VK Group" → VK ID OAuth (scopes = base VK scopes + `groups`).
2. Backend `no.auth.integrations.controller` sees `isBetweenSteps = true` → calls the provider's `pages(accessToken)` → returns the user's groups.
3. Frontend shows the group picker (`withContinueProvider` HOC) → user picks one → `POST /integrations/provider/:id/connect` → `integration.service.saveProviderPage()` → provider `fetchPageInformation()` fixes the channel identity to the group. (Note: the optional `reConnect()` interface method is legacy — nothing calls it; the live path is `fetchPageInformation`.)
4. Scheduled posts go through the inherited orchestrator flow; `post()`/`comment()` target the group wall.

**Key identity convention:** the integration's `internalId` is stored as the *negative* group id (`-{groupId}`), matching VK API `owner_id` semantics. This makes attachment strings (`photo-123_456`) and `owner_id` params compose naturally.

**Token refresh safety (verified):** `integration.service.ts` `refreshToken()` persists only `{accessToken, refreshToken, expiresIn}` from the provider — channel identity (`internalId`, name, picture) is never overwritten on refresh. The inherited `VkProvider.refreshToken()` therefore works as-is; the group binding survives token refreshes.

## Components

### Backend — new file `libraries/nestjs-libraries/src/integrations/social/vk.group.provider.ts`

```
class VkGroupProvider extends VkProvider:
  identifier = 'vk-group'
  name = 'VK Group'
  isBetweenSteps = true
  scopes = [...base VK scopes, 'groups']

  pages(accessToken)
    → VK API groups.get?filter=admin,editor&extended=1&fields=photo_200,screen_name
    → [{ id, name, username: screen_name, picture: photo_200 }]

  fetchPageInformation(accessToken, { page })
    → groups.getById(group_id=abs(page))
    → { id: `-${groupId}`, name, picture, username, access_token: accessToken }
    (the same user token is kept — VK has no per-group token in this flow)

  post()/comment() overrides:
    wall.post / wall.createComment with owner_id=-{groupId} & from_group=1

  uploadMedia override (group-aware):
    photos.getWallUploadServer?group_id={groupId}
    photos.saveWallPhoto with group_id={groupId}
    video.save with group_id={groupId}
```

### Minimal edits to upstream files

- `vk.provider.ts`:
  - redirect URI built from `this.identifier` instead of hard-coded `vk` (no behavior change for the base class);
  - `uploadMedia` visibility `private` → `protected` (TS forbids overriding a `private`);
  - `maxLength()` 2048 → 16384.
- `integration.manager.ts`: import + `new VkGroupProvider()` (one line each).

### Frontend

- `apps/frontend/src/components/new-launch/providers/continue-provider/vk/vk.continue.tsx` — group picker via the existing `withContinueProvider` HOC (mirror `linkedin.continue.tsx`, endpoint returns the `pages()` list).
- `continue-provider/list.tsx` — register `'vk-group': VkContinue`.
- `show.all.providers.tsx` — register identifier `vk-group`, reusing the existing VK post-settings component.
- `apps/frontend/public/icons/platforms/vk-group.png` — icon (VK icon variant/badge; placeholder copy of `vk.png` acceptable initially).

### VK ID app configuration (manual, one-time)

- Add second trusted redirect URL: `https://app.vezdepost.ru/integrations/social/vk-group`.
- Request the `groups` scope (in addition to wall/photos/video/docs/status/email/personal_info).
- Until the app passes VK moderation, test accounts must be added as app testers.

No DB migrations, no new env vars (`VK_ID` is shared).

## Error handling

- No groups with posting rights → picker shows the standard empty-state (as LinkedIn Page does).
- VK API errors on publish (e.g. wall closed, error 214) surface through the existing `SocialAbstract` fetch/retry mechanism → post gets `failed` status like any provider.
- Media limits (photo formats, mp4) inherited from base VK behavior.

## Testing / verification

This repo has no unit tests for social providers; the established pattern is **typecheck + build + lint (from root, pnpm) + manual runtime test**:

1. `pnpm run build` and `pnpm run lint` pass.
2. Manual: connect a test group via "Add channel → VK Group", publish a text post and a post with an image from the calendar, verify both appear on the group wall authored by the community; add a comment thread post and verify.

## Out of scope (YAGNI)

- Posting to groups where the user is not admin/editor (suggest-a-post flow).
- Per-post "as user vs as community" toggle.
- VK group analytics/stats.
- Community access tokens (user token with `groups` scope suffices for admin posting).