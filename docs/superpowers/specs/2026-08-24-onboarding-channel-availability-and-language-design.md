# Onboarding channel availability and language design

**Date:** 2026-08-24

## Goal

Make the first-run channel picker honest and consistently localized:

- expose language selection before registration and preserve the selected or
  detected locale;
- prevent Russian fallback copy from appearing in non-Russian channel pickers;
- distinguish channels that the Vezdepost deployment can currently connect
  from adapters that exist in the codebase but are not production-enabled;
- let an authenticated user request an unavailable channel without starting a
  connection flow;
- measure demand as unique users per platform and notify the Vezdepost owner
  through PostHog when a platform reaches ten unique requests.

No database migration, Telegram notification, application email delivery, or
dynamic administration UI is part of this change.

## Selected approach

Use an additive backend catalogue flag backed by an explicit deployment-wide
allowlist. The backend remains the authority for whether a new connection may
start, while the frontend keeps every adapter visible and renders unavailable
ones as demand-generating request cards.

This is preferred over a frontend-only allowlist because direct OAuth and API
entry points must enforce the same policy. It is preferred over credential
inference because provider readiness also depends on external approval, scopes,
shared credentials, and user-supplied settings. A database feature flag and
request table would provide richer administration and exact notification state
but add unnecessary migration and operational surface for the current static
deployment policy.

## Deployment availability policy

Add the private server environment variable `ENABLED_SOCIAL_INTEGRATIONS`.

Its contract is:

- absent, empty, or whitespace-only means every registered social provider can
  be connected, preserving existing self-hosted behavior;
- a non-empty value is a comma-separated list of exact provider identifiers;
- entries are trimmed and normalized to lowercase;
- duplicates collapse;
- registry order, not environment-variable order, controls catalogue order;
- unknown entries are ignored while valid entries remain enabled, so
  `telegram,typo` enables Telegram and warns about `typo`;
- unknown entries produce one safe warning per process/config parse without
  crashing the process;
- removing a provider from the allowlist blocks new connections and manual
  reconnects but does not remove existing integrations or stop their scheduled
  posts.

The tracked Vezdepost production override starts with this conservative set:

```text
telegram,max,vk,vk-group,x,linkedin,tumblr
```

These providers have tracked production configuration or rollout evidence.
Enabling another provider requires hosted verification followed by an explicit
allowlist update. Production documentation must record that operational step.
Pinterest remains request-only initially: the tracked rollout proves Trial
OAuth configuration but not public readiness for arbitrary Vezdepost users.

The upstream `docker-compose.yaml` forwards an optional value with a blank
default, while `docker-compose.override.yaml` contains the exact non-secret
Vezdepost list. `.env.example` documents syntax and default-all behavior.
Production preflight confirms that credentials required by allowlisted
credential-backed providers, including both X values, are present without
printing them.

## Backend catalogue and enforcement

Keep `socialIntegrationList` complete. It remains the provider-adapter registry
used by posting, refresh, capabilities, and existing integrations.

Add a focused pure allowlist parser beside the integration manager. The parser
receives the raw environment value and registered identifiers and returns the
allowed subset plus unknown entries suitable for one warning. Keeping parsing
pure makes whitespace, duplicates, unknown values, and default behavior easy to
test without mutating global process state.

`IntegrationManager.getAllowedSocialsIntegrations()` returns the configured
subset. The existing connection guards that consume this method therefore
become authoritative at all current boundaries:

- normal OAuth or custom-field connection start;
- social callback and custom-field connection completion;
- public API connection start;
- enterprise connection handoff.

Two additional completion paths require explicit guards:

- `IntegrationService.saveProviderPage()` checks the loaded integration's
  provider after ownership lookup and before provider page calls or
  persistence, covering both two-step completion routes;
- `NoAuthIntegrationsController.extensionRefreshCookies()` checks the provider
  before calling its extension `authenticate()` method.

Automated token-refresh jobs and publishing workflows remain allowed for
existing integrations. User-initiated OAuth refresh, extension refresh,
two-step completion, and manual reconnect are blocked while a provider is
outside the allowlist. A registered-but-unavailable provider returns a
consistent non-2xx denial before provider code or state mutation.

`IntegrationManager.getAllIntegrations()` still returns every catalogue item
in its current order and adds:

```ts
{ canConnect: boolean }
```

`canConnect` describes deployment permission to create or reconnect a channel.
It deliberately does not reuse `disabled`, which already describes a stored
integration instance.

The frontend treats only explicit `canConnect === false` as unavailable. An old
backend that omits the property therefore remains compatible with the new
frontend.

