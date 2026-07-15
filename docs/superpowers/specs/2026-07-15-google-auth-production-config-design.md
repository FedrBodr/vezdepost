# Google OAuth login configuration design

**Date:** 2026-07-15

## Goal

Configure account sign-in and registration through Google OAuth for
`https://app.vezdepost.ru` without coupling login credentials or callback URLs
to the YouTube social integration.

Success means that selecting **Continue with Google** opens a valid Google
consent screen, returns to Vezdepost, and either signs in an existing Google
user or continues registration for a new one.

## Current problem

The `GOOGLE` authentication provider currently constructs its OAuth client
from `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`. Its default redirect URI
is also the YouTube integration route:
`$FRONTEND_URL/integrations/social/youtube`.

Production has neither YouTube variable configured, so the authorization URL
is generated without `client_id`. Google rejects it with
`400: invalid_request` and `Missing required parameter: client_id`.

## Chosen approach

Give Google account authentication its own configuration:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- default redirect URI: `$FRONTEND_URL/auth?provider=GOOGLE`

The provider will prefer the new Google-specific variables. It will fall back
to `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` so existing self-hosted
installations continue to work until they migrate. The YouTube integration
itself remains unchanged.

Alternatives rejected:

1. Configure Google login through `YOUTUBE_*` only. This is the smallest
   production-only change, but preserves the misleading coupling and makes
   independent credential rotation impossible.
2. Use the generic OIDC provider. This replaces rather than repairs the
   existing Google button and would introduce unnecessary configuration and UI
   changes.

## Components and data flow

1. The existing frontend Google button requests `/auth/oauth/GOOGLE`.
2. The backend Google auth provider creates an OAuth client with the dedicated
   Google credentials and redirect URI.
3. Google redirects the browser to
   `https://app.vezdepost.ru/auth?provider=GOOGLE`, appending `code` and
   `state`.
4. The existing auth page exchanges the code through
   `/auth/oauth/GOOGLE/exists`.
5. The backend uses the same redirect URI for the token exchange, loads the
   user's Google profile and email, and continues the existing sign-in or
   registration flow.

Mobile or other callers that explicitly pass `redirect_uri` retain their
existing behavior.

## Configuration and rollout

Create or select a Google Cloud OAuth 2.0 client of type **Web application**.
Its authorized redirect URI must include exactly:

`https://app.vezdepost.ru/auth?provider=GOOGLE`

Store the client ID and client secret only in the untracked production `.env`.
The Compose override will pass them into the `postiz` container using required
variable interpolation. An idempotent numbered server script will verify that
the variables exist without printing their values, recreate only the affected
service, and confirm that the generated authorization URL contains a non-empty
`client_id` and the expected redirect URI.

The credentials must not be written to source files, git history, build
arguments, terminal output, or documentation.

## Error handling

The Google auth provider will fail locally with a clear configuration error if
neither the dedicated Google credential nor its compatibility fallback is
available. This prevents deployment from emitting a malformed Google URL whose
failure is only visible after leaving the application.

Production Compose will require both dedicated Google variables during
interpolation. A missing value will stop service recreation before the running
container is replaced.

## Testing and verification

Automated provider tests will cover:

- preference for `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`;
- compatibility fallback to the YouTube variables;
- the Google-specific default redirect URI;
- preservation of an explicitly supplied redirect URI;
- a clear failure when credentials are absent.

Repository-level checks will include the focused test suite plus the relevant
type/lint checks available for the changed backend files.

Production verification will confirm, without exposing secrets:

- both Google variables are present in the running container;
- `/api/auth/oauth/GOOGLE` produces a Google authorization URL with `client_id`;
- its decoded redirect URI equals the configured Vezdepost callback;
- a real browser sign-in returns to Vezdepost and establishes a session.

## Scope boundaries

This change does not enable Gmail API access, request mailbox permissions, or
modify YouTube channel integration. It only authenticates users through their
Google account using basic profile and email scopes.
