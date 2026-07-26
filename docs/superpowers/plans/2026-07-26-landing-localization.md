# Vezdepost Landing Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add complete Russian and English localization to `vezdepost.ru`, select the initial language from the visitor's locale, and persist an explicit language choice.

**Architecture:** Keep the landing as one self-contained `deploy/landing/index.html`. An inline, dependency-free localization controller owns locale detection, DOM/metadata translation, persistence, and switch analytics; semantic Russian HTML remains the no-JavaScript fallback. A focused Vitest/jsdom specification loads only that inline controller and verifies behavior without executing GTM.

**Tech Stack:** Static HTML/CSS/ES5-compatible browser JavaScript, `localStorage`, `Intl.Locale` with a string-parser fallback, Vitest 3, jsdom 22, Yandex Metrica.

## Global Constraints

- The only production file modified is `deploy/landing/index.html`; do not add a build step or runtime dependency.
- Keep Russian as the usable no-JavaScript HTML fallback.
- Stored `vezdepost-language` values `ru` and `en` override browser locale; ignore every other stored value.
- Without a stored choice, use Russian for primary language `ru` or region `RU`, `BY`, `KZ`, or `KG`; use English otherwise.
- Translate all visible copy, metadata, accessibility labels, calendar content, pricing, FAQ, services, and footer.
- Preserve the copy decisions in `docs/PROJECT.md`, including “founding engineer” and the modest, factual pricing language.
- Keep all existing URLs, GTM integration, and Metrica goals (`cta_app_click`, `github_click`, `services_click`, `tg_footer_click`) unchanged.
- Manual switching must be immediate, preserve scroll position, set `aria-pressed`, persist safely, and send `language_switch` with `{ language: selectedLanguage }` when `ym` exists.
- Use only `pnpm`; run lint/tests from the repository root; prefix shell commands with `rtk`.
- Preserve all unrelated changes in the primary checkout.

---

## File Structure

- Modify `deploy/landing/index.html`: retain the page markup and styles; add translation bindings, both dictionaries, locale selection, safe persistence, the header switcher, metadata updates, flash prevention, and switch analytics.
- Create `deploy/landing/index.spec.ts`: construct jsdom instances from the real HTML, execute only `script#landing-i18n`, and test locale, DOM, persistence, accessibility, metadata, and analytics behavior.

### Task 1: Locale Detection and Safe Initial Rendering

**Files:**
- Create: `deploy/landing/index.spec.ts`
- Modify: `deploy/landing/index.html:2,10-20,185-190,405-414`

**Interfaces:**
- Consumes: browser `navigator.languages`, `navigator.language`, and optional `localStorage`.
- Produces: `window.__landingI18n.languageFromLocale(locale): "ru" | "en"`, `window.__landingI18n.detectLanguage(): "ru" | "en"`, and `window.__landingI18n.getCurrentLanguage(): "ru" | "en"` for later tasks and focused tests.

- [ ] **Step 1: Write the jsdom harness and failing locale tests**

Create `deploy/landing/index.spec.ts` with a helper that does not execute the page's GTM scripts:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

const landingHtml = readFileSync(
  join(process.cwd(), 'deploy/landing/index.html'),
  'utf8'
);

type LandingOptions = {
  locale?: string;
  storedLanguage?: string;
  storageThrows?: boolean;
  ym?: ReturnType<typeof vi.fn>;
};

const createLanding = (options: LandingOptions = {}) => {
  const dom = new JSDOM(landingHtml, {
    runScripts: 'outside-only',
    url: 'https://vezdepost.ru/',
  });
  const { window } = dom;

  Object.defineProperty(window.navigator, 'languages', {
    configurable: true,
    value: options.locale ? [options.locale] : [],
  });
  Object.defineProperty(window.navigator, 'language', {
    configurable: true,
    value: options.locale || '',
  });

  if (options.storageThrows) {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('storage unavailable');
      },
    });
  } else if (options.storedLanguage !== undefined) {
    window.localStorage.setItem(
      'vezdepost-language',
      options.storedLanguage
    );
  }

  if (options.ym) window.ym = options.ym as never;

  const script = window.document.querySelector<HTMLScriptElement>(
    'script#landing-i18n'
  );
  expect(script).not.toBeNull();
  window.eval(script!.textContent || '');

  return { dom, window, document: window.document };
};

