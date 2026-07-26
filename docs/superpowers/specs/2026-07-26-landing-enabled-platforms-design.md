# Landing enabled platforms

## Problem

The Vezdepost landing page uses the `hot` chip style to distinguish platforms
that are configured and available in the hosted production service. The page
currently highlights Telegram, MAX, and VK, but production also has working X
(Twitter) and LinkedIn integrations. Those two chips therefore look disabled
even though users can connect them.

## Scope

The production-enabled platform set shown on the landing page is:

- Telegram;
- MAX;
- VK;
- X (Twitter);
- LinkedIn.

All other platform chips remain neutral. The `…и другие` chip also remains
neutral because it describes additional application capabilities rather than a
specific production-configured integration.

This change does not add provider integrations, configure OAuth credentials,
alter application availability, add logos, or change landing copy.

## Design

Add the existing `hot` class to the X (Twitter) and LinkedIn chip elements in
`deploy/landing/index.html`. Keep the existing Telegram, MAX, and VK chips
unchanged. Reuse the current `.chip.hot` CSS declaration so no new visual style
or responsive behavior is introduced.

Extend the landing test to parse the platform chip block and assert the exact
ordered list of chips carrying the `hot` class:

```text
Telegram, MAX, VK*, X (Twitter), LinkedIn
```

An exact-set assertion prevents both regressions (a configured platform losing
its active state) and overstatement (an unconfigured platform being presented
as enabled).

## Data and deployment

The landing remains a self-contained static HTML file. No runtime configuration
or API call is added. Future production integration changes must update this
explicit list and its test in the same commit.

Pushing the resulting commit to `prod` uses the existing landing deployment
workflow; production deployment is not part of the HTML implementation itself.

## Testing

- First add a failing test that expects the five production-enabled chips.
- Confirm it fails because X and LinkedIn are absent from the current hot-chip
  set.
- Add `hot` to exactly those two chips.
- Run `deploy/landing/index.spec.ts` and the production frontend build.
- Verify the final diff changes only the landing chip classes, the focused test,
  and the approved design/plan documents.

## Acceptance criteria

- Telegram, MAX, VK, X (Twitter), and LinkedIn use the turquoise active chip
  style on the landing page.
- No other chip uses the active style.
- Existing Russian and English localization behavior remains unchanged.
- The landing layout remains unchanged at existing responsive widths.
