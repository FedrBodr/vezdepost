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
    [
      'en',
      'How to get started',
      'How much does it cost?',
      'Frequently asked questions',
    ],
  ] as const)(
    'renders complete %s section copy',
    (language, steps, pricing, faq) => {
      const { document, window } = createLanding({ locale: 'en-US' });
      window.__landingI18n.applyLanguage(language);
      expect(document.querySelector('#steps h2')?.textContent).toBe(steps);
      expect(document.querySelector('#pricing h2')?.textContent).toBe(pricing);
      expect(document.querySelector('#faq h2')?.textContent).toBe(faq);
      expect(document.querySelector('#services h2')?.textContent).toContain(
        language === 'ru' ? 'до 7 дней' : 'in up to 7 days'
      );
    }
  );

  it('updates document and Open Graph metadata in English', () => {
    const { document } = createLanding({ locale: 'en-US' });
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe(
      'Vezdepost — social media and messenger post scheduler'
    );
    expect(
      document
        .querySelector('meta[name="description"]')
        ?.getAttribute('content')
    ).toContain('open-source publishing scheduler');
    expect(
      document
        .querySelector('meta[property="og:title"]')
        ?.getAttribute('content')
    ).toBe('Vezdepost — social media and messenger post scheduler');
    expect(
      document
        .querySelector('meta[property="og:description"]')
        ?.getAttribute('content')
    ).toContain('Schedule and publish posts');
  });

  it('updates the calendar accessibility label and examples', () => {
    const { document } = createLanding({ locale: 'en-US' });
    expect(document.querySelector('.window')?.getAttribute('aria-label')).toContain(
      'Vezdepost interface preview'
    );
    expect(document.querySelector('.window-title')?.textContent).toContain(
      'calendar'
    );
    expect(document.querySelector('.dow')?.textContent).toBe('Mon');
    expect(document.querySelector('.post small')?.textContent).toContain(
      'release announcement'
    );
  });
});

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
