# Vezdepost Privacy Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a public Russian privacy policy at `https://vezdepost.ru/privacy` and point Vezdepost's public and registration links to it.

**Architecture:** Add a standalone static `privacy/index.html` beneath the existing Caddy-mounted landing directory so the clean URL works without authentication or an application rebuild. Extend the existing static landing test for policy content and footer linkage, then cover the application registration URL with a source-level regression test.

**Tech Stack:** Static HTML/CSS, Caddy file server, React/Next.js registration form, Vitest, JSDOM.

## Global Constraints

- Public operator details are limited to Федоренко Дмитрий Александрович, НПД status, and INN 772373964340.
- Do not publish birth date, sex, citizenship, or place of birth.
- Use `https://t.me/FedrBodr` as the privacy-request contact until the operator supplies a verified email address.
- The page must work without authentication at exactly `https://vezdepost.ru/privacy`.
- Do not add dependencies, cookie consent, or change existing data processing.

---

### Task 1: Static privacy page and landing link

**Files:**
- Create: `deploy/landing/privacy/index.html`
- Modify: `deploy/landing/index.html`
- Modify: `deploy/landing/index.spec.ts`

**Interfaces:**
- Consumes: Caddy's existing `/srv/landing` static root and `deploy/landing/assets/vezdepost-logo.png`.
- Produces: the `/privacy` directory index and a landing-footer anchor with `href="/privacy"`.

- [ ] **Step 1: Write the failing policy-page test**

Add a test that reads `deploy/landing/privacy/index.html`, asserts the file exists, parses it with JSDOM, and requires the title, operator name, INN, effective date, canonical URL, data/purpose/disclosure/retention/rights/contact sections, Telegram contact, and absence of the excluded birth date. Extend the footer-link test to require `a[href="/privacy"]`.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `pnpm exec vitest run deploy/landing/index.spec.ts --reporter=default`

Expected: FAIL because `deploy/landing/privacy/index.html` does not exist or the footer link is absent.

- [ ] **Step 3: Implement the static page and footer link**

Create semantic, responsive HTML using the landing page's dark palette and logo. Include concise sections named `Какие данные мы обрабатываем`, `Для чего используются данные`, `Передача данных`, `Хранение и защита`, `Ваши права`, `Файлы cookie и аналитика`, `Изменения политики`, and `Контакты`. Add a visible `Политика конфиденциальности` footer link and matching Russian/English footer dictionary markup without altering the surrounding localization mechanism.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run: `pnpm exec vitest run deploy/landing/index.spec.ts deploy/production-config.spec.ts --reporter=default`

Expected: both files pass with zero failures.

- [ ] **Step 5: Commit the static policy deliverable**

Run:

```bash
git add deploy/landing/privacy/index.html deploy/landing/index.html deploy/landing/index.spec.ts
git commit -m "feat: publish Vezdepost privacy policy"
```

### Task 2: Registration policy link

**Files:**
- Create: `apps/frontend/src/components/auth/register.legal-links.spec.mjs`
- Modify: `apps/frontend/src/components/auth/register.tsx`

**Interfaces:**
- Consumes: the existing registration agreement copy.
- Produces: an external link to `https://vezdepost.ru/privacy` that opens safely in a new tab.

- [ ] **Step 1: Write the failing source regression test**

Read `register.tsx` and assert that it includes `href="https://vezdepost.ru/privacy"`, `target="_blank"`, and `rel="noopener noreferrer nofollow"`, and no longer contains `https://postiz.com/privacy`.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `pnpm exec vitest run apps/frontend/src/components/auth/register.legal-links.spec.mjs --reporter=default`

Expected: FAIL because the form still links to Postiz.

- [ ] **Step 3: Implement the minimum link change**

Replace only the privacy anchor URL and safe external-link attributes. Leave the Terms of Service URL unchanged because terms are outside this release.

- [ ] **Step 4: Run the test to verify GREEN**

Run: `pnpm exec vitest run apps/frontend/src/components/auth/register.legal-links.spec.mjs --reporter=default`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit the registration link**

Run:

```bash
git add apps/frontend/src/components/auth/register.tsx apps/frontend/src/components/auth/register.legal-links.spec.mjs
git commit -m "fix: link registration to Vezdepost privacy policy"
```

### Task 3: Verify and deploy to production

**Files:**
- Verify only; no planned file changes.

**Interfaces:**
- Consumes: tested commits on the current isolated branch and the existing `origin/prod` pull-based deployment.
- Produces: a verified HTTP 200 policy page on the apex production domain.

- [ ] **Step 1: Run the complete relevant verification**

Run:

```bash
pnpm exec vitest run deploy/landing/index.spec.ts deploy/production-config.spec.ts apps/frontend/src/components/auth/register.legal-links.spec.mjs --reporter=default
git diff origin/prod...HEAD --check
```

Expected: all tests pass and `git diff --check` produces no output.

- [ ] **Step 2: Inspect and fast-forward production**

Confirm the commits contain only the design, plan, policy page, tests, and link changes. Push the current tested HEAD to `origin/prod` with `git push origin HEAD:prod`; because the branch began at `origin/prod`, this must be a fast-forward.

- [ ] **Step 3: Verify the deployment gate**

Poll the server through the documented `vezdepost` SSH alias until `/var/lib/vezdepost-deployed-rev` equals the pushed SHA and `/var/log/vezdepost-autodeploy.log` records `deploy finished`. Confirm the Caddy container is running.

- [ ] **Step 4: Verify the public page**

Run public probes for `https://vezdepost.ru/privacy` and require HTTP 200, `text/html`, canonical URL, operator name, INN, Telegram contact, and no excluded birth date. Also probe the landing page and application API with their documented expected statuses.
