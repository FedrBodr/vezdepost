import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';

const tokeninfo = vi.fn();
const userinfoGet = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
        generateAuthUrl() {
          return '';
        }
        getToken() {
          return { tokens: {} };
        }
      },
    },
    oauth2: vi.fn(() => ({
      tokeninfo,
      userinfo: { get: userinfoGet },
    })),
  },
}));

import { GoogleProvider } from './google.provider';

describe('GoogleProvider token audience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GOOGLE_CLIENT_ID', 'our-client.apps.googleusercontent.com');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret');
    vi.stubEnv('FRONTEND_URL', 'https://app.example');
    userinfoGet.mockResolvedValue({
      data: { id: 'google-user-1', email: 'user@example.com' },
    });
  });

  it('rejects an access token minted for a different OAuth client', async () => {
    tokeninfo.mockResolvedValue({
      data: { audience: 'attacker-app.apps.googleusercontent.com' },
    });

    let thrown: unknown;
    try {
      await new GoogleProvider().getUser('stolen-token');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HttpException);
    expect(userinfoGet).not.toHaveBeenCalled();
  });

  it('accepts an access token minted for our own client', async () => {
    tokeninfo.mockResolvedValue({
      data: { audience: 'our-client.apps.googleusercontent.com' },
    });

    const user = await new GoogleProvider().getUser('legit-token');

    expect(user).toEqual({ id: 'google-user-1', email: 'user@example.com' });
  });

  it('also accepts a token minted for the YouTube client fallback', async () => {
    vi.stubEnv('YOUTUBE_CLIENT_ID', 'youtube-client.apps.googleusercontent.com');
    tokeninfo.mockResolvedValue({
      data: { audience: 'youtube-client.apps.googleusercontent.com' },
    });

    const user = await new GoogleProvider().getUser('legit-youtube-token');

    expect(user).toEqual({ id: 'google-user-1', email: 'user@example.com' });
  });
});
