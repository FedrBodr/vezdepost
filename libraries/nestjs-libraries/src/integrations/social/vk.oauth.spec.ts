import { createHash } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { BadBody } from '../social.abstract';
import {
  authenticateVkUser,
  buildVkRedirectUri,
  generateVkAuthUrl,
  refreshVkUser,
} from './vk.oauth';

const response = (body: unknown) => ({ json: async () => body } as Response);

const formValue = (init: RequestInit | undefined, key: string) =>
  (init?.body as FormData).get(key);

const expectSanitizedFailure = async (
  request: Promise<unknown>,
  secrets: string[]
) => {
  let thrown: unknown;
  try {
    await request;
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(BadBody);
  const serialized = `${String(thrown)} ${JSON.stringify(thrown)}`;
  for (const secret of secrets) {
    expect(serialized).not.toContain(secret);
  }
};

describe('VK ID OAuth helpers', () => {
  it('builds distinct redirect URIs for personal and group OAuth', () => {
    process.env.FRONTEND_URL = 'https://app.example.test';

    expect(buildVkRedirectUri('vk')).toBe(
      'https://app.example.test/integrations/social/vk'
    );
    expect(buildVkRedirectUri('vk-group')).toBe(
      'https://app.example.test/integrations/social/vk-group'
    );
  });

  it('generates an S256 authorization challenge for the requested redirect URI', () => {
    process.env.FRONTEND_URL = 'https://app.example.test';
    process.env.VK_ID = 'vk-client-id';

    const auth = generateVkAuthUrl({
      identifier: 'vk-group',
      scopes: ['groups', 'wall'],
    });
    const url = new URL(auth.url);
    const challenge = createHash('sha256')
      .update(auth.codeVerifier)
      .digest('base64url');

    expect(url.origin + url.pathname).toBe('https://id.vk.com/authorize');
    expect(url.searchParams.get('client_id')).toBe('vk-client-id');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(challenge);
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example.test/integrations/social/vk-group'
    );
    expect(url.searchParams.get('scope')).toBe('groups wall');
  });

  it('authenticates with the device ID and returns a device-bound refresh token', async () => {
    process.env.FRONTEND_URL = 'https://app.example.test';
    process.env.VK_ID = 'vk-client-id';
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          response: {
            access_token: 'access-secret',
            refresh_token: 'refresh-secret',
            expires_in: 3600,
          },
        })
      )
      .mockResolvedValueOnce(
        response({
          response: {
            user: {
              user_id: '123',
              first_name: 'Ada',
              last_name: 'Lovelace',
              avatar: 'https://cdn.example.test/avatar.png',
            },
          },
        })
      );

    await expect(
      authenticateVkUser({
        identifier: 'vk',
        code: 'authorization-code&&&&device-1',
        codeVerifier: 'verifier',
        fetcher,
      })
    ).resolves.toEqual({
      userId: '123',
      name: 'Ada Lovelace',
      username: 'ada',
      picture: 'https://cdn.example.test/avatar.png',
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret&&&&device-1',
      expiresIn: 3600,
    });
    expect(formValue(fetcher.mock.calls[0][1], 'device_id')).toBe('device-1');
    expect(formValue(fetcher.mock.calls[0][1], 'redirect_uri')).toBe(
      'https://app.example.test/integrations/social/vk'
    );
  });

  it('rejects malformed token and user payloads without leaking token values', async () => {
    const invalidTokenFetcher = vi.fn().mockResolvedValue(
      response({
        response: {
          access_token: 'access-secret',
          refresh_token: 'refresh-secret',
          expires_in: 0,
        },
      })
    );

    await expectSanitizedFailure(
      authenticateVkUser({
        identifier: 'vk',
        code: 'authorization-code&&&&device-1',
        codeVerifier: 'verifier',
        fetcher: invalidTokenFetcher,
      }),
      ['access-secret', 'refresh-secret']
    );
    expect(invalidTokenFetcher).toHaveBeenCalledTimes(1);

    const invalidUserFetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          response: {
            access_token: 'access-secret',
            refresh_token: 'refresh-secret',
            expires_in: 3600,
          },
        })
      )
      .mockResolvedValueOnce(
        response({ response: { user: { user_id: '123' } } })
      );

    await expectSanitizedFailure(
      authenticateVkUser({
        identifier: 'vk',
        code: 'authorization-code&&&&device-1',
        codeVerifier: 'verifier',
        fetcher: invalidUserFetcher,
      }),
      ['access-secret', 'refresh-secret']
    );
  });

  it('passes requested scopes when refreshing a device-bound token', async () => {
    process.env.VK_ID = 'vk-client-id';
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          response: {
            access_token: 'new-access-secret',
            refresh_token: 'new-refresh-secret',
            expires_in: 3600,
          },
        })
      )
      .mockResolvedValueOnce(
        response({
          response: {
            user: {
              user_id: 123,
              first_name: 'Ada',
              last_name: 'Lovelace',
            },
          },
        })
      );

    await refreshVkUser({
      refresh: 'old-refresh-secret&&&&device-1',
      scopes: ['wall', 'photos'],
      fetcher,
    });

    expect(formValue(fetcher.mock.calls[0][1], 'refresh_token')).toBe(
      'old-refresh-secret'
    );
    expect(formValue(fetcher.mock.calls[0][1], 'device_id')).toBe('device-1');
    expect(formValue(fetcher.mock.calls[0][1], 'scope')).toBe('wall photos');
  });
});