describe('landing locale detection', () => {
  it.each(['ru', 'ru-RU', 'ru-KZ', 'RU_ru'])(
    'selects Russian for language locale %s',
    (locale) => {
      const { window } = createLanding({ locale });
      expect(window.__landingI18n.getCurrentLanguage()).toBe('ru');
    }
  );

  it.each(['en-RU', 'be-BY', 'kk-KZ', 'ky-KG'])(
    'selects Russian for conservative region locale %s',
    (locale) => {
      const { window } = createLanding({ locale });
      expect(window.__landingI18n.getCurrentLanguage()).toBe('ru');
    }
  );

  it.each(['en-US', 'de-DE', 'uk-UA', 'uz-UZ', '', 'not_a_locale'])(
    'selects English for other or invalid locale %s',
    (locale) => {
      const { window } = createLanding({ locale });
      expect(window.__landingI18n.getCurrentLanguage()).toBe('en');
    }
  );

  it.each(['ru', 'en'] as const)(
    'gives stored %s preference priority over locale',
    (storedLanguage) => {
      const locale = storedLanguage === 'ru' ? 'en-US' : 'ru-RU';
      const { window } = createLanding({ locale, storedLanguage });
      expect(window.__landingI18n.getCurrentLanguage()).toBe(storedLanguage);
    }
  );

  it('ignores an invalid stored value', () => {
    const { window } = createLanding({
      locale: 'en-US',
      storedLanguage: 'fr',
    });
    expect(window.__landingI18n.getCurrentLanguage()).toBe('en');
  });

  it('still initializes and reveals the page when storage throws', () => {
    const { document, window } = createLanding({
      locale: 'ru-RU',
      storageThrows: true,
    });
    expect(window.__landingI18n.getCurrentLanguage()).toBe('ru');
    expect(document.documentElement.classList).not.toContain('i18n-pending');
  });
});
```

Add a local declaration at the bottom of the test so TypeScript knows the test-only public surface:

```ts
declare global {
  interface Window {
    __landingI18n: {
      languageFromLocale: (locale?: string) => 'ru' | 'en';
      detectLanguage: () => 'ru' | 'en';
      getCurrentLanguage: () => 'ru' | 'en';
      applyLanguage: (language: 'ru' | 'en', persist?: boolean) => void;
      translations: Record<'ru' | 'en', Record<string, string>>;
    };
    ym?: (...args: unknown[]) => void;
  }
}
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```bash
rtk pnpm exec vitest run deploy/landing/index.spec.ts
```

Expected: FAIL because `script#landing-i18n` and `window.__landingI18n` do not exist.

- [ ] **Step 3: Add flash prevention and the minimal localization controller**

Change the opening element to `<html lang="ru" class="i18n-pending">`. Add this CSS near the global rules:

```css
.i18n-pending body { visibility: hidden; }
```

Add this no-JavaScript override at the end of `<head>`:

```html
<noscript><style>.i18n-pending body { visibility: visible; }</style></noscript>
```

Before the existing analytics click script, add an inline controller with the stable test id. Keep the controller in an IIFE and use `var`/functions so it remains compatible with the landing's dependency-free browser target:

```html
<script id="landing-i18n">
(function () {
  var STORAGE_KEY = 'vezdepost-language';
  var RUSSIAN_REGIONS = ['RU', 'BY', 'KZ', 'KG'];
  var currentLanguage = 'en';
  var translations = { ru: {}, en: {} };

  function languageFromLocale(locale) {
    if (typeof locale !== 'string' || !locale.trim()) return 'en';
    var normalized = locale.trim().replace(/_/g, '-');
    var language = '';
    var region = '';

    try {
      if (typeof Intl !== 'undefined' && Intl.Locale) {
        var parsed = new Intl.Locale(normalized);
        language = (parsed.language || '').toLowerCase();
        region = (parsed.region || '').toUpperCase();
      }
    } catch (error) {
      language = '';
      region = '';
    }

    if (!language) {
      var parts = normalized.split('-');
      if (!/^[A-Za-z]{2,3}$/.test(parts[0] || '')) return 'en';
      language = parts[0].toLowerCase();
      for (var index = 1; index < parts.length; index += 1) {
        if (/^[A-Za-z]{2}$/.test(parts[index])) {
          region = parts[index].toUpperCase();
          break;
        }
      }
    }

    return language === 'ru' || RUSSIAN_REGIONS.indexOf(region) !== -1
      ? 'ru'
      : 'en';
  }

  function detectLanguage() {
    try {
      var stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'ru' || stored === 'en') return stored;
    } catch (error) {}

    var locale = '';
    if (navigator.languages && navigator.languages.length) {
      locale = navigator.languages[0];
    } else {
      locale = navigator.language || '';
    }
    return languageFromLocale(locale);
  }

  function applyLanguage(language) {
    currentLanguage = language === 'ru' ? 'ru' : 'en';
    document.documentElement.lang = currentLanguage;
    document.documentElement.classList.remove('i18n-pending');
  }

  window.__landingI18n = {
    languageFromLocale: languageFromLocale,
    detectLanguage: detectLanguage,
    getCurrentLanguage: function () { return currentLanguage; },
    applyLanguage: applyLanguage,
    translations: translations
  };

  try {
    applyLanguage(detectLanguage());
  } catch (error) {
    applyLanguage('en');
  }
})();
</script>
```

