// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  fallbackLng,
  getLanguageDirection,
  isSupportedLanguage,
  languageCookieMaxAgeSeconds,
  normalizeLanguage,
} from './i18n.config';
import {
  persistLanguageCookie,
  serializeLanguageCookie,
} from './language.cookie';

describe('language contract', () => {
  beforeEach(() => {
    document.cookie = 'i18next=; Max-Age=0; Path=/';
  });

  it('normalizes only configured languages and falls back to English', () => {
    expect(isSupportedLanguage('ru')).toBe(true);
    expect(isSupportedLanguage('ar')).toBe(true);
    expect(isSupportedLanguage('bn')).toBe(false);
    expect(normalizeLanguage('ru')).toBe('ru');
    expect(normalizeLanguage('invalid')).toBe(fallbackLng);
    expect(normalizeLanguage(undefined)).toBe(fallbackLng);
  });

  it('uses RTL only for Hebrew and Arabic', () => {
    expect(getLanguageDirection('he')).toBe('rtl');
    expect(getLanguageDirection('ar')).toBe('rtl');
    expect(getLanguageDirection('ru')).toBe('ltr');
    expect(getLanguageDirection('invalid')).toBe('ltr');
  });

  it('serializes the exact 365-day cookie contract', () => {
    expect(languageCookieMaxAgeSeconds).toBe(31_536_000);
    expect(serializeLanguageCookie('ru', false)).toBe(
      'i18next=ru; Path=/; Max-Age=31536000; SameSite=Lax'
    );
    expect(serializeLanguageCookie('ar', true)).toBe(
      'i18next=ar; Path=/; Max-Age=31536000; SameSite=Lax; Secure'
    );
    expect(serializeLanguageCookie('invalid', false)).toContain('i18next=en;');
  });

  it('persists a client-readable language cookie', () => {
    persistLanguageCookie('ru');
    expect(document.cookie).toContain('i18next=ru');
  });
});
