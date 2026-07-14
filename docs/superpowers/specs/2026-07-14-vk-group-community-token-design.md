Project: postiz-app
Document: design-spec

# VK Group Community Token Connection Design

**Goal:** Replace the non-working VK ID OAuth flow for `vk-group` with a
two-field connection flow that uses a VK community access token and supports
publishing text and photos as the community.

**Date:** 2026-07-14
**Status:** approved by user

## Root Cause

The deployed `vk-group` provider requests the `groups` scope from VK ID and
then calls the classic VK API method `groups.get`. VK ID does not expose that
permission in the application cabinet or consent screen. A production
reproduction returned VK API error `1051`, `Method is not available for this
profile type`, for the resulting token. The provider currently discards the
error body and renders it as an empty group list.

The personal `vk` provider remains unchanged. `VK_ID` remains configured for
that provider.

## Chosen Connection Flow

Keep the provider identifier `vk-group`, but replace its between-steps OAuth
behavior with the existing Postiz `customFields` connection pattern.

The Add Provider modal contains two required fields:

1. `group` — text input labelled `VK community link or short name`, accepting
   values such as `https://vk.com/fedrbodr_pro`, `vk.com/fedrbodr_pro`,
   `fedrbodr_pro`, `club123`, or a numeric group id.
2. `accessToken` — password input labelled `Community access token`. Its value
   is not rendered again after submission.

The modal also shows this provider-specific instruction:

> When creating the VK key, select only:
> - Allow the application to manage the community
> - Allow the application to access community photos
> - Allow the application to access the community wall
>
> Messages, documents, stories, and products/orders are not required.

The instruction should be rendered as text in the VK Group custom-fields UI;
it is not another form field.

## Backend Authentication and Identity

`VkGroupProvider` becomes a direct-connect provider:

- `isBetweenSteps = false`;
- no VK ID scopes or OAuth redirect;
- `generateAuthUrl()` returns the state-only value used by other custom-field
  providers;
- `customFields()` declares the two fields and the provider instruction;
- `authenticate()` decodes the submitted fields, normalizes the group
  identifier, and calls VK to resolve the community and validate the token;
- the integration identity is stored as the negative VK group id, matching
  `owner_id` semantics;
- the community token is stored in the normal integration token column, like
  other Postiz provider credentials;
- refresh is disabled by returning the permanent-token shape used by custom
  credential providers.

Authentication fails before saving a channel when:

- the group value is empty or cannot be normalized;
- VK cannot resolve the community;
- the token is invalid or belongs to a different community;
- the token lacks community management, photo, or wall access.

The user receives a concrete, non-secret error message. VK response bodies and
access tokens are never logged or returned to the browser.

## Publishing

Reuse the existing negative group-id convention and community posting calls:

- text posts use `wall.post` with the community token and negative
  `owner_id`;
- photo posts obtain a community wall upload server, upload the image, save it
  for the group, and attach it to `wall.post`;
- comments continue to use the community identity and token;
- the obsolete `client_id` query parameter is omitted from community-token API
  calls.

Version one supports text and photos only. `checkValidity()` rejects any video
before scheduling with the message `Video posting to VK Group is not supported
yet.` The provider must not call `video.save` in this version. Documents,
stories, messages, products, and orders are out of scope.

## Frontend Changes

The generic Postiz custom-fields modal handles both inputs. Add a small,
provider-specific informational block to the custom-fields rendering contract
so VK Group can show the exact permission checklist without representing help
text as editable data. Existing custom-field providers keep their current UI.

Remove the `vk-group` continue-provider picker registration and its empty-list
screen. Keep provider listing, icon, post settings, and preview registrations.

## Existing Data

No successfully bound community-token integrations exist yet, so no database
migration is required. Delete the failed transient `vk-group` integration with
an internal id starting with `g_` after deployment. Do not alter personal `vk`
integrations.

## Verification

Automated coverage must include:

- group link and id normalization;
- custom-field declaration and permission instruction;
- successful community-token authentication and negative identity;
- invalid token, wrong community, and missing-permission errors without token
  leakage;
- text and photo publishing request shapes;
- video rejection before scheduling;
- the personal `vk` provider remaining on VK ID OAuth;
- removal of the between-steps picker for `vk-group`.

Production acceptance:

1. Open Add Channel -> VK Group and see the two fields and permission guide.
2. Connect `https://vk.com/fedrbodr_pro` with its community access token.
3. Publish a text post and a photo post as the community.
4. Verify a video is rejected before scheduling with the supported error.
5. Verify the token is absent from UI, logs, URLs, and error messages.
