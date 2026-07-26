# PostHog production configuration design

## Goal

Configure the existing PostHog frontend integration on the Vezdepost production
VPS without committing or printing the project token, and make the operation
repeatable through the repository's numbered server-script workflow.

## Approach

Add `docs/server-scripts/14-configure-posthog.sh`. The script runs on the VPS,
defaults to `/root/postiz-app`, and obtains the PostHog project token from a
non-echoing TTY prompt. A non-interactive environment-variable input containing
a fake token is permitted for automated tests only. The ingestion host is fixed
to the EU project host, `https://eu.i.posthog.com`.

The script validates the `phc_` token shape before changing server state. It
atomically upserts `NEXT_PUBLIC_POSTHOG_KEY` and
`NEXT_PUBLIC_POSTHOG_HOST` in the untracked server `.env`, removes duplicate
definitions of those names, preserves every unrelated line, and leaves the file
with mode `600`. It never prints the token or the `.env` contents.

After updating `.env`, the script runs `docker compose config --quiet`, then
recreates only the `postiz` service without rebuilding dependencies. It verifies
inside the running container that the key is non-empty and the host has the
expected EU value, again without printing the key.

## Failure handling

- Missing TTY/non-interactive token input fails before modifying `.env`.
- An invalid token fails before modifying `.env`.
- A missing repository or `.env` update failure exits non-zero.
- Compose validation, recreation, or container verification failures exit
  non-zero and leave enough state for the same script to be rerun safely.
- Temporary files are removed on exit.

## Verification

A shell behavior test executes the real script against a temporary repository
and a stubbed `docker` executable. It proves validation happens before mutation,
existing configuration is replaced without duplicates, unrelated `.env` lines
are preserved, the token is absent from output, permissions remain `600`, and
the expected Compose validation/recreation/container checks are invoked.

Production verification checks the script exit code, the running container,
application readiness, and finally a real `channel_connect_clicked` event in
PostHog after a platform click.
