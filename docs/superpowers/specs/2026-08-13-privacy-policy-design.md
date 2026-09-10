# Vezdepost Privacy Policy Design

**Date:** 2026-08-13

## Goal

Publish a usable Russian-language privacy policy at
`https://vezdepost.ru/privacy` so it can be submitted to Pinterest and opened
by any visitor without authentication.

## Operator and public contact

- Operator: Федоренко Дмитрий Александрович, плательщик налога на
  профессиональный доход.
- INN: 772373964340.
- Public contact for privacy requests: `https://t.me/FedrBodr`, which is
  already published on the Vezdepost landing page.
- Date of birth, sex, citizenship, and place of birth are intentionally not
  published because they are unnecessary for identifying the operator.

## Selected approach

Create a standalone static page at `deploy/landing/privacy/index.html`. Caddy
already serves `deploy/landing` directly, so the directory index gives the
required clean `/privacy` URL without an application build or authentication.
The page will follow the landing site's colors, typography, logo, and responsive
layout.

Two alternatives were rejected:

1. A Next.js application route would live on `app.vezdepost.ru`, require a full
   container rebuild, and would not satisfy the requested apex-domain URL.
2. A single `privacy.html` file would expose `/privacy.html`, which is less
   suitable for the stable Pinterest URL already provided to the user.

## Policy content

The first published version will be concise but operational rather than a
placeholder label. It will state:

- what Vezdepost is and who operates it;
- categories of processed data: account and organization details, connected
  social-account identifiers and authorization tokens, posts and uploaded
  media, billing metadata, technical logs, cookies, and product analytics;
- purposes: account operation, scheduled publication, support, security,
  billing, diagnostics, and product improvement;
- disclosures to connected social platforms and service providers required to
  operate hosting, payments, analytics, and error monitoring;
- retention until account deletion or as required for service, security, and
  legal obligations;
- user rights to request access, correction, deletion, restriction, or revoke
  a connected platform through the published contact;
- that the policy may be updated, with the effective date shown on the page.

The page will avoid claims about exact storage regions or vendors that cannot
be proven from production configuration. It will also clarify that connected
platforms process data under their own policies.

## Product links

- Add a visible `Политика конфиденциальности` link in the landing footer.
- Replace the registration form's existing Postiz privacy URL with
  `https://vezdepost.ru/privacy` and open external legal links safely.
- Terms of Service are outside this change and remain unchanged.

## Verification and release

1. Add a failing static-page test that requires the clean privacy path, operator
   identity, INN, key policy sections, and a landing-footer link.
2. Implement the minimum page and link changes required for the test to pass.
3. Run the focused Vitest suite and the production configuration tests.
4. Validate the production Caddy configuration and HTML locally.
5. Commit and fast-forward the tested revision to `origin/prod`, which triggers
   the existing pull-based deployment.
6. Confirm the successful deployed revision on the server and verify public
   HTTP 200 plus expected operator content at
   `https://vezdepost.ru/privacy`.

## Scope boundary

This release supplies the public policy and correct links. It does not add a
cookie-consent banner, redesign the application, change data processing, or
serve as a substitute for a formal legal review.
