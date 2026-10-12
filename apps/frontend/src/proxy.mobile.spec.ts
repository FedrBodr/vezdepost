import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { proxy } from './proxy';

const iphone =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const request = (
  path: string,
  { auth = true, cookie = '' }: { auth?: boolean; cookie?: string } = {}
) =>
  new NextRequest(`https://app.vezdepost.ru${path}`, {
    headers: {
      'user-agent': iphone,
      cookie: [auth ? 'auth=token' : '', cookie].filter(Boolean).join('; '),
    },
  });

describe('proxy mobile redirect', () => {
  const env = process.env.MOBILE_ROUTE_ENABLED;
  beforeEach(() => {
    process.env.MOBILE_ROUTE_ENABLED = 'true';
  });
  afterEach(() => {
    process.env.MOBILE_ROUTE_ENABLED = env;
  });

  it('sends a logged-in phone from /launches to /m and keeps the query string', async () => {
    const response = await proxy(
      request('/launches?added=telegram&continue=1')
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://app.vezdepost.ru/m?added=telegram&continue=1'
    );
  });

  it('auth redirect wins over mobile redirect', async () => {
    const response = await proxy(request('/launches', { auth: false }));
    expect(response.headers.get('location')).toBe(
      'https://app.vezdepost.ru/auth'
    );
  });

  it('respects the desktop opt-out cookie', async () => {
    const response = await proxy(
      request('/launches', { cookie: 'vz-desktop=1' })
    );
    expect(response.headers.get('location')).toBeNull();
  });

  it('does nothing when the flag is off', async () => {
    process.env.MOBILE_ROUTE_ENABLED = 'false';
    const response = await proxy(request('/launches'));
    expect(response.headers.get('location')).toBeNull();
  });
});