- [ ] **Step 4: Run the locale tests and verify they pass**

Run:

```bash
rtk pnpm exec vitest run deploy/landing/index.spec.ts
```

Expected: all locale-detection tests PASS and the page loses
`i18n-pending` even when storage throws.

- [ ] **Step 5: Commit the locale foundation**

```bash
rtk git add deploy/landing/index.html deploy/landing/index.spec.ts
rtk git commit -m "feat: detect vezdepost landing language"
```

### Task 2: Complete Russian and English Content

**Files:**
- Modify: `deploy/landing/index.html:12-19,189-404,407-474`
- Modify: `deploy/landing/index.spec.ts`

**Interfaces:**
- Consumes: `window.__landingI18n.applyLanguage(language, persist?)` and the actual landing DOM.
- Produces: equal `translations.ru` and `translations.en` dictionaries; bindings `data-i18n`, `data-i18n-html`, `data-i18n-content`, and `data-i18n-aria-label`; complete localized page and metadata.

- [ ] **Step 1: Add failing dictionary, binding, metadata, and content tests**

Append these suites to `deploy/landing/index.spec.ts`:

```ts
describe('landing translations', () => {
  it('has matching, non-empty Russian and English dictionaries', () => {
    const { window } = createLanding();
    const { ru, en } = window.__landingI18n.translations;
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(en).length).toBeGreaterThan(70);
    expect(Object.values(ru).every(Boolean)).toBe(true);
    expect(Object.values(en).every(Boolean)).toBe(true);
  });

  it('binds every translation key used by the document in both dictionaries', () => {
    const { document, window } = createLanding();
    const boundKeys = Array.from(
      document.querySelectorAll(
        '[data-i18n], [data-i18n-html], [data-i18n-content], [data-i18n-aria-label]'
      )
    ).flatMap((element) =>
      [
        element.getAttribute('data-i18n'),
        element.getAttribute('data-i18n-html'),
        element.getAttribute('data-i18n-content'),
        element.getAttribute('data-i18n-aria-label'),
      ].filter((key): key is string => Boolean(key))
    );

    for (const key of boundKeys) {
      expect(window.__landingI18n.translations.ru[key], `ru.${key}`).toBeTruthy();
      expect(window.__landingI18n.translations.en[key], `en.${key}`).toBeTruthy();
    }
  });

  it.each([
    ['ru', 'Как начать', 'Сколько это стоит', 'Частые вопросы'],
    ['en', 'How to get started', 'How much does it cost?', 'Frequently asked questions'],
  ] as const)('renders complete %s section copy', (language, steps, pricing, faq) => {
    const { document, window } = createLanding({ locale: 'en-US' });
    window.__landingI18n.applyLanguage(language);
    expect(document.querySelector('#steps h2')?.textContent).toBe(steps);
    expect(document.querySelector('#pricing h2')?.textContent).toBe(pricing);
    expect(document.querySelector('#faq h2')?.textContent).toBe(faq);
    expect(document.querySelector('#services h2')?.textContent).toContain(
      language === 'ru' ? 'до 7 дней' : 'in up to 7 days'
    );
  });

  it('updates document and Open Graph metadata in English', () => {
    const { document } = createLanding({ locale: 'en-US' });
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe(
      'Vezdepost — social media and messenger post scheduler'
    );
    expect(
      document.querySelector('meta[name="description"]')?.getAttribute('content')
    ).toContain('open-source publishing scheduler');
    expect(
      document.querySelector('meta[property="og:title"]')?.getAttribute('content')
    ).toBe('Vezdepost — social media and messenger post scheduler');
    expect(
      document.querySelector('meta[property="og:description"]')?.getAttribute('content')
    ).toContain('Schedule and publish posts');
  });

  it('updates the calendar accessibility label and examples', () => {
    const { document } = createLanding({ locale: 'en-US' });
    expect(document.querySelector('.window')?.getAttribute('aria-label')).toContain(
      'Vezdepost interface preview'
    );
    expect(document.querySelector('.window-title')?.textContent).toContain('calendar');
    expect(document.querySelector('.dow')?.textContent).toBe('Mon');
    expect(document.querySelector('.post small')?.textContent).toContain(
      'release announcement'
    );
  });
});
```

