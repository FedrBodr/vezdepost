import { describe, expect, it } from 'vitest';
import { isPhoneUserAgent, resolveMobileRedirect } from './mobile.detect';

const iphone =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const android =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';
const ipad =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const androidTablet =
  'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const desktop =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const base = {
  pathname: '/launches',
  search: '',
  userAgent: iphone,
  desktopCookie: undefined,
  enabled: true,
};

describe('isPhoneUserAgent', () => {
  it('recognises iPhone and Android phones', () => {
    expect(isPhoneUserAgent(iphone)).toBe(true);
    expect(isPhoneUserAgent(android)).toBe(true);
  });

  it('does not treat tablets or desktops as phones', () => {
    expect(isPhoneUserAgent(ipad)).toBe(false);
    expect(isPhoneUserAgent(androidTablet)).toBe(false);
    expect(isPhoneUserAgent(desktop)).toBe(false);
    expect(isPhoneUserAgent(null)).toBe(false);
  });
});

describe('resolveMobileRedirect', () => {
  it('sends a phone on /launches to /m', () => {
    expect(resolveMobileRedirect(base)).toBe('/m');
  });

  it('keeps the query string', () => {
    expect(
      resolveMobileRedirect({ ...base, search: '?added=telegram&continue=1' })
    ).toBe('/m?added=telegram&continue=1');
  });

  it('does nothing when the flag is off', () => {
    expect(resolveMobileRedirect({ ...base, enabled: false })).toBeNull();
  });

  it('respects the desktop opt-out cookie', () => {
    expect(resolveMobileRedirect({ ...base, desktopCookie: '1' })).toBeNull();
  });

  it('never redirects away from /m or other pages', () => {
    expect(resolveMobileRedirect({ ...base, pathname: '/m' })).toBeNull();
    expect(
      resolveMobileRedirect({ ...base, pathname: '/m/channels' })
    ).toBeNull();
    expect(resolveMobileRedirect({ ...base, pathname: '/settings' })).toBeNull();
    expect(
      resolveMobileRedirect({ ...base, pathname: '/auth/login' })
    ).toBeNull();
  });

  it('leaves desktops and tablets alone', () => {
    expect(resolveMobileRedirect({ ...base, userAgent: desktop })).toBeNull();
    expect(resolveMobileRedirect({ ...base, userAgent: ipad })).toBeNull();
  });
});
