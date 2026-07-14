import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeVkGroupIdentifier,
  VkGroupProvider,
} from './vk.group.provider';

const token = 'vk-community-secret-token';

const encodedCredentials = (
  group: unknown = 'https://vk.com/fedrbodr_pro',
  accessToken: unknown = token
) =>
  Buffer.from(JSON.stringify({ group, accessToken })).toString('base64');

const response = (body: unknown) =>
  Promise.resolve({ json: async () => body } as Response);

describe('normalizeVkGroupIdentifier', () => {
  it.each([
    ['https://vk.com/fedrbodr_pro', 'fedrbodr_pro'],
    ['https://www.vk.com/fedrbodr_pro/?from=groups', 'fedrbodr_pro'],
    ['vk.com/fedrbodr_pro', 'fedrbodr_pro'],
    ['fedrbodr_pro', 'fedrbodr_pro'],
    ['club123', '123'],
    ['public123', '123'],
    ['123', '123'],
    ['-123', '123'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeVkGroupIdentifier(input)).toBe(expected);
  });

  it.each(['', '   ', 'https://example.com/group', 'vk.com/a/b'])(
    'rejects invalid group value %s',
    (input) => {
      expect(normalizeVkGroupIdentifier(input)).toBeNull();
    }
  );
});

describe('VkGroupProvider community credentials', () => {
  let provider: VkGroupProvider;

  beforeEach(() => {
    provider = new VkGroupProvider();
  });

  it('declares a direct two-field connection', async () => {
    expect(provider.isBetweenSteps).toBe(false);
    expect(provider.scopes).toEqual([]);
    expect(await provider.customFields()).toEqual([
      {
        key: 'group',
        label: 'VK community link or short name',
        validation: '/^.{1,255}$/',
        type: 'text',
      },
      {
        key: 'accessToken',
        label: 'Community access token',
        validation: '/^.{10,}$/',
        type: 'password',
      },
    ]);
  });

  it('authenticates a token belonging to the requested group', async () => {
    const fetchMock = vi
      .spyOn(provider, 'fetch')
      .mockImplementationOnce(() =>
        response({
          response: {
            groups: [
              {
                id: 123,
                name: 'FedrBodr',
                screen_name: 'fedrbodr_pro',
                photo_200: 'https://vk.test/photo.jpg',
              },
            ],
          },
        })
      )
      .mockImplementationOnce(() =>
        response({ response: { groups: [{ id: 123 }] } })
      )
      .mockImplementationOnce(() =>
        response({
          response: {
            permissions: [{ name: 'manage' }, { name: 'wall' }],
          },
        })
      );

    const result = await provider.authenticate({
      code: encodedCredentials(),
      codeVerifier: 'none',
    });

    expect(result).toMatchObject({
      id: '-123',
      name: 'FedrBodr',
      username: 'fedrbodr_pro',
      picture: 'https://vk.test/photo.jpg',
      accessToken: token,
      refreshToken: '',
    });
    expect(typeof result).not.toBe('string');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const firstBody = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.vk.com/method/groups.getById'
    );
    expect(firstBody.get('group_ids')).toBe('fedrbodr_pro');
    expect(firstBody.get('access_token')).toBe(token);

    const tokenOwnerBody = fetchMock.mock.calls[1][1]?.body as FormData;
    expect(tokenOwnerBody.has('group_ids')).toBe(false);
    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://api.vk.com/method/groups.getTokenPermissions'
    );
  });

  it('rejects malformed group input before calling VK', async () => {
    const fetchMock = vi.spyOn(provider, 'fetch');

    await expect(
      provider.authenticate({
        code: encodedCredentials('https://example.com/not-vk'),
        codeVerifier: 'none',
      })
    ).resolves.toBe('Enter a valid VK community link or short name.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a safe error for an invalid token', async () => {
    vi.spyOn(provider, 'fetch').mockImplementationOnce(() =>
      response({ error: { error_code: 5, error_msg: `bad ${token}` } })
    );

    const result = await provider.authenticate({
      code: encodedCredentials(),
      codeVerifier: 'none',
    });

    expect(result).toBe('The VK community token is invalid.');
    expect(String(result)).not.toContain(token);
  });

  it('rejects a token belonging to another community', async () => {
    vi.spyOn(provider, 'fetch')
      .mockImplementationOnce(() =>
        response({ response: { groups: [{ id: 123, name: 'Requested' }] } })
      )
      .mockImplementationOnce(() =>
        response({ response: { groups: [{ id: 456, name: 'Other' }] } })
      );

    const result = await provider.authenticate({
      code: encodedCredentials(),
      codeVerifier: 'none',
    });

    expect(result).toBe('This token belongs to a different VK community.');
    expect(String(result)).not.toContain(token);
  });

  it.each([
    [[{ name: 'manage' }], 'without wall'],
    [[{ name: 'wall' }], 'without management'],
  ])('rejects permissions %s (%s)', async (permissions) => {
    vi.spyOn(provider, 'fetch')
      .mockImplementationOnce(() =>
        response({ response: { groups: [{ id: 123, name: 'Requested' }] } })
      )
      .mockImplementationOnce(() =>
        response({ response: { groups: [{ id: 123, name: 'Requested' }] } })
      )
      .mockImplementationOnce(() =>
        response({ response: { permissions } })
      );

    const result = await provider.authenticate({
      code: encodedCredentials(),
      codeVerifier: 'none',
    });

    expect(result).toBe(
      'The VK community token must allow community management and wall access.'
    );
    expect(String(result)).not.toContain(token);
  });

  it('does not expose malformed secret input in an error', async () => {
    const result = await provider.authenticate({
      code: encodedCredentials('fedrbodr_pro', { secret: token }),
      codeVerifier: 'none',
    });

    expect(result).toBe('The VK community token is invalid.');
    expect(String(result)).not.toContain(token);
  });
});