- [ ] **Step 2: Run the translation tests and verify the expected failure**

Run:

```bash
rtk pnpm exec vitest run deploy/landing/index.spec.ts
```

Expected: locale tests PASS; translation tests FAIL because dictionaries are
empty and the DOM has no translation bindings.

- [ ] **Step 3: Bind every language-dependent element**

Use the following binding contract consistently:

```html
<title data-i18n="meta.title">Vezdepost — планировщик постов для соцсетей и мессенджеров</title>
<meta name="description" data-i18n-content="meta.description" content="Vezdepost — open-source планировщик публикаций: Telegram, MAX, X, VK и 30+ платформ. AI-developed форк Postiz с поддержкой российских мессенджеров.">
<meta property="og:title" data-i18n-content="meta.ogTitle" content="Vezdepost — планировщик постов для соцсетей и мессенджеров">
<meta property="og:description" data-i18n-content="meta.ogDescription" content="Планируй и публикуй посты во все соцсети и мессенджеры из одного окна. Open source, бесплатно, без инвесторов и наценки.">
<a href="#steps" data-i18n="nav.steps">Как начать</a>
<p data-i18n="hero.tagline">Планируй и публикуй посты во все соцсети и мессенджеры из одного окна — по расписанию, с календарём и аналитикой.</p>
<p data-i18n-html="steps.signup.body">Почта и пароль на <a href="https://app.vezdepost.ru">app.vezdepost.ru</a>. Без карты и без звонков менеджера.</p>
<div class="window" role="img" data-i18n-aria-label="preview.ariaLabel" aria-label="Превью интерфейса Vezdepost: недельный календарь с запланированными постами">
```

Use `data-i18n` for plain text, `data-i18n-html` only for trusted constant copy
that contains existing links or `<br>`, `data-i18n-content` for metadata, and
`data-i18n-aria-label` for accessible labels. Bind all of these groups:

```text
meta: title, description, ogTitle, ogDescription
nav: preview, steps, platforms, pricing, faq, services, openApp
hero: badge, tagline, channels, openApp
preview: title, subtitle, ariaLabel, windowTitle, mon..sun,
         releaseAnnouncement, digest, thread, carousel, postPoll,
         weeklyResults, roundup, caption
steps: title, subtitle, signup.title/body, connect.title/body,
       publish.title/body
platforms: title, subtitle, other, note
pricing: title, subtitle, cloud.title/price/description/feature1..3,
         selfHost.title/price/description/feature1..3/instructions, honest
faq: title, subtitle, difference.question/answer, free.question/answer,
     platforms.question/answer, safety.question/answer,
     max.question/answer, ai.question/answer
services: title, subtitle, development.title/body, revisions.title/body,
          production.title/body, metrics.title/body, discuss
final: title, subtitle, openApp
footer: body, footnote
language: label, ru, en
```

- [ ] **Step 4: Fill both dictionaries with complete copy**

Retain the existing Russian DOM copy verbatim as `translations.ru`. Use the
following exact English copy for the corresponding groups; platform names and
URLs remain unchanged:

