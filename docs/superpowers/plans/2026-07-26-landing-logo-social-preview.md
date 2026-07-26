# Landing Logo and Social Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a branded 1200 × 630 Vezdepost social card and expose it through complete Open Graph/Twitter metadata while adding the supplied logo to the landing navigation, hero, and browser icons.

**Architecture:** Keep the user-supplied square PNG unchanged as the canonical source under the frontend public directory. A small Sharp-based build utility deterministically copies the square landing asset and composites the selected Russian product-message card; the static landing serves both checked-in derivatives directly, without JavaScript or backend dependencies.

**Tech Stack:** Static HTML/CSS, Node.js ESM, Sharp, Vitest, JSDOM.

## Global Constraints

- Preserve `apps/frontend/public/vezdepost.png` unchanged.
- The social preview must be a 1200 × 630 PNG.
- The primary social-card message is `Один пост. 30+ платформ.`.
- The card shows Telegram, LinkedIn, and VK chips and the supplied mark on the right.
- New landing images declare intrinsic width and height and decorative copies use empty `alt` text.
- Social crawler URLs are absolute `https://vezdepost.ru/...` URLs.
- Do not redesign unrelated landing sections or application-wide branding.

---

### Task 1: Generate checked-in landing brand assets

**Files:**
- Create: `deploy/landing/generate-social-assets.mjs`
- Create: `deploy/landing/assets/vezdepost-logo.png`
- Create: `deploy/landing/assets/vezdepost-og.png`
- Modify: `deploy/landing/index.spec.ts`

**Interfaces:**
- Consumes: `apps/frontend/public/vezdepost.png` as the immutable square source.
- Produces: `deploy/landing/assets/vezdepost-logo.png` (1254 × 1254 PNG) and `deploy/landing/assets/vezdepost-og.png` (1200 × 630 PNG).

- [ ] **Step 1: Write the failing asset contract test**

Add a test that imports `existsSync` and `sharp`, then asserts both assets exist and their metadata are exactly PNG/1254 × 1254 and PNG/1200 × 630. Also compare the square source and published logo buffers for byte equality.

```ts
describe('landing brand assets', () => {
  it('publishes the supplied logo unchanged and a LinkedIn-sized social card', async () => {
    const source = join(process.cwd(), 'apps/frontend/public/vezdepost.png');
    const logo = join(process.cwd(), 'deploy/landing/assets/vezdepost-logo.png');
    const social = join(process.cwd(), 'deploy/landing/assets/vezdepost-og.png');
    expect(existsSync(logo)).toBe(true);
    expect(existsSync(social)).toBe(true);
    expect(readFileSync(logo)).toEqual(readFileSync(source));
    await expect(sharp(logo).metadata()).resolves.toMatchObject({ format: 'png', width: 1254, height: 1254 });
    await expect(sharp(social).metadata()).resolves.toMatchObject({ format: 'png', width: 1200, height: 630 });
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm exec vitest run deploy/landing/index.spec.ts`

Expected: FAIL because `deploy/landing/assets/vezdepost-logo.png` and `vezdepost-og.png` do not exist.

- [ ] **Step 3: Implement the deterministic Sharp generator**

Create an ESM script which:

1. resolves paths relative to the repository root;
2. creates `deploy/landing/assets`;
3. copies the source PNG byte-for-byte to `vezdepost-logo.png`;
4. creates a 1200 × 630 `#070b12` canvas;
5. composites an SVG with cyan `Vezdepost`, two-line white `Один пост.` / `30+ платформ.`, and three outlined chips;
6. resizes the supplied mark to fit within 370 × 370 and composites it at the right;
7. writes optimized PNG output to `vezdepost-og.png`.

Run: `pnpm node deploy/landing/generate-social-assets.mjs`

Expected: both assets are written below `deploy/landing/assets/`.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `pnpm exec vitest run deploy/landing/index.spec.ts`

Expected: PASS, including the new asset contract.

- [ ] **Step 5: Commit the generated assets and contract**

