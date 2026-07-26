# Landing Logo and Social Preview Design

## Goal

Make links to `https://vezdepost.ru` render with a branded image in LinkedIn and other Open Graph consumers, and use the supplied Vezdepost logo visibly on the landing page.

## Chosen direction

Use the selected “product message” composition for the wide social card:

- dark Vezdepost background;
- small `Vezdepost` brand label;
- primary message `Один пост. 30+ платформ.`;
- Telegram, LinkedIn, and VK platform chips;
- the supplied Vezdepost mark on the right;
- 1200 × 630 PNG output for broad crawler compatibility.

The landing page itself will use the same supplied mark:

- beside the `Vezdepost` wordmark in the sticky navigation;
- above the hero heading;
- as the browser favicon and Apple touch icon.

## Assets

The user-supplied source image is `apps/frontend/public/vezdepost.png`. Preserve it unchanged. Publish landing-specific derivatives below `deploy/landing/assets/`:

- `vezdepost-logo.png` — the unchanged square logo for page UI and icons;
- `vezdepost-og.png` — the 1200 × 630 selected social-card composition.

The wide card is a checked-in static PNG so LinkedIn does not depend on JavaScript, dynamic rendering, or application availability when scraping the landing page.

## Metadata

Add absolute, public URLs and crawler hints to `deploy/landing/index.html`:

- canonical URL;
- `og:site_name`, `og:image`, `og:image:secure_url`, width, height, type, and alt text;
- `twitter:card=summary_large_image`, title, description, image, and image alt;
- favicon and Apple touch icon links.

Localized JavaScript may continue updating the existing title and description. The visual asset and image alt remain brand-level values and do not change with locale.

## Layout and accessibility

- Navigation logo remains a link to the top of the page and gains a 28 px image with empty `alt`; the adjacent visible wordmark retains the accessible name.
- Hero logo is decorative because the following `h1` already names the product; it uses empty `alt` and a responsive size capped at 112 px.
- Existing mobile navigation behavior must remain intact.
- All new image elements declare intrinsic width and height to avoid layout shift.

## Verification

- Extend `deploy/landing/index.spec.ts` to assert the exact absolute social metadata URLs, image dimensions/type/alt, icon links, and both visible logo placements.
- Verify the checked-in PNG dimensions through Sharp.
- Run the focused Vitest suite and inspect a locally served landing page at desktop and mobile widths.
- After deployment, verify the public asset and HTML metadata directly. LinkedIn may retain an older cached preview until its crawler refreshes the URL.

## Non-goals

- Redesigning the rest of the landing page.
- Replacing application-wide Postiz branding outside this landing-page task.
- Dynamically generating per-language or per-page social cards.
