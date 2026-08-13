# Deploy (prod-only)

Server: 201.51.7.50 (`~/postiz-app`, branch `prod`).

- `autodeploy.sh` — polls `origin/prod` every 3 minutes (cron `/etc/cron.d/vezdepost-autodeploy`), on new commits: `git reset --hard` + `docker compose up -d --build`. Log: `/var/log/vezdepost-autodeploy.log`.
- `docker-compose.override.yaml` (repo root, tracked in prod only) — server config; secrets come from untracked `.env` (`JWT_SECRET`, `TELEGRAM_TOKEN`, `MAX_TOKEN`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`).
- `wait-temporal.js` (repo root) — gates app startup until temporal accepts connections.
- Temporal UI: `ssh -L 8080:127.0.0.1:8080 root@201.51.7.50` → http://localhost:8080

## LinkedIn personal profiles

Create an application in the LinkedIn Developer Portal and enable
**Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn**. Add
this exact authorized redirect URL:

`https://app.vezdepost.ru/integrations/social/linkedin`

Put its Client ID in `LINKEDIN_CLIENT_ID` and Client Secret in
`LINKEDIN_CLIENT_SECRET` in the server `.env`. The personal integration asks
only for `openid profile w_member_social`. Never commit or print the Client
Secret.

## X

Create the app in the X Developer Console. Enable OAuth 1.0a and set the app
permission to **Read and write**. Configure this callback URL exactly:

`https://app.vezdepost.ru/integrations/social/x`

Put the app's **API Key** in `X_API_KEY` and its **API Key Secret** in
`X_API_SECRET`. Purchase API credits and set a spending limit in the X console
before connecting the channel. Never commit the real values or paste them into
chat or logs.

## PostHog

Set the public frontend values `NEXT_PUBLIC_POSTHOG_KEY` and
`NEXT_PUBLIC_POSTHOG_HOST` in the server `.env`. Analytics remains safely
disabled when either value is absent.

Apply the EU Cloud configuration through the numbered production script:

```bash
scp -q -o BatchMode=yes -o ConnectTimeout=10 docs/server-scripts/14-configure-posthog.sh vezdepost:/tmp/vezdepost-configure-posthog.sh
ssh -tt -o BatchMode=yes -o ConnectTimeout=10 vezdepost \
  'status=0; bash /tmp/vezdepost-configure-posthog.sh || status=$?; rm -f /tmp/vezdepost-configure-posthog.sh; exit "$status"'
```

Enter the `phc_` project token at the hidden prompt. The script updates `.env`
without printing the token, validates Compose, and recreates only `postiz`
without rebuilding the image. Copying first is required: piping the script into
`ssh` would occupy standard input and prevent the hidden remote prompt from
receiving the token.

## Tumblr

Register the Tumblr application with this exact OAuth callback URL:

`https://app.vezdepost.ru/integrations/social/tumblr`

Apply `TUMBLR_CLIENT_ID` and `TUMBLR_CLIENT_SECRET` through the guarded
production script:

```bash
scp -q -o BatchMode=yes -o ConnectTimeout=10 docs/server-scripts/16-configure-tumblr.sh vezdepost:/tmp/vezdepost-configure-tumblr.sh
ssh -tt -o BatchMode=yes -o ConnectTimeout=10 vezdepost \
  'status=0; bash /tmp/vezdepost-configure-tumblr.sh || status=$?; rm -f /tmp/vezdepost-configure-tumblr.sh; exit "$status"'
```

Enter the OAuth Consumer Key and secret key only at the hidden terminal
prompts. Never paste them into chat, command arguments, logs, or tracked files.
The script creates timestamped backups, validates Compose, and recreates only
`postiz` without rebuilding the image. It does not publish any Tumblr post.

This directory lives only on the `prod` branch — do not merge it into `main`.
