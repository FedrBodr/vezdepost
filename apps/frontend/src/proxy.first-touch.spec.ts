import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { proxy } from './proxy';
import { parseFirstTouch } from '@gitroom/helpers/utils/first.touch';

const firstTouchHeader = (response: Response) =>
  (response.headers.get('set-cookie') || '')
    .split(/,(?=\s*[\w-]+=)/)
    .find((c) => c.trim().startsWith('vp_first_touch=')) || '';

describe('proxy first touch', () => {
  const frontendUrl = process.env.FRONTEND_URL;
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://app.vezdepost.ru';
  });
  afterEach(() => {
    process.env.FRONTEND_URL = frontendUrl;
  });

  it('stores referrer and utm on the first anonymous visit, also on redirects', async () => {
    const response = await proxy(
      new NextRequest('https://app.vezdepost.ru/launches?utm_source=vk', {
        headers: { referer: 'https://vk.com/real_belovo' },
      })
    );
    const header = firstTouchHeader(response);

    expect(response.status).toBe(307);
    expect(header).toContain('Domain=.vezdepost.ru');
    expect(header).toContain('Max-Age=15552000');
    expect(header.toLowerCase()).toContain('secure');
    expect(
      parseFirstTouch(response.cookies.get('vp_first_touch')?.value)
    ).toMatchObject({
      src: 'app',
      ref: 'https://vk.com/real_belovo',
      path: '/launches?utm_source=vk',
      utm: { utm_source: 'vk' },
    });
  });

  it('never overwrites an existing first touch', async () => {
    const response = await proxy(
      new NextRequest('https://app.vezdepost.ru/auth', {
        headers: {
          referer: 'https://accounts.google.com/',
          cookie: 'vp_first_touch=%7B%7D',
        },
      })
    );

    expect(firstTouchHeader(response)).toBe('');
  });

  it('skips logged-in users', async () => {
    const response = await proxy(
      new NextRequest('https://app.vezdepost.ru/auth', {
        headers: { cookie: 'auth=token' },
      })
    );

    expect(firstTouchHeader(response)).toBe('');
  });
});
