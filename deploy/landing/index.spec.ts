import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

const landingHtml = readFileSync(
  join(process.cwd(), 'deploy/landing/index.html'),
  'utf8'
);
const privacyHtml = readFileSync(
  join(process.cwd(), 'deploy/landing/privacy/index.html'),
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
    window.localStorage.setItem('vezdepost-language', options.storedLanguage);
  }

  if (options.ym) window.ym = options.ym as never;

  const script = window.document.querySelector<HTMLScriptElement>(
    'script#landing-i18n'
  );
  expect(script).not.toBeNull();
  window.eval(script!.textContent || '');

  return { dom, window, document: window.document };
};

const createPrivacy = (options: LandingOptions = {}) => {
  const dom = new JSDOM(privacyHtml, {
    runScripts: 'outside-only',
    url: 'https://vezdepost.ru/privacy',
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
    window.localStorage.setItem('vezdepost-language', options.storedLanguage);
  }

  const script = window.document.querySelector<HTMLScriptElement>(
    'script#privacy-i18n'
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
      expect(
        window.__landingI18n.translations.ru[key],
        `ru.${key}`
      ).toBeTruthy();
      expect(
        window.__landingI18n.translations.en[key],
        `en.${key}`
      ).toBeTruthy();
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
    expect(
      document.querySelector('.window')?.getAttribute('aria-label')
    ).toContain('Vezdepost interface preview');
    expect(document.querySelector('.window-title')?.textContent).toContain(
      'calendar'
    );
    expect(document.querySelector('.dow')?.textContent).toBe('Mon');
    expect(document.querySelector('.post small')?.textContent).toContain(
      'release announcement'
    );
  });
});

