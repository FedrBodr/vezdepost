# Deploy (prod-only)

Server: 201.51.7.50 (`~/postiz-app`, branch `prod`).

- `autodeploy.sh` — polls `origin/prod` every 3 minutes (cron `/etc/cron.d/vezdepost-autodeploy`), on new commits: `git reset --hard` + `docker compose up -d --build`. Log: `/var/log/vezdepost-autodeploy.log`.
- `docker-compose.override.yaml` (repo root, tracked in prod only) — server config; secrets come from untracked `.env` (`JWT_SECRET`, `TELEGRAM_TOKEN`, `MAX_TOKEN`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`).
- `wait-temporal.js` (repo root) — gates app startup until temporal accepts connections.
- Temporal UI: `ssh -L 8080:127.0.0.1:8080 root@201.51.7.50` → http://localhost:8080

## Hosted channel availability

The hosted Vezdepost connection allowlist is tracked in
`docker-compose.override.yaml` as:

`telegram,max,vk,vk-group,linkedin,tumblr`

The application still shows other registered adapters as request-only. X remains
request-only until production OAuth credentials and API credits are configured.
Pinterest remains request-only until Standard access and public readiness are
verified.
Unknown identifiers are ignored while valid identifiers remain enabled; a configured list containing only unknown identifiers fails closed and allows no new connections.
Adding a hosted provider requires both an end-to-end production connection check
and an explicit update to this tracked list and `deploy/production-config.spec.ts`.

After changing ENABLED_SOCIAL_INTEGRATIONS, restart or recreate the postiz service/container for the updated environment to take effect.

Before recreating `postiz`, validate required credentials and interpolation
without printing their values:

```bash
rtk docker compose config --quiet
```

X credentials are optional while X is request-only. Before adding X to the
hosted allowlist, configure both `X_API_KEY` and `X_API_SECRET` in the untracked
server `.env`, validate Compose, and verify the production OAuth flow.

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

### Unavailable-channel demand

Create a PostHog dashboard named `Unavailable channel demand`. Create the
saved Trends insight `Unavailable channel demand — all-time unique users`, add
it to that dashboard, and configure it with:

- event `platform_request_clicked`;
- event-property filter `source = unavailable_channel`;
- aggregation `Unique users`;
- event-property breakdown `platform`;
- date range `All time`.

This breakdown is the demand dashboard only. Do not attach one alert to the
breakdown and assume it tracks each platform independently: PostHog keeps one
alert state for the insight and can report only the first breaching breakdown.

For each platform selected for monitoring, create an explicit
platform-filtered non-time-series Trends aggregate using the same event,
`source = unavailable_channel`, `aggregation = Unique users`, and `All time`
date range. Add an event-property filter named `platform` and select the exact
stable identifier displayed for that provider in the saved breakdown dashboard.
Use a Bold number or another non-time-series aggregate; a time-series alert
evaluates an interval rather than lifetime cumulative demand.

Attach one absolute `has value` alert to each explicit platform aggregate:

1. set the upper bound to `9` because PostHog uses strict `>` comparison and
   must fire when the value becomes 10;
2. select the desired hourly or daily check cadence;
3. subscribe the Vezdepost owner's existing PostHog user so the owner receives
   email and in-app notification;
4. when the first threshold email arrives, disable the alert immediately,
   because a cumulative breached insight re-notifies on each scheduled check;
5. use the breakdown dashboard to assign the freed slot to the next candidate.

The free tier permits five alerts per organization, not per project. Alert
checks are asynchronous and do not fire synchronously on the tenth click.
Exact automatic one-shot notification for every platform requires external
state or automation and is intentionally not part of this deployment.

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

To deploy the tested Tumblr multipart implementation at one exact production
revision, copy script 18 and start it **before** pushing that revision to
`origin/prod`:

```bash
rtk scp -q -o BatchMode=yes -o ConnectTimeout=10 \
  docs/server-scripts/18-deploy-tumblr-multipart.sh \
  vezdepost:/tmp/vezdepost-deploy-tumblr-multipart.sh
rtk ssh -o BatchMode=yes -o ConnectTimeout=10 vezdepost \
  "bash /tmp/vezdepost-deploy-tumblr-multipart.sh <40-char-prod-sha>"
```

The remote script holds `/var/lock/vezdepost-autodeploy.lock` while it waits
for the expected SHA, preventing the cron deployment from racing it. After the
fast-forward push, it backs up the current `postiz-max:local` image, resets the
server checkout to that exact SHA, builds and recreates only `postiz`, and
checks the application ports, public API, Temporal worker, Tumblr environment
presence, and PostgreSQL attribute capacity. A failed deployment restores the
previous revision and image. It never publishes a Tumblr post.

If diagnostics confirm that the BuildKit exporter is stuck, and a production
Docker daemon restart has been explicitly approved, start the same guarded
deployment with `RESTART_DOCKER_BEFORE_BUILD=1`. This opt-in mode restarts the
Docker daemon while holding the autodeploy lock, verifies that it is active,
and waits for the Docker API before fetching or building the expected SHA. The
default is `0`; ordinary deployments never restart Docker.

This directory lives only on the `prod` branch — do not merge it into `main`.

## Pinterest

Use the exact OAuth callback URL:

`https://app.vezdepost.ru/integrations/social/pinterest`

The provider requests only `boards:read`, `boards:write`, `pins:read`,
`pins:write`, and `user_accounts:read`. Configure `PINTEREST_CLIENT_ID` and
`PINTEREST_CLIENT_SECRET` through the guarded script; enter both values only at
its hidden prompts.

Trial access is used to validate OAuth, the authenticated Business account,
board discovery, and an unpublished draft. Do not publish a public Pin until
Standard access is active and the user explicitly approves the test.

Copy the script first so that the interactive SSH session can use standard
input for the two hidden prompts. Start the guarded deployment before pushing
its expected revision to `origin/prod`:

```bash
rtk scp -q -o BatchMode=yes -o ConnectTimeout=10 \
  docs/server-scripts/19-deploy-pinterest-trial.sh \
  vezdepost:/tmp/vezdepost-deploy-pinterest-trial.sh
rtk ssh -tt -o BatchMode=yes -o ConnectTimeout=10 vezdepost \
  "status=0; bash /tmp/vezdepost-deploy-pinterest-trial.sh $(rtk git rev-parse HEAD) || status=\$?; rm -f /tmp/vezdepost-deploy-pinterest-trial.sh; exit \"\$status\""
```

The script backs up the production `.env`, checkout, and application image,
holds the autodeploy lock, validates Compose, and recreates only `postiz`. It
rolls all changed state back if verification fails and never publishes a Pin.

## Gated shared Caddy sites

Caddy remains the only public listener. It keeps the Vezdepost routes on
`postiz-network` and also joins the external `caddy-edge` network for isolated
co-hosted applications. Additional host blocks are imported from the
host-owned `/etc/caddy/sites` directory; deploys never place an application
hostname directly in the tracked base `deploy/Caddyfile`.

Before a Compose revision containing the import is deployed, the numbered
application provisioner must create `caddy-edge`, `/etc/caddy/sites`, and an
empty `/etc/caddy/sites/00-empty.caddy`. This makes the import glob valid while
keeping every new route disabled. A separate numbered route script may install
an application site only after its loopback readiness gate passes. That script
must validate Caddy, reload it, verify all existing Vezdepost probes, and remove
only its own site file if acceptance fails.

### Provision KSY before deploying the Caddy import

Stage the reviewed KSY Compose file and script 20 before the shared-edge commit
reaches `prod`:

```bash
rtk scp -q -o BatchMode=yes -o ConnectTimeout=10 \
  /Users/d.fedorenko/IdeaProjects/fedrbodr/ksy-deals/infra/docker-compose.yml \
  vezdepost:/tmp/ksy-deals-docker-compose.yml
rtk scp -q -o BatchMode=yes -o ConnectTimeout=10 \
  docs/server-scripts/20-provision-ksy-staging.sh \
  vezdepost:/tmp/20-provision-ksy-staging.sh
rtk ssh -tt -o BatchMode=yes -o ConnectTimeout=10 vezdepost \
  'status=0; bash /tmp/20-provision-ksy-staging.sh || status=$?; rm -f /tmp/20-provision-ksy-staging.sh; exit "$status"'
```

The script performs disk, immutable-digest and input validation before
mutation. Copy values from the Bitwarden note `KSY Deals / staging` only into
its hidden prompts. It atomically installs the root-only env and reviewed
Compose file, creates `caddy-edge` and the empty imported-site placeholder,
migrates the isolated database, and requires loopback liveness/readiness. A
failed replacement restores the previous KSY files and restarts its previous
image without touching Vezdepost or rolling migrations back.

Because the KSY repository and GHCR package are private, the note also contains
`GHCR_USERNAME` and a dedicated `GHCR_READ_TOKEN` with package-read access only.
The provisioner passes that token to `docker login ghcr.io` through standard
input, suppresses command output, and never writes it to the KSY application
env or deployment evidence. Do not reuse the package-publish credential.

After the shared-edge commit is the successful deployed `prod` revision and
both authoritative nameservers return `201.51.7.50`, activate the route:

```bash
rtk scp -q -o BatchMode=yes -o ConnectTimeout=10 \
  docs/server-scripts/21-enable-ksy-route.sh \
  vezdepost:/tmp/21-enable-ksy-route.sh
rtk ssh -o BatchMode=yes -o ConnectTimeout=10 vezdepost \
  'status=0; bash /tmp/21-enable-ksy-route.sh || status=$?; rm -f /tmp/21-enable-ksy-route.sh; exit "$status"'
```

Script 21 accepts only the exact authoritative A record, requires loopback and
Caddy-network readiness, installs only `/etc/caddy/sites/ksy-deals.caddy`, and
validates/reloads Caddy. It then requires KSY HTTPS `200` and the unchanged
Vezdepost `200/200/401` probes. Any failed acceptance restores the previous KSY
site state and reloads the last valid Caddy configuration.

Install KSY backup automation only after the private stack is ready:

```bash
rtk scp -q -o BatchMode=yes -o ConnectTimeout=10 \
  docs/server-scripts/22-install-ksy-backup.sh \
  vezdepost:/tmp/22-install-ksy-backup.sh
rtk ssh -o BatchMode=yes -o ConnectTimeout=10 vezdepost \
  'status=0; bash /tmp/22-install-ksy-backup.sh || status=$?; rm -f /tmp/22-install-ksy-backup.sh; exit "$status"'
rtk ssh -o BatchMode=yes -o ConnectTimeout=10 vezdepost \
  '/usr/local/sbin/ksy-deals-backup'
```

Script 22 refuses missing, placeholder or non-private KSY/B2 env files. The
installed wrapper calls only the `ksy-deals` maintenance backup service and
uploads only the new encrypted `.dump.gpg` to the separate B2 `ksy-deals/`
prefix. Acceptance still requires a disposable `ksy_deals_restore` restore;
upload success alone is insufficient.