```text
meta.title / meta.ogTitle: Vezdepost — social media and messenger post scheduler
meta.description: Vezdepost is an open-source publishing scheduler for Telegram, MAX, X, VK, and 30+ platforms. An AI-developed Postiz fork with support for regional messengers.
meta.ogDescription: Schedule and publish posts to every social network and messenger from one place. Open source, free for now, with no investors or markup.
nav.preview: Screenshots
nav.steps: How to get started
nav.platforms: Platforms
nav.pricing: Pricing
nav.faq: FAQ
nav.services: Services
nav.openApp / hero.openApp / final.openApp: Open the app
hero.badge: Open source · AGPL-3.0 · free for now
hero.tagline: Schedule and publish posts to every social network and messenger from one place — with scheduling, a calendar, and analytics.
hero.channels: Telegram · MAX · X · Instagram · VK* · YouTube · and 30+ more platforms
preview.title: Everything scheduled, on one screen
preview.subtitle: Your publishing calendar shows what goes where and when. Drag posts, edit them, and check their status.
preview.ariaLabel: Vezdepost interface preview: a weekly calendar with scheduled posts
preview.windowTitle: app.vezdepost.ru — calendar
preview.mon..sun: Mon / Tue / Wed / Thu / Fri / Sat / Sun
preview.releaseAnnouncement: 09:00 · release announcement
preview.digest: 12:30 · digest
preview.thread: 18:00 · thread
preview.carousel: 11:00 · carousel
preview.postPoll: 10:00 · post + poll
preview.weeklyResults: 19:00 · weekly results
preview.roundup: 15:00 · roundup
preview.caption: The app interface. One post goes to all connected channels, adapted for each platform.
steps.title: How to get started
steps.subtitle: From registration to your first scheduled post in about five minutes.
steps.signup.title: Create an account
steps.signup.body: Email and password at <a href="https://app.vezdepost.ru">app.vezdepost.ru</a>. No card and no sales calls.
steps.connect.title: Connect your channels
steps.connect.body: Telegram, MAX, X, VK, and others — authorize them in a couple of clicks; tokens are stored only on the server.
steps.publish.title: Schedule and publish
steps.publish.body: Write once, choose channels and a time, and Vezdepost handles publishing and collects analytics.
platforms.title: Platforms
platforms.subtitle: One place instead of thirty tabs.
platforms.other: …and others
platforms.note: The complete current list is available in the app. * VK uses the upstream provider where available.
pricing.title: How much does it cost?
pricing.subtitle: Right now, it is simply free. If a subscription is ever needed, it will cover server costs only — with no investors or markup.
pricing.cloud.title: Cloud
pricing.cloud.price: free for now
pricing.cloud.description: The servers are paid for a few months ahead, so feel free to use them. If costs grow, an inexpensive subscription will cover the servers and be split equally among users.
pricing.cloud.feature1: Nothing to deploy
pricing.cloud.feature2: Updates and backups handled for you
pricing.cloud.feature3: Transparent economics with no markup
pricing.selfHost.title: Self-hosted
pricing.selfHost.price: Free
pricing.selfHost.description: The code is fully open under AGPL-3.0. Deploy it on your own server and use it without limits.
pricing.selfHost.feature1: Full control over your data
pricing.selfHost.feature2: Docker deployment
pricing.selfHost.feature3: Synced with upstream Postiz
pricing.selfHost.instructions: Instructions on GitHub
pricing.honest: Honestly, this is an open project, not a business. The author needs nothing from it right now: the servers are paid out of pocket for a few months, and then we will see how it goes. If a subscription becomes necessary, it will cover infrastructure costs only, with no markup. Only if the project genuinely grows would part of it support the time of the person maintaining it.
faq.title: Frequently asked questions
faq.subtitle: The essentials, briefly.
faq.difference.question: How is Vezdepost different from Postiz?
faq.difference.answer: Vezdepost is an open Postiz fork focused on regional platforms: it adds support for the MAX messenger, a Russian interface, and hosting and support in Russia. The fork is synchronized with upstream regularly, so new Postiz features arrive here too.
faq.free.question: Is it really free?
faq.free.answer: Yes, completely free for now: the author has paid for the servers out of pocket for a few months. Self-hosting stays free because the code is available under AGPL-3.0. If the cloud service ever needs a subscription, the total will cover server costs only, with no markup, and each user's share will fall as the user base grows. Supporting maintainer time would make sense only if the service grows substantially; nothing is needed now. If that happens, the benchmark is simple: the market compensation of one founding engineer — the person who owns the whole product in a technology startup, including code, servers, releases, and support. One such role, and no more.
faq.platforms.question: Which platforms are supported?
faq.platforms.answer: More than thirty, including Telegram, MAX, X, Instagram, VK, YouTube, TikTok, LinkedIn, Mastodon, Bluesky, and others. The current list is always visible when you connect a channel in the app.
faq.safety.question: Are my tokens and data safe?
faq.safety.answer: Access tokens are stored on the server and used only to publish your posts. All code is open: you can inspect what happens to your data or deploy your own copy and trust no one else.
faq.max.question: What is MAX?
faq.max.answer: MAX is a Russian messenger from VK. Vezdepost can publish scheduled posts to MAX channels just like it does for Telegram.
faq.ai.question: What does “AI-developed” mean?
faq.ai.answer: The project is developed with Claude Code: most of the code is written by AI under the supervision of an experienced practicing engineer. This lets one person maintain the fork and add platforms quickly.
services.title: MVPs and custom solutions in up to 7 days
services.subtitle: I will build an MVP for your IT project or a custom solution for your business process using the same approach behind Vezdepost. A week later, you will be looking at real user metrics, not a demo.
services.development.title: Days 1–2 — development
services.development.body: I build the solution and set up the infrastructure — deployment, domain, and database — so a working version is already online.
services.revisions.title: Days 3–4 — revisions
services.revisions.body: I show the result, collect feedback, and refine it for your use case.
services.production.title: Day 5 — production
services.production.body: Production release with HTTPS, backups, and goal-based analytics — the product meets its first users.
services.metrics.title: Day 7 — metrics
services.metrics.body: We review the real numbers together: who arrived, what they click, and where they leave. We decide what to grow next from data, not hunches.
services.discuss: Discuss a project
final.title: Try it now
final.subtitle: Sign up in a minute. No card required.
footer.body: Vezdepost is an open, AI-developed fork of <a href="https://github.com/gitroomhq/postiz-app">Postiz</a> (AGPL-3.0), maintained by <a href="https://t.me/FedrBodr">FedrBodr</a> with Claude Code.<br>Source code: <a href="https://github.com/FedrBodr/vezdepost">github.com/FedrBodr/vezdepost</a>
footer.footnote: * through the upstream VK provider where available
language.label: Language
language.ru: Russian
language.en: English
```

