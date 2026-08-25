# Authenticated user lifecycle dashboard design

**Date:** 2026-08-25

## Goal

Measure how many authenticated Vezdepost users are new and how many return to
the protected application over time, then expose that lifecycle in a dedicated
PostHog dashboard.

The metric starts at deployment. Historical authenticated visits cannot be
reconstructed reliably because the application does not currently emit an
event whenever an authenticated user opens the protected application.

## Selected approach

Add a focused `authenticated_app_opened` PostHog event to the authenticated
application layout and use it as the activity event for a PostHog Lifecycle
insight.

This is preferred over filtering `$pageview` by a person email property because
the current application identifies a user only when selected custom product
events fire. A passive authenticated visit can therefore remain anonymous.
It is also preferred over `$identify`: that event primarily records the first
transition from an anonymous browser identity to a known user and does not
represent later returns.

## Event semantics

Emit:

```text
authenticated_app_opened
```

only after the protected application has resolved a valid authenticated user.
Identify the PostHog person with the existing internal user ID before capture,
using the same email and name properties already supplied by `useFireEvents`.

The event means "this known user opened the authenticated application", not
"the user submitted the login form". This distinction ensures that users who
remain signed in and return on a later day are still counted.

Capture once per authenticated layout mount. Reloads or multiple tabs may
produce duplicate events, but the dashboard aggregates unique users, so they do
not inflate the user counts. The integration must remain safe under React
effect re-execution in development and must not emit before user identity is
available.

Do not attach secrets, tokens, full URLs, or additional personal data to the
event. PostHog identity continues to use the established internal ID, email,
and display name. Existing logout and authentication-loss paths continue to
reset PostHog identity before redirecting.

Analytics failure must not block rendering, authentication, navigation, or any
product behavior.

## Application integration

Keep the change within the existing authenticated frontend layout and analytics
helpers. Prefer a small focused hook or component over adding tracking logic to
the login form, because an authenticated return does not necessarily execute a
login flow.

Add focused tests proving:

- no event is emitted without an authenticated user;
- PostHog is identified with the internal user ID before the event is captured;
- one authenticated layout mount captures `authenticated_app_opened`;
- analytics exceptions do not escape into application behavior;
- existing logout identity reset behavior remains unchanged.

No backend, database, environment, Telegram, email-delivery, or deployment
configuration change is required.

## PostHog dashboard

Create a separate dashboard named:

```text
Authenticated users — new and returning
```

Do not reuse filters, alerts, or draft state from `Unavailable channel demand`.

Create and save a daily Lifecycle insight with:

- event `authenticated_app_opened`;
- aggregation by unique users;
- interval `Day`;
- date range `Last 30 days`;
- lifecycle categories New, Returning, Resurrecting, and Dormant.

The Lifecycle insight is the primary view. `New` means the user's first
occurrence of this event is in the current interval. `Returning` means the user
was active in both the previous and current intervals. `Resurrecting` means the
user returned after at least one inactive interval. `Dormant` shows users who
were active previously but not in the current interval; it remains visible to
make the lifecycle accounting understandable even though the requested focus
is New and Returning.

Also add a Trends insight for daily unique users of
`authenticated_app_opened` over the same 30-day period. This gives a compact
total activity baseline alongside the lifecycle classification.

No alert is added. The existing unavailable-channel demand dashboard and its
alert remain unchanged, including the organization's alert-slot usage.

## Rollout and verification

Before deployment, run the focused analytics and layout tests plus the normal
frontend typecheck or equivalent project verification required by the final
implementation plan.

After production deployment:

1. open the protected application as a known user;
2. confirm `authenticated_app_opened` appears in PostHog with an identified
   person and without sensitive properties;
3. create the Lifecycle and Trends insights and add them to the new dashboard;
4. verify the dashboard filters, interval, date range, and saved URLs;
5. report the production commit, dashboard link, insight links, and the date
   from which the metric is valid.

The dashboard can initially show little or no data. That is expected until the
new production event has been received.

