# Channel Connection Demand Analytics and Support CTA

## Goal

Measure which channel integrations users try to connect, measure where the
connection funnel fails, and give users a direct way to request help or a
missing platform. Make the existing X integration configurable in the
Vezdepost production deployment.

## Scope

- Capture channel-connection funnel events in PostHog.
- Enable PostHog independently of Stripe billing.
- Add a support email CTA to the channel picker and connection error state.
- Forward the existing X OAuth credentials into the production container.
- Document the exact X Developer Console configuration required by the current
  OAuth 1.0a implementation.

This change does not add an internal analytics dashboard, a database event
table, automatic support email delivery, or new social providers.

## Analytics Architecture

The frontend continues to use the existing `useFireEvents` hook and PostHog
provider. Event capture must no longer depend on `billingEnabled`; PostHog is
active whenever both `NEXT_PUBLIC_POSTHOG_KEY` and
`NEXT_PUBLIC_POSTHOG_HOST` are configured. If PostHog is not configured, the
application continues to work and event calls are harmless no-ops.

The connection funnel uses these events:

| Event | When it fires | Properties |
|---|---|---|
| `channel_connect_clicked` | A user clicks a channel tile | `platform`, `connection_type`, `invite`, `onboarding`, `mobile` |
| `channel_connect_started` | The backend successfully returns an OAuth/connection URL or the selected connection UI opens | `platform`, `connection_type`, `invite`, `onboarding`, `mobile` |
| `channel_connect_failed` | Starting the connection, completing the OAuth callback, or saving a two-step selection fails | `platform`, `stage`, `error`, `onboarding`, `mobile` where available |
| `channel_connect_completed` | The callback endpoint accepts the provider account, or a two-step provider is saved | `platform`, `onboarding` |
| `platform_request_clicked` | The user clicks the support email link | `platform`, `source` |

`connection_type` is one of `oauth`, `web3`, `external`, `custom_fields`, or
`browser_extension`. `stage` is one of `start`, `callback`, or
`two_step_save`. Error properties contain the existing user-safe error message,
not response bodies, credentials, OAuth codes, tokens, email contents, or stack
traces.

The existing generic `channel_added` event remains for backward compatibility.

## User Experience

The Add Channel modal gains a small support prompt below the provider grid:

> Не нашли нужную платформу? Напишите нам — постараемся добавить.

“Напишите нам” is a `mailto:fedrbodr@gmail.com` link. Its subject is
`Нужна новая платформа в Вездепосте`. Clicking it captures
`platform_request_clicked` with `platform: "unspecified"` and
`source: "channel_picker"`.

When a known provider cannot start or complete its connection, the error UI
keeps the original safe error message and adds:

> Не получилось подключить {platform}. Напишите нам — поможем с настройкой.

The email subject is `Не подключается {platform} в Вездепосте`. Clicking it
captures `platform_request_clicked` with the provider identifier and
`source: "connection_error"`.

The OAuth callback error screen must not redirect a logged-in user away after
three seconds, because that would make the support link difficult to use. It
instead provides an explicit return-to-channels action alongside the email
link.

All new visible strings go through the existing translation helper and use
Russian fallback copy for the Vezdepost deployment. The layout uses existing
colors, buttons, spacing, and typography; no new UI dependency is introduced.

## Error Handling

The initial provider request must check both the HTTP status and the returned
`url`. A non-OK response, `{ err: true }`, or missing URL opens a compact error
modal containing the safe error message and provider-specific support CTA, and
captures a `channel_connect_failed` event with `stage: "start"`.

OAuth callback and two-step-save failures keep the safe backend message already
shown by `ContinueIntegration`. Each failure is captured once. Successful
single-step and two-step connections each capture completion once before
navigating away.

PostHog failures must never block provider navigation, form submission, or
email-link navigation.

## X Production Configuration

The existing `XProvider` uses OAuth 1.0a with:

- API key from `X_API_KEY`;
- API key secret from `X_API_SECRET`;
- read-and-write app permission;
- production callback URL
  `https://app.vezdepost.ru/integrations/social/x`.

The tracked production Compose override passes `X_API_KEY` and
`X_API_SECRET` from the server's untracked `.env` into the `postiz` service.
They remain optional at Compose startup so deploying the rest of Vezdepost is
not blocked before X is configured; attempting to connect X without them uses
the normal provider-specific error UI and support CTA.

The same override passes `NEXT_PUBLIC_POSTHOG_KEY` and
`NEXT_PUBLIC_POSTHOG_HOST`. These are public frontend configuration values, but
their real production values remain in the untracked server `.env`. The
`.env.example` documents all four variables without real credentials.

X API credits and billing are configured in the X Developer Console. The
application does not attempt to purchase credits or manage X billing.

## Testing

Frontend tests cover:

- analytics calls are not gated by Stripe billing;
- a provider tile click emits the expected platform and connection-type data;
- a failed start emits `channel_connect_failed` and renders the support CTA;
- the channel picker email link has the expected recipient and subject;
- the callback success and failure paths emit exactly one terminal event;
- the callback error screen contains the provider-specific email link and an
  explicit return action.

Configuration verification covers `docker compose config` both with dummy X
values and with the optional values absent. No test or command prints real
production secrets.

## Success Criteria

- PostHog can show provider demand and click-to-connect conversion grouped by
  `platform` and failure `stage`.
- Users can contact `fedrbodr@gmail.com` from both the picker and a connection
  failure without manually constructing an email subject.
- Adding valid X API credentials to the server `.env` makes them available to
  the production application container.
- Existing channel connection paths still work when PostHog is not configured.