Update `applyLanguage` to apply all four binding forms and always reveal the
page in `finally`-equivalent control flow:

```js
function applyLanguage(language) {
  var selected = language === 'ru' ? 'ru' : 'en';
  var dictionary = translations[selected];
  currentLanguage = selected;

  document.documentElement.lang = selected;
  document.querySelectorAll('[data-i18n]').forEach(function (element) {
    element.textContent = dictionary[element.getAttribute('data-i18n')];
  });
  document.querySelectorAll('[data-i18n-html]').forEach(function (element) {
    element.innerHTML = dictionary[element.getAttribute('data-i18n-html')];
  });
  document.querySelectorAll('[data-i18n-content]').forEach(function (element) {
    element.setAttribute(
      'content',
      dictionary[element.getAttribute('data-i18n-content')]
    );
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(function (element) {
    element.setAttribute(
      'aria-label',
      dictionary[element.getAttribute('data-i18n-aria-label')]
    );
  });
  document.documentElement.classList.remove('i18n-pending');
}
```

All dictionary content is a committed constant; do not pass user-controlled
content to `data-i18n-html`.

- [ ] **Step 5: Run translation tests and inspect the diff**

Run:

```bash
rtk pnpm exec vitest run deploy/landing/index.spec.ts
rtk git diff --check
```

Expected: all tests PASS; `git diff --check` prints no errors. Inspect every
`data-i18n*` binding to confirm Russian fallback text still matches the original
copy.

- [ ] **Step 6: Commit complete localized content**

```bash
rtk git add deploy/landing/index.html deploy/landing/index.spec.ts
rtk git commit -m "feat: translate vezdepost landing content"
```

### Task 3: Accessible Switcher, Persistence, Analytics, and Browser QA

**Files:**
- Modify: `deploy/landing/index.html:40-65,180-205,407-480`
- Modify: `deploy/landing/index.spec.ts`

**Interfaces:**
- Consumes: the complete dictionaries and `applyLanguage` from Task 2.
- Produces: header buttons `[data-language="ru"]` and `[data-language="en"]`; `applyLanguage(language, persist)` persistence contract; Metrica `language_switch` event.

