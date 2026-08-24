export const fallbackLng = 'en';
export const languages = [
  fallbackLng,
  'he',
  'ru',
  'zh',
  'fr',
  'es',
  'pt',
  'de',
  'it',
  'ja',
  'ko',
  'ar',
  'tr',
  'vi',
];

export const defaultNS = 'translation';
export const cookieName = 'i18next';
export const headerName = 'x-i18next-current-language';
export const languageCookieMaxAgeSeconds = 60 * 60 * 24 * 365;

export const isSupportedLanguage = (
  value: string | null | undefined
): value is string => typeof value === 'string' && languages.includes(value);

export const normalizeLanguage = (
  value: string | null | undefined
): string => (isSupportedLanguage(value) ? value : fallbackLng);

export const getLanguageDirection = (
  language: string | null | undefined
): 'ltr' | 'rtl' =>
  language === 'he' || language === 'ar' ? 'rtl' : 'ltr';