Existing connected integrations remain available to listing, publishing,
refresh, capability resolution, and workers. The implementation must not
filter the adapter registry or integration database queries.

## Channel-picker behavior

The normal authenticated web/onboarding catalogue keeps every provider and its
existing order. Invite and embedded-mobile exceptions are defined below.

For `canConnect !== false`:

- preserve the current card markup, tooltip, styles, click analytics, and
  connection behavior;
- do not add a new visual badge or intermediate interaction.

For `canConnect === false` on authenticated web and onboarding surfaces:

- dim the icon and provider-name content while keeping the request control
  legible;
- remove the card-level connection handler;
- render a compact localized `Request` button;
- clicking the card body performs no fetch, navigation, OAuth-state creation,
  or connection analytics;
- clicking `Request` sends the demand event only;
- after a successful or analytics-failed click, change the button text to the
  localized `Requested` state until the picker is closed;
- the requested state prevents duplicate events from the same mounted picker;
- analytics failure never blocks the requested-state feedback.

Use a real `button type="button"` with an accessible label containing the
provider display name. Dim only presentation; do not use the HTML `disabled`
attribute on the whole card because the request action remains interactive.

Extract a small channel-picker card component so enabled and unavailable
rendering can be tested without the connection form and provider-specific
branches in `AddProviderComponent`.

Unavailable providers are omitted from invite mode because requesting a new
hosted provider is unrelated to creating an invite link. On the authenticated
embedded-mobile provider surface, unavailable cards are dimmed but the request
button is hidden for this iteration: that layout does not currently initialize
PostHog and user identity equivalently, so device or anonymous IDs would
corrupt the agreed unique-user metric. The request action in this iteration is
therefore specifically a desktop-web and onboarding feature.

The existing generic footer remains. It continues to offer email contact when
the desired platform is absent from the catalogue entirely. Unavailable cards
do not open email or Telegram and do not reuse `ChannelSupportLink`.

## Demand analytics

Extend the existing channel-connect analytics request source with
`unavailable_channel` and emit:

```text
platform_request_clicked
{
  platform: "<stable-provider-identifier>",
  source: "unavailable_channel"
}
```

The platform property always uses the backend identifier, never translated
display copy. `useFireEvents` already identifies an authenticated web user by
the internal `user.id` before capture; PostHog can therefore aggregate Unique
users even if a user opens the picker more than once. The mounted picker also
suppresses repeated events as immediate interaction feedback, but PostHog
identity is the source of truth for uniqueness across sessions.

Call `posthog.reset()` before explicit client logout and client-side auth-loss
redirects so a later user on the same browser cannot inherit the previous
user's distinct ID. This identity reset is part of the metric-correctness scope
and receives focused logout/session-invalidated tests.

Wrap capture with the existing analytics safety helper. An analytics exception
must not escape, start a connection, prevent UI feedback, or produce an email
or Telegram request.

The generic footer keeps its existing `platform: "unspecified"` and
`source: "channel_picker"` event. This keeps generic missing-platform demand
separate from requests for a known but unavailable adapter.

## PostHog insight and threshold alert

Create and save a Trends insight with:

- event `platform_request_clicked`;
- filter `source = unavailable_channel`;
- aggregation `Unique users`;
- breakdown `platform`;
- date range `All time`.

This breakdown insight is the authoritative demand dashboard; it is not used
directly for independent per-platform alerts. For each platform currently
monitored, create an explicit platform-filtered, non-time-series All-time
aggregate insight or series using the same event, source filter, and Unique
users aggregation. Configure an absolute threshold alert for that explicit
series and subscribe the Vezdepost PostHog user. PostHog uses a
strict-greater-than comparison, so the upper bound is `9` to notify at ten
unique users. A time-series alert is unsuitable because it evaluates an
interval rather than lifetime cumulative demand.

Native PostHog alerts do not keep independent one-shot state for every value in
a breakdown. Current insight-alert behavior re-notifies at every scheduled
check while a cumulative metric remains breached, with no cooldown, and the
free tier currently limits the organization to five alerts. For this
iteration:

1. use the breakdown insight to identify platform demand;
2. create explicit platform-filtered aggregate series/insights and alerts for
   up to the available organization limit;
3. promptly disable a platform's alert after its first threshold email to stop
   repeated notifications;
4. use the dashboard to rotate the limited alert slots to the next candidate
   platforms;
5. document the procedure and configured recipient in the production runbook.

Alert delivery is asynchronous at PostHog's configured check cadence, not on
the request click. Subscribers also receive an in-app notification. Exact
automatic fire-once-per-platform behavior for an unlimited number of platforms
would require external state or automation and is explicitly deferred.

