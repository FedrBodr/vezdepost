import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GoogleProvider } from './google.provider';

const originalEnv = { ...process.env };

describe('GoogleProvider OAuth configuration', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      FRONTEND_URL: 'https://app.vezdepost.ru',
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      YOUTUBE_CLIENT_ID: 'youtube-client-id',
      YOUTUBE_CLIENT_SECRET: 'youtube-client-secret',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('prefers dedicated Google credentials and callback', () => {
    const url = new URL(new GoogleProvider().generateLink());

    expect(url.searchParams.get('client_id')).toBe('google-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.vezdepost.ru/auth?provider=GOOGLE'
    );
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ]);
  });

  it('uses an explicitly supplied redirect URI', () => {
    const url = new URL(
      new GoogleProvider().generateLink({
        redirect_uri: 'postiz://auth/callback',
      })
    );

    expect(url.searchParams.get('redirect_uri')).toBe(
      'postiz://auth/callback'
    );
  });

  it('falls back atomically to the legacy YouTube credential pair', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    const url = new URL(new GoogleProvider().generateLink());

    expect(url.searchParams.get('client_id')).toBe('youtube-client-id');
  });

  it('rejects an incomplete dedicated Google credential pair', () => {
    delete process.env.GOOGLE_CLIENT_SECRET;

    expect(() => new GoogleProvider().generateLink()).toThrow(
      'Google OAuth is misconfigured: set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'
    );
  });

  it('fails clearly when no credential pair is configured', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.YOUTUBE_CLIENT_ID;
    delete process.env.YOUTUBE_CLIENT_SECRET;

    expect(() => new GoogleProvider().generateLink()).toThrow(
      'Google OAuth is not configured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'
    );
  });
});
