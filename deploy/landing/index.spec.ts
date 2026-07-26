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