- [ ] **Step 1: Add failing switcher, persistence, metadata-state, and analytics tests**

Append:

```ts
describe('landing language switcher', () => {
  it('shows both language buttons with the active state', () => {
    const { document } = createLanding({ locale: 'en-US' });
    expect(document.querySelector('[data-language="en"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-language="ru"]')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('switches immediately and persists a manual choice', () => {
    const { document, window } = createLanding({ locale: 'en-US' });
    document.querySelector<HTMLButtonElement>('[data-language="ru"]')!.click();
    expect(window.__landingI18n.getCurrentLanguage()).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');
    expect(document.querySelector('#steps h2')?.textContent).toBe('Как начать');
    expect(window.localStorage.getItem('vezdepost-language')).toBe('ru');
  });

  it('keeps switching usable when persistence throws', () => {
    const { document, window } = createLanding({
      locale: 'en-US',
      storageThrows: true,
    });
    document.querySelector<HTMLButtonElement>('[data-language="ru"]')!.click();
    expect(window.__landingI18n.getCurrentLanguage()).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');
  });

  it('sends the language_switch goal with the selected language', () => {
    const ym = vi.fn();
    const { document } = createLanding({ locale: 'en-US', ym });
    document.querySelector<HTMLButtonElement>('[data-language="ru"]')!.click();
    expect(ym).toHaveBeenCalledWith(
      110559699,
      'reachGoal',
      'language_switch',
      { language: 'ru' }
    );
  });

  it('does not require Metrica to switch', () => {
    const { document, window } = createLanding({ locale: 'ru-RU' });
    document.querySelector<HTMLButtonElement>('[data-language="en"]')!.click();
    expect(window.__landingI18n.getCurrentLanguage()).toBe('en');
  });

  it('preserves existing CTA goal routing', () => {
    expect(landingHtml).toContain("'cta_app_click'");
    expect(landingHtml).toContain("'github_click'");
    expect(landingHtml).toContain("'services_click'");
    expect(landingHtml).toContain("'tg_footer_click'");
  });
});
```

- [ ] **Step 2: Run tests and verify switcher failures**

Run:

```bash
rtk pnpm exec vitest run deploy/landing/index.spec.ts
```

Expected: content/locale tests PASS; switcher tests FAIL because the header
control, persistence, active state, and analytics event are not implemented.

- [ ] **Step 3: Add the accessible responsive header control**

Insert before the header application CTA:

```html
<div class="language-switcher" role="group" data-i18n-aria-label="language.label" aria-label="Язык">
  <button type="button" data-language="ru" aria-pressed="true" data-i18n-aria-label="language.ru" aria-label="Русский">RU</button>
  <span aria-hidden="true">/</span>
  <button type="button" data-language="en" aria-pressed="false" data-i18n-aria-label="language.en" aria-label="Английский">EN</button>
</div>
```

Add styles next to the header rules:

```css
.language-switcher { display: flex; align-items: center; gap: 5px; color: var(--dim); font-size: 12px; }
.language-switcher button { border: 0; padding: 5px 3px; background: transparent; color: var(--dim); font: inherit; font-weight: 700; cursor: pointer; }
.language-switcher button:hover, .language-switcher button[aria-pressed="true"] { color: var(--text); }
.language-switcher button:focus-visible { outline: 2px solid var(--accent2); outline-offset: 2px; border-radius: 4px; }
@media (max-width: 720px) {
  .nav { gap: 12px; }
  .nav-logo { margin-right: auto; }
  .nav .btn { margin-left: 0; padding: 8px 12px; }
}
@media (max-width: 430px) {
  .nav { gap: 8px; }
  .nav-logo { font-size: 17px; }
  .nav .btn { font-size: 12px; padding: 7px 9px; }
}
```

- [ ] **Step 4: Add persistence, active state, and switch analytics**

Change `applyLanguage` to accept `persist`, catch storage errors, update both
buttons, and send analytics only for a manual choice:

