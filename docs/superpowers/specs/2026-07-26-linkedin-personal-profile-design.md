# LinkedIn personal profile publishing

## Goal

Enable users of `https://app.vezdepost.ru` to connect a personal LinkedIn
profile and publish posts to that profile. Company and organization pages are
outside this change.

## Current state and root cause

The repository already contains the personal provider with identifier
`linkedin`, including posting support. Production currently passes empty
`LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` values from the base Compose
file, so the generated authorization URL contains an empty `client_id`.

The personal provider also requests `r_basicprofile` and organization scopes.
Those permissions are not needed for personal publishing and are not part of
LinkedIn's self-service consumer products. In addition, the authorization URL
uses `prompt=none`, which prevents the normal first-time consent flow.

## LinkedIn application configuration

Create or configure one LinkedIn Developer application for Vezdepost:

- enable `Sign In with LinkedIn using OpenID Connect`;
- enable `Share on LinkedIn`;
- register the exact redirect URL
  `https://app.vezdepost.ru/integrations/social/linkedin`;
- obtain the application's Client ID and Client Secret.

The Client Secret must remain only in the untracked production `.env` file. It
must not be placed in Git, Docker image layers, command output, logs, or chat.

## Application changes

### Personal OAuth permissions

Change `LinkedinProvider.scopes` to request only:

```text
openid profile w_member_social
```

Remove `prompt=none` from the personal authorization URL. A user connecting the
channel for the first time must see LinkedIn's normal login and consent screen.
The existing random `state` value and exact redirect URI remain unchanged.

The `LinkedinPageProvider` identifier and organization-specific scopes remain
unchanged. Organization support is not enabled or tested as part of this work.

### Profile identity

After the authorization-code exchange, obtain the member identity from
`https://api.linkedin.com/v2/userinfo`, using the `sub`, `name`, and `picture`
claims. Do not call the legacy `https://api.linkedin.com/v2/me` endpoint from
the personal authentication or refresh path, because the selected self-service
permissions do not grant `r_basicprofile`.

LinkedIn OIDC does not provide a public profile vanity name. Store an empty
`username`, following the existing provider pattern for integrations that do
not return one. The stable integration identifier remains the OIDC `sub` claim.

### Production configuration

Add `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` interpolation to the
`postiz` service in `docker-compose.override.yaml`, sourcing both values from
the server's untracked `.env` file.

The production rollout order is:

1. Add both values to the server `.env` without printing them.
2. Deploy the code and Compose changes.
3. Recreate the `postiz` container so it receives the new environment.
4. Verify inside the container only that both variables are non-empty; never
   print their values.

## Error handling

The provider must not generate a LinkedIn authorization request when either
credential is absent. It should fail locally with a clear configuration error
that names the missing environment variable, instead of redirecting the user
to a malformed LinkedIn URL.

Token exchange and `userinfo` failures must continue through the integration's
existing error handling. No token or Client Secret may be included in an error
message.

## Tests

Add focused provider tests that verify:

- the authorization URL contains the configured Client ID;
- its redirect URI is exactly
  `https://app.vezdepost.ru/integrations/social/linkedin`;
- its scopes are exactly `openid`, `profile`, and `w_member_social`;
- it does not contain `prompt=none` or any organization permission;
- missing Client ID or Client Secret produces a local configuration error;
- successful authentication uses OIDC `userinfo`, returns its `sub`, `name`,
  and `picture`, sets `username` to an empty string, and does not request
  `/v2/me`.

Run the focused LinkedIn provider tests and the relevant repository-level
checks from the monorepo root.

## Acceptance criteria

- Clicking the personal LinkedIn channel produces an OAuth URL with a non-empty
  Client ID and only the three approved personal scopes.
- A first-time user sees LinkedIn's consent screen and can complete the callback
  to Vezdepost.
- The connected personal profile appears as a channel in Vezdepost.
- A plain-text test post can be published to that user's personal LinkedIn
  feed.
- No organization/API-partner permission is required.
- Credentials and access tokens are not committed or exposed in output.

## Out of scope

- LinkedIn company or organization pages;
- Community Management API approval;
- organization analytics;
- changes to LinkedIn post formatting or media behavior;
- migration of already-connected LinkedIn channels.
