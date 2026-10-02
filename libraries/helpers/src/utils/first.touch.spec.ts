import { describe, expect, it } from 'vitest';
import {
  buildFirstTouch,
  parseFirstTouch,
  serializeFirstTouch,
} from './first.touch';

const now = new Date('2026-10-02T10:00:00.000Z');

describe('first touch', () => {
  it('captures referrer, entry path and only utm parameters', () => {
    const touch = buildFirstTouch(
      'app',
      new URL(
        'https://app.vezdepost.ru/auth?utm_source=vk&utm_campaign=belovo&foo=bar'
      ),
      'https://www.google.com/',
      now
    );

    expect(touch).toEqual({
      src: 'app',
      ref: 'https://www.google.com/',
      path: '/auth?utm_source=vk&utm_campaign=belovo&foo=bar',
      utm: { utm_source: 'vk', utm_campaign: 'belovo' },
      at: '2026-10-02T10:00:00.000Z',
    });
  });

  it('records a direct visit with an empty referrer', () => {
    expect(
      buildFirstTouch('app', new URL('https://app.vezdepost.ru/'), null, now)
        .ref
    ).toBe('');
  });

  it('round-trips both decoded and still-encoded cookie values', () => {
    const touch = buildFirstTouch(
      'landing',
      new URL('https://vezdepost.ru/?utm_source=linkedin'),
      'https://www.linkedin.com/feed/?q=100%25',
      now
    );
    const json = serializeFirstTouch(touch);

    expect(parseFirstTouch(json)).toEqual(touch);
    expect(parseFirstTouch(encodeURIComponent(json))).toEqual(touch);
  });

  it('drops unknown fields, clips long values and rejects garbage', () => {
    const parsed = parseFirstTouch(
      JSON.stringify({
        src: 'evil',
        ref: 'x'.repeat(2000),
        utm: { utm_source: 'a', other: 'b' },
        at: 'not a date',
        extra: { deep: true },
      })
    );

    expect(parsed).toEqual({
      src: 'app',
      ref: 'x'.repeat(500),
      path: '',
      utm: { utm_source: 'a' },
      at: '',
    });
    expect(parseFirstTouch('%%%not-json')).toBeUndefined();
    expect(parseFirstTouch('[1,2]')).toBeUndefined();
    expect(parseFirstTouch(undefined)).toBeUndefined();
  });
});
