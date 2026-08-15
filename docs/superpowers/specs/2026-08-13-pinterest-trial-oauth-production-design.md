# Pinterest Trial OAuth Production Design

## Goal

Connect the approved Pinterest Trial application to production Vezdepost, complete OAuth, expose the authenticated Pinterest Business account and its boards in Integrations, and verify draft creation without publishing a public Pin.

Public Pinterest publishing remains blocked until Pinterest grants Standard access and the user explicitly approves a test publication.

## Confirmed external configuration

- Pinterest application Trial access is active.
- The OAuth redirect URI is exactly `https://app.vezdepost.ru/integrations/social/pinterest`.
- The application can request `boards:read`, `boards:write`, `pins:read`, `pins:write`, and `user_accounts:read`.
- The initial connection is for validation under Trial access. Standard access is a separate follow-up.

## Scope

### Included

- Preserve Pinterest's rotated continuous refresh token.
- Add required Pinterest credentials to the tracked production Compose configuration.
- Add automated coverage for refresh-token rotation and production configuration.
- Add a guarded, numbered production deployment script.
- Configure credentials through hidden terminal prompts.
- Recreate only the `postiz` service.
- Verify OAuth, account visibility, board discovery, and an unpublished draft.

### Excluded

- Public Pin creation under Trial access.
- Pinterest Standard-access approval.
- Changes to other social providers or services.
- Any broader provider refactor.

## Application change

`PinterestProvider.refreshToken` will accept the optional `refresh_token` returned by Pinterest. It will return that new token to the integration service when present and fall back to the existing refresh token when Pinterest omits it. The existing integration service already persists the provider's returned token, so no database or repository change is required.

The refresh request remains limited to the provider's existing Pinterest scopes. No additional permissions are introduced.

## Production configuration

The tracked production Compose override will pass through two required values from the untracked server `.env`:

- `PINTEREST_CLIENT_ID`
- `PINTEREST_CLIENT_SECRET`

Real values must never be committed, printed, placed in command arguments, or pasted into chat. The deployment workflow accepts them only through hidden interactive prompts and reports only `set` or `missing` status.

## Guarded deployment flow

A new numbered script will:

1. Acquire the existing Vezdepost autodeploy lock.
2. Prompt separately and invisibly for the Pinterest client ID and client secret.
3. Create timestamped backups of every production configuration file it changes.
4. Update the untracked `.env` atomically and preserve restrictive permissions.
5. Wait for and deploy one exact expected Git SHA.
6. Validate Compose before changing the running service.
7. Back up the current application image and revision.
8. Build and recreate only `postiz`.
9. Verify the application container, public API, Temporal worker, and Pinterest environment-variable presence without printing values.
10. Restore configuration, revision, and image if deployment or health verification fails.

The script does not restart Docker, recreate unrelated services, start OAuth, create drafts, or publish Pins.

## OAuth validation flow

After deployment, the user starts Pinterest connection from production Vezdepost and completes Pinterest authorization in their own browser session. Success requires all of the following:

- OAuth returns to the exact production callback without an error.
- The Pinterest Business account appears in Vezdepost Integrations.
- Vezdepost loads the account's available boards.
- A Pinterest draft can be prepared with a selected board, image, title, description, and optional destination link.
- The draft remains unpublished.

Trial access is recorded as an external limitation. The production-public Definition of Done is completed only after Standard access is granted and a public test is separately approved.

## Error handling and rollback

- Missing credentials stop before Compose or service changes.
- Invalid Compose stops before service changes.
- A failed build or health check triggers rollback to the previous configuration, revision, and image.
- OAuth failures are diagnosed from redacted status and logs; tokens, authorization codes, cookies, and secrets are never displayed.
- A failed OAuth attempt does not cause repeated production configuration changes unless diagnostics identify configuration as the cause.

## Verification

Automated checks cover:

- A rotated Pinterest refresh token is returned and therefore persisted.
- The previous refresh token is retained when the response omits a replacement.
- Production Compose requires and passes both Pinterest variables.
- The guarded script's backup, validation, service scope, redaction, health checks, and rollback behavior.

Operational checks cover:

- Both Pinterest variables are set in the `postiz` container without revealing values.
- Only `postiz` is recreated.
- Public API and worker checks pass.
- OAuth completes, the account is visible, and boards load.
- A valid unpublished draft can be created.

## Completion boundary

This phase is complete when the Pinterest provider is enabled in production, credentials and callback match, OAuth succeeds, the intended test Business account and its boards are visible, and an unpublished draft can be created. Public publishing remains intentionally pending Pinterest Standard access and explicit user confirmation.