## Localization repair

The mixed-language onboarding footer is caused by missing catalogue keys, not
random locale selection. `missing_platform_prompt` and
`missing_platform_email` are absent from every catalogue, and their inline
fallbacks are Russian. Consequently every non-Russian locale renders the same
Russian footer.

Keep the existing keys, change their inline defaults to English, and add
reviewed values to all 14 configured locales from `i18n.config.ts`:

```text
en, he, ru, zh, fr, es, pt, de, it, ja, ko, ar, tr, vi
```

Preserve the current Russian meaning in the Russian catalogue. Do not update
the dormant `bn` or `ka_ge` files unless they are separately restored to the
configured language list.

Use these exact keys and canonical English/Russian values:

| Key | English | Russian |
| --- | --- | --- |
| `missing_platform_prompt` | `Can't find the platform you need?` | `Не нашли нужную платформу?` |
| `missing_platform_email` | `Email us — we'll try to add it.` | `Напишите нам — постараемся добавить.` |
| `request_platform` | `Request` | `Запросить` |
| `platform_requested` | `Requested` | `Запрошено` |

Add reviewed equivalents to the other 12 configured catalogues. English is the
safe inline fallback for every key.

The generic email link currently produces a Russian mail subject in every
locale. Localize both subject variants across the same 14 catalogues using the
exact keys `request_new_platform_email_subject` and
`provider_connection_help_email_subject`, with provider interpolation for the
connection-help variant. Canonical English copy is `Request a new platform in
Vezdepost` and `Can't connect {{platform}} in Vezdepost`; canonical Russian copy
preserves the existing subjects. This repairs localization without changing
the recipient or link behavior.

## Language selection before registration

Mount the shared language selector in the common auth layout so it appears on
registration, login, password recovery, account activation, and related auth
routes. Put the logo and language trigger in a shared header row rather than
duplicating controls in individual forms.

The existing selector depends on the modal infrastructure mounted on
authenticated surfaces. Wrap the auth subtree with the established
`MantineWrapper`/modal renderer so the selector opens there as well.

Harden the shared language component before exposing it on auth pages:

- use a native button for the trigger and each language option;
- give the trigger the localized `change_language` accessible name and
  `aria-haspopup="dialog"`;
- expose the selected option with `aria-pressed`;
- provide a visible focus state and a minimum 44-by-44-pixel trigger target;
- use a two-column option grid on narrow screens and four columns when space
  permits;
- constrain the modal to the viewport instead of relying on its current
  desktop minimum width;
- set both `document.documentElement.lang` and `dir` after selection.

Pass language-specific responsive `size`/`maxSize` values rather than changing
the default width of every modal. Add missing dialog semantics through additive
shared-modal metadata: `role="dialog"`, `aria-modal="true"`, a title ID
referenced by `aria-labelledby`, initial focus within the last-open modal,
focus containment, and restoration to the language trigger on close. Cover the
authenticated header and billing callers with regression tests because they
reuse the hardened trigger. Country flags are decorative; the native language
name is the accessible option label.

The existing `change_language` key and native language names from
`Intl.DisplayNames` avoid new selector-specific catalogue work. The desktop
auth social-proof headline is currently hard-coded English; render it through a
small client component using the existing translated billing social-proof keys.
Auth testimonials remain authored content and are not machine-translated in
this change.

Server-rendered auth messages must not use the process-wide resolved i18next
language. Add a request-locale-aware fixed translator helper that accepts the
locale resolved from the cookie/header while leaving existing callers
compatible. Auth server pages use that explicit locale, so disabled-registration
and other server-only messages render correctly after a locale selection or
reload.

## Locale detection and persistence

The application proxy already detects a supported language from the request,
but currently writes the result as a plain response header named `i18next`.
The app layout reads a cookie, so the detected locale is lost and the first
render falls back to English.

Persist both detected and manually selected locales as the configured
`i18next` cookie for 365 days, with root path, `SameSite=Lax`, host-only scope,
and `Secure` in secured production. It remains readable by the client because
manual selection updates it. A valid existing language cookie has priority.
Unsupported or invalid locale values fall back to English.

Use the forwarded `x-i18next-current-language` request header as the
server-render fallback for the first response, and set both root HTML `lang`
and `dir` attributes consistently before paint. Manual selection updates the
same cookie, `lang`, and RTL/LTR direction immediately and survives browser
restart.

Cross-subdomain transfer of the separate static landing-page local-storage key
is not part of this change. Visitors can choose their language directly on the
auth surface, while first-time browser-language detection supplies a sensible
default.

