# Vezdepost Privacy Policy Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete English translation and the landing page's RU/EN selection behavior to the public privacy policy without changing its URL.

**Architecture:** Keep `deploy/landing/privacy/index.html` autonomous and add source-controlled RU/EN dictionaries plus a small browser script that binds translations through `data-i18n*` attributes. Extend the existing JSDOM landing test file with a privacy-page harness that executes only the policy localization script and verifies detection, rendering, persistence, failure fallbacks, and immutable operator details.

**Tech Stack:** Static HTML/CSS/JavaScript, JSDOM, Vitest, Caddy static file server.

## Global Constraints

- Keep the public URL exactly `https://vezdepost.ru/privacy`.
- Use the existing local-storage key `vezdepost-language`.
- Provide complete equivalent Russian and English policy text, metadata, navigation, and footer copy.
- Keep Федоренко Дмитрий Александрович, INN 772373964340, and `https://t.me/FedrBodr` unchanged in both languages.
- Do not publish the operator's birth date, sex, citizenship, or place of birth.
- Do not add dependencies or change application/container behavior.

---

### Task 1: Complete privacy-page localization

**Files:**
- Modify: `deploy/landing/privacy/index.html`
- Modify: `deploy/landing/index.spec.ts`

**Interfaces:**
- Consumes: browser `navigator.languages`, `navigator.language`, and optional `window.localStorage`; the existing `vezdepost-language` key used by the landing page.
- Produces: `window.__privacyI18n` with `languageFromLocale(locale)`, `detectLanguage()`, `getCurrentLanguage()`, `applyLanguage(language, persist?)`, and `translations`; RU/EN buttons using `data-language` and `aria-pressed`.

- [ ] **Step 1: Add the failing privacy localization harness and tests**

Add `createPrivacy(options)` beside `createLanding`. It reads the existing privacy HTML, configures locale and storage behavior in JSDOM, evaluates `script#privacy-i18n`, and returns the document and window. Add tests requiring matching non-empty RU/EN dictionaries, complete translation-key bindings, RU/EN locale detection, stored-preference priority, immediate switching and persistence, safe storage failure, translated document title/meta/navigation/headings/body/footer, active button state, unchanged operator/INN/contact, and absence of `07.08.1987`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run deploy/landing/index.spec.ts --reporter=default
```

Expected: FAIL because `script#privacy-i18n`, the language buttons, translation bindings, and `window.__privacyI18n` do not exist.

- [ ] **Step 3: Add translation bindings and complete dictionaries**

Update the document to start as `<html lang="ru" class="i18n-pending">`; bind title/meta/navigation/title/effective date/operator, all section headings, paragraphs and list items, and footer through `data-i18n`, `data-i18n-html`, `data-i18n-content`, or `data-i18n-aria-label`. Add RU/EN header buttons with `aria-pressed`, responsive styles, and accessible labels. Preserve Russian text as the no-script fallback.

Add `script#privacy-i18n` containing full `ru` and `en` dictionaries and the same locale rules as the landing page: stored choice first; Russian for language `ru` or regions RU/BY/KZ/KG; English otherwise. `applyLanguage` updates text, trusted static HTML, metadata, labels, document language, and button state; manual changes persist when possible; initialization always removes `i18n-pending` even when storage or locale parsing fails.

- [ ] **Step 4: Run focused verification and verify GREEN**

Run:

```bash
pnpm exec vitest run deploy/landing/index.spec.ts deploy/production-config.spec.ts --reporter=default
git diff --check
```

Expected: all tests pass with zero failures and diff check prints no errors.

- [ ] **Step 5: Commit the localized policy**

Run:

```bash
git add deploy/landing/privacy/index.html deploy/landing/index.spec.ts
git commit -m "feat: localize Vezdepost privacy policy"
```

### Task 2: Verify and release

**Files:**
- Verify only; no planned file changes.

**Interfaces:**
- Consumes: the tested localization commit and the current `origin/prod` history.
- Produces: the same public `/privacy` URL rendering complete RU and EN versions in production.

- [ ] **Step 1: Run full verification**

Run:

```bash
pnpm test
git diff origin/prod...HEAD --check
git status --short
```

Expected: the JUnit report records zero failures/errors, diff check is clean, and the worktree has no uncommitted files.

- [ ] **Step 2: Fast-forward production safely**

Fetch `origin/prod`, merge it into the feature branch if it advanced, re-run the focused test after any merge, verify `origin/prod` is an ancestor of HEAD, then push with `git push origin HEAD:prod`. Never force-push.

- [ ] **Step 3: Verify the production deployment gate**

Wait until `/var/lib/vezdepost-deployed-rev` equals the pushed/current prod SHA and the log contains a fresh `deploy finished`. Confirm Caddy and Postiz are running, ports 3000/4200/5000 listen, and the Temporal workflow queue has a poller.

- [ ] **Step 4: Verify both public languages**

Fetch `https://vezdepost.ru/privacy` and require HTTP 200, HTML content type, canonical URL, both dictionary copies, language buttons, operator name, INN, Telegram contact, and absence of the excluded birth date. Execute the production localization script in JSDOM with `ru-RU` and `en-US` and require the corresponding translated title, metadata, section text, and document language.
