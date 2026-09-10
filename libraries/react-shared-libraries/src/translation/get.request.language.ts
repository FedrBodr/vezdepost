import { cookies, headers } from 'next/headers';
import {
  cookieName,
  fallbackLng,
  headerName,
  isSupportedLanguage,
} from './i18n.config';

export const getRequestLanguage = async (): Promise<string> => {
  const [requestHeaders, requestCookies] = await Promise.all([
    headers(),
    cookies(),
  ]);
  const forwardedLanguage = requestHeaders.get(headerName);
  if (isSupportedLanguage(forwardedLanguage)) {
    return forwardedLanguage;
  }

  const cookieLanguage = requestCookies.get(cookieName)?.value;
  return isSupportedLanguage(cookieLanguage) ? cookieLanguage : fallbackLng;
};
