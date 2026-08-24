import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy, resolveProxyLanguage } from './proxy';

describe('proxy localization', () => {
  it('gives a valid cookie priority and rejects an invalid cookie to English', () => {
    expect(resolveProxyLanguage('ru', 'en-US')).toBe('ru');
    expect(resolveProxyLanguage('invalid', 'ru-RU')).toBe('en');
  });

  it('uses Accept-Language only when no cookie exists', () => {
    expect(resolveProxyLanguage(undefined, 'ru-RU,ru;q=0.9')).toBe('ru');
    expect(resolveProxyLanguage(undefined, 'bn-BD')).toBe('en');
    expect(resolveProxyLanguage(undefined, null)).toBe('en');
  });

  it('persists the detected locale for 365 days on an auth response', async () => {
    const response = await proxy(
      new NextRequest('https://app.vezdepost.ru/auth', {
        headers: { 'accept-language': 'ru-RU,ru;q=0.9' },
      })
    );
    const setCookie = response.headers.get('set-cookie') || '';

    expect(response.cookies.get('i18next')?.value).toBe('ru');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('Max-Age=31536000');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
    expect(setCookie.toLowerCase()).toContain('secure');
  });
});