## Error handling and compatibility

- Missing allowlist configuration preserves all-enabled behavior.
- Unknown identifiers are ignored and never widen access beyond valid entries
  in the same configured list.
- Catalogue order and existing item fields remain unchanged.
- A new frontend tolerates an old backend that omits `canConnect`; an old
  frontend may still attempt a newly unavailable connection, but the new
  backend denies it authoritatively.
- Analytics errors are swallowed only around capture and cannot change
  connection policy.
- The requested UI state is local and requires no persistence or retry.
- A provider removed from the allowlist cannot reconnect until an operator
  restores it; existing scheduled publishing remains unaffected.
- Locale storage and browser APIs must fail safely to English/LTR without
  preventing auth pages from rendering.

## Testing

### Availability policy and backend

- pure parser tests for absent, blank, whitespace, duplicate, mixed-case,
  unknown, and valid identifiers;
- integration-manager tests proving default-all and configured-subset
  catalogue flags without filtering or reordering;
- connection-boundary tests proving unavailable providers stop before auth URL
  generation, Redis state, authentication, or persistence;
- regression tests proving existing integrations remain listable and provider
  adapters remain available to non-connection workflows;
- production-config tests for the exact Vezdepost allowlist and the upstream
  blank/default-all contract.

### Channel picker and analytics

- enabled cards retain their current click and connection behavior;
- unavailable card-body clicks do nothing;
- `Request` emits exactly one provider-specific event with
  `source: unavailable_channel`;
- request clicks do not emit connection analytics, fetch, navigate, open
  `mailto:`, or invoke backend/Telegram notification logic;
- an analytics exception does not escape and still renders `Requested`;
- unavailable providers are excluded from invite mode;
- mobile unavailable cards have no request action;
- generic footer email and unspecified-platform analytics remain intact;
- accessible name, focusability, dimmed styling, requested feedback, narrow
  layout wrapping, and the onboarding nine-column grid are covered.

### Localization and auth

- every configured locale contains non-empty missing-platform, request, and
  requested strings;
- every configured locale contains both localized mail-subject keys and the
  provider interpolation remains intact;
- English and Russian values match reviewed copy and inline fallbacks are
  English;
- unauthenticated auth routes render a working language trigger and modal;
- trigger and options are keyboard-operable native buttons;
- the language modal exposes dialog labelling, traps focus while open, and
  restores focus to its trigger on close;
- selecting Russian updates translated form and social-proof copy, the cookie,
  and `html[lang=ru][dir=ltr]`;
- selecting Hebrew or Arabic sets RTL;
- valid cookie priority, first-request `Accept-Language` persistence,
  unsupported-locale fallback, 365-day attributes, and browser-restart
  persistence are covered;
- server-only auth messages use the request locale rather than process-global
  i18next state;
- first-render Hebrew and Arabic set both the correct `lang` and RTL `dir`
  without an LTR flash;
- explicit logout and client auth-loss paths reset PostHog identity before
  redirect;
- 375-pixel and desktop browser smoke checks prove the selector stays inside
  the viewport on register, login, password recovery, and activation routes.

Run focused tests first, then root workspace verification and the relevant
frontend/backend build or typecheck commands. No completion claim is made until
all verification output is fresh and passing.

## Acceptance criteria

- An English first-run picker contains no Russian fallback copy.
- A visitor can change language before registering and the choice survives a
  reload across auth routes.
- The normal Vezdepost web/onboarding picker displays every registered provider
  but clearly dims the ones outside the production allowlist; invite and mobile
  behavior follows their documented exceptions.
- Enabled providers connect exactly as before.
- Unavailable providers cannot start or complete a connection through any
  guarded backend entry point.
- A web user can request an unavailable provider without email, Telegram,
  navigation, or OAuth activity and sees immediate `Requested` feedback.
- PostHog records the stable provider identifier and counts the authenticated
  user once in the Unique-users breakdown.
- The saved dashboard exposes cumulative demand per provider, and each
  explicitly monitored filtered aggregate notifies the subscribed owner at ten
  unique requests, subject to the stated native PostHog alert and organization
  limit constraints.
- Existing connected providers continue posting after their adapter is removed
  from the connection allowlist.
- Self-hosted deployments without the new environment variable retain current
  all-enabled behavior.

## Deferred work

- automatic one-shot notification state per platform;
- Telegram or application email delivery;
- database-backed availability administration;
- identified request analytics in the embedded mobile provider layout;
- automatic transfer of the static landing-page language preference to the app
  subdomain;
- translation or locale-specific hiding of authored testimonial quotations.