```bash
git add apps/frontend/public/vezdepost.png deploy/landing/generate-social-assets.mjs deploy/landing/assets deploy/landing/index.spec.ts
git commit -m "feat: add Vezdepost landing brand assets"
```

### Task 2: Expose the social card and logo in landing HTML

**Files:**
- Modify: `deploy/landing/index.html`
- Modify: `deploy/landing/index.spec.ts`

**Interfaces:**
- Consumes: `/assets/vezdepost-logo.png` and `/assets/vezdepost-og.png` from Task 1.
- Produces: crawler-readable Open Graph/Twitter metadata and two visible landing logo placements.

- [ ] **Step 1: Write failing metadata and placement tests**

Assert the document contains:

```ts
expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://vezdepost.ru/');
expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe('https://vezdepost.ru/assets/vezdepost-og.png');
expect(document.querySelector('meta[property="og:image:width"]')?.getAttribute('content')).toBe('1200');
expect(document.querySelector('meta[property="og:image:height"]')?.getAttribute('content')).toBe('630');
expect(document.querySelector('meta[name="twitter:card"]')?.getAttribute('content')).toBe('summary_large_image');
expect(document.querySelector('meta[name="twitter:image"]')?.getAttribute('content')).toBe('https://vezdepost.ru/assets/vezdepost-og.png');
expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe('/assets/vezdepost-logo.png');
expect(document.querySelector('.nav-logo img')?.getAttribute('width')).toBe('28');
expect(document.querySelector('.hero-logo')?.getAttribute('width')).toBe('112');
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm exec vitest run deploy/landing/index.spec.ts`

Expected: FAIL because the new metadata and image elements are absent.

- [ ] **Step 3: Add crawler metadata and icon links**

Add canonical, favicon, Apple touch icon, complete Open Graph image fields, and Twitter large-card fields to `<head>`. Reuse `data-i18n-content="meta.ogTitle"` and `data-i18n-content="meta.ogDescription"` for Twitter title and description.

- [ ] **Step 4: Add the logo to navigation and hero**

Change the navigation wordmark to a flex link containing a 28 × 28 decorative image and the existing gradient text. Insert a 112 × 112 decorative `.hero-logo` before the hero heading. Add focused responsive CSS for the two images without changing other sections.

- [ ] **Step 5: Run focused tests and the asset generator idempotence check**

Run:

```bash
pnpm node deploy/landing/generate-social-assets.mjs
pnpm exec vitest run deploy/landing/index.spec.ts
git diff --exit-code -- deploy/landing/assets
```

Expected: the generator makes no asset diff and all landing tests pass.

- [ ] **Step 6: Inspect the landing at desktop and mobile widths**

Serve `deploy/landing` locally, inspect the page at approximately 1440 px and 390 px widths, and confirm the navigation remains usable, the hero logo is crisp, and no content shifts or overflows.

- [ ] **Step 7: Commit the landing integration**

```bash
git add deploy/landing/index.html deploy/landing/index.spec.ts
git commit -m "feat: expose Vezdepost social preview"
```

### Task 3: Final verification and production handoff

**Files:**
- Verify only: `apps/frontend/public/vezdepost.png`
- Verify only: `deploy/landing/`

**Interfaces:**
- Consumes: the completed static landing assets and HTML.
- Produces: evidence that the change is safe to merge and deploy.

- [ ] **Step 1: Run final focused verification**

Run: `pnpm exec vitest run deploy/landing/index.spec.ts`

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Verify final scope**

Run: `git status --short` and `git diff --check HEAD^..HEAD` for each implementation commit.

Expected: only the approved logo/social-preview files are changed; no whitespace errors are reported.

- [ ] **Step 3: Merge into `prod`, push, and deploy only with current explicit authorization**

Use the repository's established production workflow, then verify:

```text
https://vezdepost.ru/assets/vezdepost-og.png → HTTP 200, image/png
https://vezdepost.ru/ → og:image points to the absolute asset URL
```

Expected: the live landing HTML and static asset match the committed version. Note that LinkedIn can continue displaying its cached preview until its crawler refreshes the URL.
