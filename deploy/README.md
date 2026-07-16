# Deploy (prod-only)

Server: 201.51.7.50 (`~/postiz-app`, branch `prod`).

- `autodeploy.sh` — polls `origin/prod` every 3 minutes (cron `/etc/cron.d/vezdepost-autodeploy`), on new commits: `git reset --hard` + `docker compose up -d --build`. Log: `/var/log/vezdepost-autodeploy.log`.
- `docker-compose.override.yaml` (repo root, tracked in prod only) — server config; secrets come from untracked `.env` (`JWT_SECRET`, `TELEGRAM_TOKEN`, `MAX_TOKEN`).
- `wait-temporal.js` (repo root) — gates app startup until temporal accepts connections.
- Temporal UI: `ssh -L 8080:127.0.0.1:8080 root@201.51.7.50` → http://localhost:8080

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

This directory lives only on the `prod` branch — do not merge it into `main`.
