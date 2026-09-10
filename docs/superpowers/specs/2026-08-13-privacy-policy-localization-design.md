# Vezdepost Privacy Policy Localization Design

**Date:** 2026-08-13

## Goal

Provide complete Russian and English versions of the privacy policy at the
single stable URL `https://vezdepost.ru/privacy`, using the same language
detection and manual selection behavior as the Vezdepost landing page.

## Selected approach

Keep the privacy page as one standalone static document and embed its complete
RU/EN translation dictionaries and localization script in
`deploy/landing/privacy/index.html`.

This approach is selected because it preserves the URL already submitted to
Pinterest, keeps the policy available without authentication or an application
build, and follows the existing landing-page implementation. Separate locale
URLs would change the public contract, while extracting a shared JavaScript
asset would add deployment and regression surface for only two static pages.

## Language behavior

- Use the existing `vezdepost-language` local-storage key, so a choice made on
  the landing page is also respected by the privacy page and vice versa.
- Give a stored `ru` or `en` preference priority over browser locale.
- Select Russian for Russian-language locales and the conservative RU, BY, KZ,
  and KG region set already used by the landing page.
- Select English for all other and invalid locales.
- Place RU and EN buttons in the page header with an accessible language label
  and `aria-pressed` state.
- Apply a manual selection immediately and persist it when storage is
  available. The switch must continue working when storage is unavailable.
- Hide the initial Russian fallback markup until language application finishes,
  preventing the wrong language from flashing. Always reveal the page even if
  detection or storage throws.

## Translated content

Both dictionaries will contain complete, equivalent translations for:

- document title and meta description;
- navigation and return-to-home link;
- policy title and effective date;
- introductory description and operator identification;
- every heading, paragraph, and list item covering processed data, purposes,
  disclosure, retention and security, user rights, cookies and analytics,
  policy changes, and contacts;
- footer copy.

The operator's name and INN remain unchanged in both languages. The English
version will describe the operator as an individual registered in Russia under
the professional-income-tax regime without inventing a company name or address.
The Telegram privacy-request contact remains the same.

## Markup and script contract

- Plain-text nodes use `data-i18n`.
- Copy containing links or inline emphasis uses `data-i18n-html`; all values are
  static source-controlled strings, never user input.
- Metadata uses `data-i18n-content`.
- Accessible labels use `data-i18n-aria-label`.
- The page exposes a small `window.__privacyI18n` test surface containing
  `languageFromLocale`, `detectLanguage`, `getCurrentLanguage`,
  `applyLanguage`, and `translations`, mirroring the landing page's existing
  contract without coupling the two documents at runtime.

## Error handling

Local-storage reads and writes are guarded independently. Locale parsing falls
back to English for invalid values. The top-level initialization uses a
`try/finally`-style reveal guarantee so visitors never receive a permanently
hidden policy when a browser API is unavailable.

## Testing

Extend `deploy/landing/index.spec.ts` with a privacy-page JSDOM helper and tests
that prove:

- RU and EN dictionaries have matching non-empty keys;
- every bound translation key exists in both dictionaries;
- Russian and English render complete policy headings and body copy;
- title, meta description, document language, navigation labels, and button
  state update correctly;
- locale detection matches the landing page behavior;
- stored preference wins, manual selection persists, and storage failures do
  not break initialization or switching;
- operator name, INN, canonical URL, and Telegram contact remain present;
- excluded personal details such as the operator's birth date remain absent.

## Release

Only the static privacy document and its tests need to change. After focused
and full verification, fast-forward the tested commit into the current
`origin/prod`, wait for the production successful-revision marker, and verify
both RU and EN render from the public URL. No new dependency or application
container behavior is introduced.
