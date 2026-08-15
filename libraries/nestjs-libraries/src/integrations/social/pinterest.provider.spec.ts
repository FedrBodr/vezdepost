import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

const response = (body: Record<string, unknown>) =>
  ({ json: vi.fn().mockResolvedValue(body) } as unknown as Response);

vi.mock(
  '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface',
  () => ({})
);
vi.mock('@gitroom/nestjs-libraries/services/make.is', () => ({
  makeId: vi.fn(() => 'state-id'),
}));
vi.mock('@gitroom/helpers/utils/has.extension', () => ({
  hasExtension: vi.fn(() => false),
}));
vi.mock('@gitroom/helpers/utils/timer', () => ({
  timer: vi.fn(),
}));
vi.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  BadBody: class extends Error {},
  SocialAbstract: class {
    checkScopes() {
      return undefined;
    }
  },
}));
vi.mock(
  '@gitroom/nestjs-libraries/dtos/posts/providers-settings/pinterest.dto',
  () => ({ PinterestSettingsDto: class {} })
);
vi.mock('@gitroom/nestjs-libraries/integrations/tool.decorator', () => ({
  Tool: () => () => undefined,
}));
vi.mock('@gitroom/nestjs-libraries/chat/rules.description.decorator', () => ({
  Rules: () => () => undefined,
}));

import { PinterestProvider } from './pinterest.provider';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  process.env = {
    ...originalEnv,
    FRONTEND_URL: 'https://app.vezdepost.ru',
    PINTEREST_CLIENT_ID: 'client-id-fixture',
    PINTEREST_CLIENT_SECRET: 'client-secret-fixture',
  };
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe('PinterestProvider refresh tokens', () => {
  it('returns the rotated refresh token from Pinterest', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        response({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 2592000,
        })
      )
      .mockResolvedValueOnce(
        response({
          id: 'account-1',
          username: 'vezdepost',
          profile_image: 'https://cdn.example/avatar.png',
        })
      );

    await expect(
      new PinterestProvider().refreshToken('old-refresh-token')
    ).resolves.toMatchObject({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresIn: 2592000,
    });
  });

  it('keeps the previous refresh token when Pinterest omits a replacement', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        response({
          access_token: 'new-access-token',
          expires_in: 2592000,
        })
      )
      .mockResolvedValueOnce(
        response({
          id: 'account-1',
          username: 'vezdepost',
          profile_image: '',
        })
      );

    await expect(
      new PinterestProvider().refreshToken('old-refresh-token')
    ).resolves.toMatchObject({ refreshToken: 'old-refresh-token' });
  });
});