```js
function applyLanguage(language, persist) {
  var selected = language === 'ru' ? 'ru' : 'en';
  var dictionary = translations[selected];
  currentLanguage = selected;

  try {
    document.documentElement.lang = selected;
    document.querySelectorAll('[data-i18n]').forEach(function (element) {
      element.textContent = dictionary[element.getAttribute('data-i18n')];
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (element) {
      element.innerHTML = dictionary[element.getAttribute('data-i18n-html')];
    });
    document.querySelectorAll('[data-i18n-content]').forEach(function (element) {
      element.setAttribute('content', dictionary[element.getAttribute('data-i18n-content')]);
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(function (element) {
      element.setAttribute('aria-label', dictionary[element.getAttribute('data-i18n-aria-label')]);
    });
    document.querySelectorAll('[data-language]').forEach(function (button) {
      button.setAttribute(
        'aria-pressed',
        button.getAttribute('data-language') === selected ? 'true' : 'false'
      );
    });

    if (persist) {
      try { window.localStorage.setItem(STORAGE_KEY, selected); } catch (error) {}
      if (typeof window.ym === 'function') {
        window.ym(110559699, 'reachGoal', 'language_switch', { language: selected });
      }
    }
  } finally {
    document.documentElement.classList.remove('i18n-pending');
  }
}

document.querySelectorAll('[data-language]').forEach(function (button) {
  button.addEventListener('click', function () {
    applyLanguage(button.getAttribute('data-language'), true);
  });
});
```

Keep initialization as `applyLanguage(detectLanguage(), false)`. Do not call
`scrollTo`, modify `location`, or rebuild sections, so the browser retains the
current scroll position and open FAQ state.

- [ ] **Step 5: Run focused and full automated verification**

Run:

```bash
rtk pnpm exec vitest run deploy/landing/index.spec.ts
rtk pnpm exec vitest run deploy/production-config.spec.ts deploy/landing/index.spec.ts
rtk git diff --check
```

Expected: both Vitest files PASS and `git diff --check` prints no errors.

- [ ] **Step 6: Verify both languages in a real browser**

Use the `browser:control-in-app-browser` skill. Serve the static directory
without editing tracked files:

```bash
rtk pnpm dlx serve deploy/landing -l 4173
```

Open `http://localhost:4173`, then verify:

1. With `vezdepost-language` absent and an English browser locale, the first
   visible content is English and `<html lang="en">`.
2. `RU` switches all sections and metadata immediately, does not jump the page,
   and survives reload.
3. `EN` switches back and survives reload.
4. Both buttons work by keyboard and expose the correct `aria-pressed` value.
5. At widths 1440, 720, 430, and 375 px, the header does not clip or create
   horizontal scrolling.
6. Both languages render the calendar, pricing, FAQ, services, final CTA, and
   footer without overflow or leftover text from the other language.
7. CTA, GitHub, and Telegram link destinations remain unchanged.

Stop the local server after verification.

- [ ] **Step 7: Commit the completed interaction**

```bash
rtk git add deploy/landing/index.html deploy/landing/index.spec.ts
rtk git commit -m "feat: persist landing language selection"
```

### Task 4: Final Regression Review

**Files:**
- Verify: `deploy/landing/index.html`
- Verify: `deploy/landing/index.spec.ts`
- Verify: `docs/PROJECT.md`

**Interfaces:**
- Consumes: the completed landing and tests from Tasks 1–3.
- Produces: evidence that the implementation satisfies the approved design and preserves existing landing behavior.

- [ ] **Step 1: Run the final verification commands from the repository root**

```bash
rtk pnpm exec vitest run deploy/landing/index.spec.ts deploy/production-config.spec.ts
rtk git diff --check HEAD~3..HEAD
rtk git status --short
```

Expected: all tests PASS; no whitespace errors; status contains only unrelated
pre-existing user files and no uncommitted localization changes.

- [ ] **Step 2: Review the committed diff against the acceptance criteria**

```bash
rtk git diff --stat HEAD~3..HEAD
rtk git diff HEAD~3..HEAD -- deploy/landing/index.html deploy/landing/index.spec.ts
```

Confirm explicitly that the diff contains exactly one production file and one
test file, both languages cover the same keys, the conservative region set is
exactly `RU/BY/KZ/KG`, manual storage has priority, the no-JavaScript Russian
fallback remains readable, and existing analytics goal branches are intact.

- [ ] **Step 3: Record the final worktree commit range for handoff**

```bash
rtk git log --oneline --max-count=3
```

Expected: three focused feature commits corresponding to locale detection,
complete content, and persisted switching. Report those commit hashes together
with automated and browser verification results.
