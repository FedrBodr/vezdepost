import { createHash } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { BadBody, RefreshToken } from '../social.abstract';
import {
  authenticateVkUser,
  buildVkRedirectUri,
  generateVkAuthUrl,
  refreshVkUser,
  VkTransientRefreshError,
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
      expiresIn: 3000,
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

  describe('refresh resilience', () => {
    const tokens = response({
      response: {
        access_token: 'new-access-secret',
        refresh_token: 'new-refresh-secret',
        expires_in: 3600,
      },
    });
    const user = response({
      response: {
        user: { user_id: 123, first_name: 'Ada', last_name: 'Lovelace' },
      },
    });
    const noSleep = vi.fn().mockResolvedValue(undefined);
    const refresh = (fetcher: ReturnType<typeof vi.fn>) =>
      refreshVkUser({
        refresh: 'old-refresh-secret&&&&device-1',
        scopes: ['wall'],
        fetcher,
        sleep: noSleep,
      });

    it('retries the token request after a network failure', async () => {
      const fetcher = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(tokens)
        .mockResolvedValueOnce(user);

      await expect(refresh(fetcher)).resolves.toMatchObject({
        accessToken: 'new-access-secret',
        refreshToken: 'new-refresh-secret&&&&device-1',
      });
      expect(fetcher).toHaveBeenCalledTimes(3);
    });

    it('reports exhausted temporary failures as transient, without secrets', async () => {
      const fetcher = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

      const error = await refresh(fetcher).catch((e) => e);

      expect(error).toBeInstanceOf(VkTransientRefreshError);
      expect(error.transient).toBe(true);
      expect(error.message).toContain('fetch failed');
      expect(`${error} ${JSON.stringify(error)}`).not.toContain(
        'old-refresh-secret'
      );
      expect(fetcher).toHaveBeenCalledTimes(4);
    });

    it('does not retry a refresh token that VK ID rejected', async () => {
      const fetcher = vi.fn().mockResolvedValue(
        response({
          error: 'invalid_grant',
          error_description: 'Refresh token is expired',
        })
      );

      const error = await refresh(fetcher).catch((e) => e);

      expect(error).toBeInstanceOf(BadBody);
      expect(error).not.toBeInstanceOf(VkTransientRefreshError);
      expect(error.message).toContain('invalid_grant');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('retries a gateway error raised by the HTTP layer', async () => {
      const fetcher = vi
        .fn()
        .mockRejectedValueOnce(
          new BadBody(
            'vk',
            '<html>502 Bad Gateway</html>',
            {} as BodyInit,
            'Unknown Error'
          )
        )
        .mockResolvedValueOnce(tokens)
        .mockResolvedValueOnce(user);

      await expect(refresh(fetcher)).resolves.toMatchObject({
        accessToken: 'new-access-secret',
      });
      expect(fetcher).toHaveBeenCalledTimes(3);
    });

    it('does not retry an OAuth rejection raised by the HTTP layer', async () => {
      const fetcher = vi
        .fn()
        .mockRejectedValue(
          new BadBody(
            'vk',
            '{"error":"invalid_grant","error_description":"expired"}',
            {} as BodyInit,
            'Unknown Error'
          )
        );

      await expect(refresh(fetcher)).rejects.not.toBeInstanceOf(
        VkTransientRefreshError
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('does not retry an expired-token API error', async () => {
      const fetcher = vi
        .fn()
        .mockRejectedValue(
          new RefreshToken('vk', '{}', {} as BodyInit, 'expired')
        );

      await expect(refresh(fetcher)).rejects.toBeInstanceOf(RefreshToken);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('keeps the rotated tokens when the profile request fails', async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(tokens)
        .mockRejectedValue(new TypeError('fetch failed'));

      await expect(refresh(fetcher)).resolves.toMatchObject({
        accessToken: 'new-access-secret',
        refreshToken: 'new-refresh-secret&&&&device-1',
        expiresIn: 3000,
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('schedules the next refresh ten minutes before the token expires', async () => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(tokens)
        .mockResolvedValueOnce(user);

      await expect(refresh(fetcher)).resolves.toMatchObject({
        expiresIn: 3000,
      });
    });
  });
});