describe('landing language switcher', () => {
  it('shows both language buttons with the active state', () => {
    const { document } = createLanding({ locale: 'en-US' });
    expect(
      document
        .querySelector('[data-language="en"]')
        ?.getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      document
        .querySelector('[data-language="ru"]')
        ?.getAttribute('aria-pressed')
    ).toBe('false');
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
    expect(ym).toHaveBeenCalledWith(110559699, 'reachGoal', 'language_switch', {
      language: 'ru',
    });
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

describe('landing brand assets', () => {
  it('publishes the supplied logo unchanged and a LinkedIn-sized social card', async () => {
    const source = join(process.cwd(), 'apps/frontend/public/vezdepost.png');
    const logo = join(
      process.cwd(),
      'deploy/landing/assets/vezdepost-logo.png'
    );
    const social = join(
      process.cwd(),
      'deploy/landing/assets/vezdepost-og.png'
    );

    expect(existsSync(logo)).toBe(true);
    expect(existsSync(social)).toBe(true);
    expect(readFileSync(logo)).toEqual(readFileSync(source));
    await expect(sharp(logo).metadata()).resolves.toMatchObject({
      format: 'png',
      width: 1254,
      height: 1254,
    });
    await expect(sharp(social).metadata()).resolves.toMatchObject({
      format: 'png',
      width: 1200,
      height: 630,
    });
  });
});

describe('landing brand integration', () => {
  it('links to the public privacy policy from the footer', () => {
    const { document } = createLanding({ locale: 'ru-RU' });

    expect(
      document.querySelector<HTMLAnchorElement>('footer a[href="/privacy"]')
        ?.textContent
    ).toBe('Политика конфиденциальности');
  });

  it('exposes complete social preview and icon metadata', () => {
    const { document } = createLanding({ locale: 'ru-RU' });

    expect(
      document.querySelector('link[rel="canonical"]')?.getAttribute('href')
    ).toBe('https://vezdepost.ru/');
    expect(
      document.querySelector('link[rel="icon"]')?.getAttribute('href')
    ).toBe('/assets/vezdepost-logo.png');
    expect(
      document
        .querySelector('link[rel="apple-touch-icon"]')
        ?.getAttribute('href')
    ).toBe('/assets/vezdepost-logo.png');
    expect(
      document
        .querySelector('meta[property="og:image"]')
        ?.getAttribute('content')
    ).toBe('https://vezdepost.ru/assets/vezdepost-og.png');
    expect(
      document
        .querySelector('meta[property="og:image:secure_url"]')
        ?.getAttribute('content')
    ).toBe('https://vezdepost.ru/assets/vezdepost-og.png');
    expect(
      document
        .querySelector('meta[property="og:image:width"]')
        ?.getAttribute('content')
    ).toBe('1200');
    expect(
      document
        .querySelector('meta[property="og:image:height"]')
        ?.getAttribute('content')
    ).toBe('630');
    expect(
      document
        .querySelector('meta[property="og:image:type"]')
        ?.getAttribute('content')
    ).toBe('image/png');
    expect(
      document
        .querySelector('meta[property="og:image:alt"]')
        ?.getAttribute('content')
    ).toBe('Vezdepost — один пост для 30+ платформ');
    expect(
      document
        .querySelector('meta[name="twitter:card"]')
        ?.getAttribute('content')
    ).toBe('summary_large_image');
    expect(
      document
        .querySelector('meta[name="twitter:image"]')
        ?.getAttribute('content')
    ).toBe('https://vezdepost.ru/assets/vezdepost-og.png');
    expect(
      document
        .querySelector('meta[name="twitter:image:alt"]')
        ?.getAttribute('content')
    ).toBe('Vezdepost — один пост для 30+ платформ');
  });

  it('uses intrinsic, decorative logos in the navigation and hero', () => {
    const { document } = createLanding();
    const navLogo = document.querySelector<HTMLImageElement>('.nav-logo img');
    const heroLogo = document.querySelector<HTMLImageElement>('.hero-logo');

    expect(navLogo?.getAttribute('src')).toBe('/assets/vezdepost-logo.png');
    expect(navLogo?.getAttribute('width')).toBe('28');
    expect(navLogo?.getAttribute('height')).toBe('28');
    expect(navLogo?.getAttribute('alt')).toBe('');
    expect(heroLogo?.getAttribute('src')).toBe('/assets/vezdepost-logo.png');
    expect(heroLogo?.getAttribute('width')).toBe('112');
    expect(heroLogo?.getAttribute('height')).toBe('112');
    expect(heroLogo?.getAttribute('alt')).toBe('');
  });
});

describe('privacy policy', () => {
  it('has matching, non-empty Russian and English dictionaries', () => {
    const { window } = createPrivacy();
    const { ru, en } = window.__privacyI18n.translations;

    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(en).length).toBeGreaterThan(30);
    expect(Object.values(ru).every(Boolean)).toBe(true);
    expect(Object.values(en).every(Boolean)).toBe(true);
  });

  it('binds every policy translation key in both dictionaries', () => {
    const { document, window } = createPrivacy();
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

    expect(boundKeys.length).toBeGreaterThan(30);
    for (const key of boundKeys) {
      expect(window.__privacyI18n.translations.ru[key], `ru.${key}`).toBeTruthy();
      expect(window.__privacyI18n.translations.en[key], `en.${key}`).toBeTruthy();
    }
  });

  it.each([
    ['ru-RU', 'ru'],
    ['ru-KZ', 'ru'],
    ['en-RU', 'ru'],
    ['be-BY', 'ru'],
    ['kk-KZ', 'ru'],
    ['en-US', 'en'],
    ['de-DE', 'en'],
    ['not_a_locale', 'en'],
    ['', 'en'],
  ] as const)('selects %s as %s', (locale, language) => {
    const { window } = createPrivacy({ locale });
    expect(window.__privacyI18n.getCurrentLanguage()).toBe(language);
  });

  it('gives a stored language priority over browser locale', () => {
    expect(
      createPrivacy({ locale: 'en-US', storedLanguage: 'ru' }).window
        .__privacyI18n.getCurrentLanguage()
    ).toBe('ru');
    expect(
      createPrivacy({ locale: 'ru-RU', storedLanguage: 'en' }).window
        .__privacyI18n.getCurrentLanguage()
    ).toBe('en');
  });

  it('renders the complete English policy and metadata', () => {
    const { document } = createPrivacy({ locale: 'en-US' });
    const text = document.body.textContent || '';

    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('Privacy Policy — Vezdepost');
    expect(
      document.querySelector('meta[name="description"]')?.getAttribute('content')
    ).toContain('how Vezdepost processes personal data');
    expect(document.querySelector('.back')?.textContent).toBe('Back to home');
    expect(document.querySelector('#data h2')?.textContent).toBe('Data we process');
    expect(document.querySelector('#purposes h2')?.textContent).toBe('How we use data');
    expect(document.querySelector('#sharing h2')?.textContent).toBe('Data sharing');
    expect(document.querySelector('#retention h2')?.textContent).toBe('Retention and security');
    expect(document.querySelector('#rights h2')?.textContent).toBe('Your rights');
    expect(document.querySelector('#cookies h2')?.textContent).toBe('Cookies and analytics');
    expect(document.querySelector('#changes h2')?.textContent).toBe('Policy changes');
    expect(document.querySelector('#contacts h2')?.textContent).toBe('Contact');
    expect(text).toContain('individual registered in Russia under the professional income tax regime');
    expect(text).toContain('including Pinterest');
    expect(text).toContain('Request access, correction, restriction, or deletion');
    expect(document.querySelector('footer')?.textContent).toContain('Home');
  });

  it('renders complete Russian policy copy', () => {
    const { document } = createPrivacy({ locale: 'ru-RU' });
    const text = document.body.textContent || '';

    expect(document.documentElement.lang).toBe('ru');
    expect(document.title).toBe('Политика конфиденциальности — Vezdepost');
    expect(document.querySelector('#data h2')?.textContent).toBe('Какие данные мы обрабатываем');
    expect(document.querySelector('#contacts h2')?.textContent).toBe('Контакты');
    expect(text).toContain('13 августа 2026 года');
    expect(text).toContain('включая Pinterest');
  });

  it('switches immediately, persists the choice, and updates button state', () => {
    const { document, window } = createPrivacy({ locale: 'en-US' });

    document.querySelector<HTMLButtonElement>('[data-language="ru"]')!.click();

    expect(window.__privacyI18n.getCurrentLanguage()).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');
    expect(document.querySelector('[data-language="ru"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-language="en"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(window.localStorage.getItem('vezdepost-language')).toBe('ru');
  });

  it('initializes, reveals, and switches when storage is unavailable', () => {
    const { document, window } = createPrivacy({
      locale: 'en-US',
      storageThrows: true,
    });

    expect(window.__privacyI18n.getCurrentLanguage()).toBe('en');
    expect(document.documentElement.classList).not.toContain('i18n-pending');
    document.querySelector<HTMLButtonElement>('[data-language="ru"]')!.click();
    expect(window.__privacyI18n.getCurrentLanguage()).toBe('ru');
  });

  it('preserves public identity, canonical URL, and contact in both languages', () => {
    const { document, window } = createPrivacy({ locale: 'en-US' });

    expect(
      document.querySelector('link[rel="canonical"]')?.getAttribute('href')
    ).toBe('https://vezdepost.ru/privacy');
    for (const language of ['en', 'ru'] as const) {
      window.__privacyI18n.applyLanguage(language);
      const text = document.body.textContent || '';
      expect(text).toContain('Федоренко Дмитрий Александрович');
      expect(text).toContain('772373964340');
      expect(document.querySelector('a[href="https://t.me/FedrBodr"]')?.textContent).toContain('@FedrBodr');
      expect(text).not.toContain('07.08.1987');
    }
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
    __privacyI18n: {
      languageFromLocale: (locale?: string) => 'ru' | 'en';
      detectLanguage: () => 'ru' | 'en';
      getCurrentLanguage: () => 'ru' | 'en';
      applyLanguage: (language: 'ru' | 'en', persist?: boolean) => void;
      translations: Record<'ru' | 'en', Record<string, string>>;
    };
    ym?: (...args: unknown[]) => void;
  }
}
