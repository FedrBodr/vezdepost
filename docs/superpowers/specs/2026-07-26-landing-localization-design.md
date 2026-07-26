# Vezdepost Landing Localization Design

## Goal

Localize the complete `https://vezdepost.ru/` landing page into Russian and
English. On a visitor's first visit, select a language from the browser locale.
After a visitor chooses a language explicitly, preserve that choice and give it
priority over future locale detection.

The localization covers all visible copy and all language-dependent metadata,
including navigation, the calendar preview, pricing, FAQ, services, footer,
accessibility labels, the document title, description, and Open Graph fields.

## Existing Context

The landing page is a self-contained static document at
`deploy/landing/index.html`. Caddy serves the directory directly without a build
step. Existing Yandex Metrica and Google Tag Manager integration must keep
working, and the existing CTA goal names must not change.

## Approach

Keep one HTML document and add a small inline localization layer. A `ru`/`en`
translation dictionary is the single source for every language-dependent
string. Translatable elements refer to dictionary keys, and the localization
script applies the selected language to text, attributes, and metadata.

This keeps the current deployment model and avoids duplicated Russian and
English DOM trees. Separate `/ru/` and `/en/` pages are out of scope because the
landing does not currently need language-specific URLs and they would add Caddy
configuration and duplicated markup.

## Language Selection

The selection order is:

1. Read `vezdepost-language` from `localStorage`. If its value is exactly `ru`
   or `en`, use it.
2. Otherwise inspect the visitor's first browser locale from
   `navigator.languages[0]`, falling back to `navigator.language`.
3. Select Russian when the locale's primary language is `ru`.
4. Select Russian when the locale region is one of `RU`, `BY`, `KZ`, or `KG`,
   regardless of its primary language.
5. Select English for every other locale, including missing, malformed, or
   unsupported values.

Locale matching is case-insensitive. The implementation may use `Intl.Locale`
when available, but must retain a simple tag-parsing fallback for older
browsers.

A manual selection takes effect immediately, is saved under
`vezdepost-language`, and remains authoritative on subsequent visits. If storage
access throws or is unavailable, switching still works for the current page
view without breaking the landing.

## Rendering and Page State

Russian remains the semantic no-JavaScript fallback in the HTML. During normal
JavaScript loading, the document hides its localized content only until the
initial language has been applied. This prevents an English visitor from seeing
a flash of Russian content. The reveal must happen even if locale parsing or
storage access fails, using English as the runtime fallback in those failure
cases.

Applying a language updates:

- every visible localized text node;
- `document.documentElement.lang`;
- the document title and description;
- Open Graph title and description;
- accessibility attributes such as the calendar preview `aria-label`;
- localized calendar headings, post examples, captions, and footnotes;
- the language switcher's active and accessible state.

Language changes do not reload the page, alter the URL, or change the current
scroll position.

## Language Switcher

Add a compact `RU / EN` control to the sticky header before the primary
application CTA. Both options remain visible on desktop and mobile while the
existing navigation-link hiding behavior stays unchanged.

The control uses real buttons. The active option is visually distinct and
exposes its state with `aria-pressed`. The control has an accessible label in
the currently active language and supports keyboard operation through native
button behavior.

Its responsive styles must fit alongside the existing Vezdepost logo and CTA at
the current mobile breakpoint without clipping or horizontal scrolling.

## Analytics

Keep all current Metrica goals unchanged:

- `cta_app_click`;
- `github_click`;
- `services_click`;
- `tg_footer_click`.

When a visitor manually changes the language, send a new
`language_switch` goal when `ym` is available. Include the selected language as
goal parameters, for example `{ language: "en" }`. Analytics availability must
never affect switching or persistence.

## Translation Content

Both dictionaries contain an identical set of keys. English copy translates
the full meaning and preserves the landing's established modest, factual tone.
It must retain the existing product claims and the decisions documented in
`docs/PROJECT.md`, including:

- no use of the equivalent of “salary” in pricing copy;
- subscription language limited to infrastructure costs unless the project
  genuinely grows;
- “founding engineer” in the relevant FAQ answer;
- AI development under the supervision of an experienced practicing engineer;
- the complete seven-day MVP/services offer;
- MAX and Vezdepost product names unchanged.

Platform and company names remain untranslated. Links and destinations remain
the same in both languages.

## Failure Handling

All browser-only APIs are treated as optional:

- invalid stored values are ignored;
- malformed or missing locales fall back to English;
- `localStorage` read/write errors are caught;
- missing `Intl.Locale` uses fallback parsing;
- missing Metrica skips only the analytics event;
- localization failures must still reveal a usable page.

No network request is required to select or switch language.

## Testing

Add a Vitest specification for the static landing using the repository's
existing `jsdom` dependency. Tests cover:

- stored `ru` and `en` values overriding browser locale;
- Russian selection for the `ru` primary language;
- Russian selection for regions `RU`, `BY`, `KZ`, and `KG`;
- English selection for all other representative locales;
- malformed or absent locale fallback;
- unavailable or throwing storage;
- equal dictionary key sets and complete DOM bindings;
- immediate switching without navigation;
- successful persistence after a manual choice;
- updates to `html[lang]`, title, description, Open Graph metadata,
  accessibility attributes, and `aria-pressed`;
- `language_switch` analytics when Metrica exists and safe behavior when it
  does not;
- preservation of existing CTA analytics behavior.

Manual browser verification covers Russian and English at desktop and mobile
widths, the first-render flash prevention, header fit, keyboard interaction,
scroll-position preservation, and a reload after each saved manual choice.

## Acceptance Criteria

- Every visible and language-dependent non-visible string has reviewed Russian
  and English content.
- First visits use Russian for `ru` or regions `RU`, `BY`, `KZ`, and `KG`, and
  English otherwise.
- A manual choice persists and overrides later locale detection.
- Switching is immediate and accessible on desktop and mobile.
- Metadata and accessibility text match the active language.
- The landing remains usable when storage, locale parsing, or analytics APIs are
  unavailable.
- Existing navigation, links, responsive layout, GTM, and Metrica CTA goals
  continue to work.
- The production deployment remains a static Caddy-served landing with no new
  runtime dependency or server change.
