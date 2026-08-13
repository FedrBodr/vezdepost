# Tumblr production OAuth configuration

## Goal

Enable the existing official Tumblr provider in production Vezdepost without
changing provider code or publishing public content. The first OAuth connection
will use the operator's Tumblr account for an infrastructure test; AhMiranami can
later authorize the same Vezdepost application with its own Tumblr account.

## Existing implementation

Vezdepost already registers the `tumblr` provider. It uses Tumblr OAuth 2 with
the `write` and `offline_access` scopes, lists blogs available to the authorized
account, and uses this exact callback:

`https://app.vezdepost.ru/integrations/social/tumblr`

Production currently has neither `TUMBLR_CLIENT_ID` nor
`TUMBLR_CLIENT_SECRET` in `.env` or the running `postiz` container. The base
Compose file declares both variables, but the production override does not pass
their values through.

## Selected approach

Add a numbered, self-contained production script. The script contains no
credentials and is copied to the server only for execution. It will:

1. Validate that `/root/postiz-app`, `.env`, and
   `docker-compose.override.yaml` exist.
2. Read the Tumblr client ID and client secret from hidden terminal prompts.
3. Create timestamped, mode-preserving backups of both configuration files.
4. Upsert both values in `.env` without printing them.
5. Add required `${TUMBLR_CLIENT_ID:?set in .env}` and
   `${TUMBLR_CLIENT_SECRET:?set in .env}` entries to the `postiz` environment in
   the production Compose override.
6. Validate the rendered configuration with `docker compose config --quiet`.
7. Recreate only `postiz` with `docker compose up -d --no-deps --force-recreate
   postiz`; no image rebuild or whole-stack restart is needed.
8. Verify the container receives both non-empty variables, ports 3000, 4200 and
   5000 are listening, the public unauthenticated API does not return 502, and a
   Temporal workflow poller is registered on task queue `main`.

If validation fails before recreation, the script restores both backups. If
runtime readiness fails after recreation, it reports the failure and preserves
the backups for explicit recovery rather than restarting unrelated services.

## Credential handling

The client secret must never appear in chat, command arguments, shell history,
logs, Git, or terminal output. Both credentials are entered through hidden
prompts in the operator's own terminal. The server `.env` remains untracked and
mode `600`. Status checks may report only whether each variable is set.

## Acceptance criteria

- The Tumblr application has the exact production callback registered.
- Both Tumblr environment variables are set in `.env` and the `postiz`
  container.
- Only `postiz` is recreated and all readiness checks pass.
- Tumblr OAuth completes in production Vezdepost.
- The authorized account's blogs are returned and the selected test blog is
  visible in Integrations.
- A valid draft can be created without public publication.
- No public test post is published without explicit approval.

