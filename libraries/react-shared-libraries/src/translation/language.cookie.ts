import {
  cookieName,
  languageCookieMaxAgeSeconds,
  normalizeLanguage,
} from './i18n.config';

export const serializeLanguageCookie = (
  language: string,
  secure: boolean
): string =>
  [
    `${cookieName}=${encodeURIComponent(normalizeLanguage(language))}`,
    'Path=/',
    `Max-Age=${languageCookieMaxAgeSeconds}`,
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');

export const persistLanguageCookie = (language: string): void => {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }

  document.cookie = serializeLanguageCookie(
    language,
    window.location.protocol === 'https:'
  );
};
