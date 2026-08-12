import { GenerateAuthUrlResponse } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { createHash, randomBytes } from 'crypto';
import { BadBody } from '../social.abstract';
import { parseVkPositiveIntegerId, unwrapVkResponse } from './vk.response';

type VkIdentifier = 'vk' | 'vk-group';

type VkFetcher = (url: string, options?: RequestInit) => Promise<Response>;

type VkOAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

type VkUserInfo = {
  id: string;
  firstName: string;
  lastName: string;
  avatar: string;
};

export type VkUserOAuthResult = {
  userId: string;
  name: string;
  username: string;
  picture: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

const oauthEndpoint = 'https://id.vk.com/oauth2/auth';
const userInfoEndpoint = 'https://id.vk.com/oauth2/user_info';

const badResponse = (method: string, detail: string): never => {
  throw new BadBody(
    'vk',
    '{}',
    {} as BodyInit,
    `VK ${method} returned ${detail}`
  );
};

const unwrapPayload = <T>(payload: unknown, method: string): T => {
  if (
    payload &&
    typeof payload === 'object' &&
    ('response' in payload || 'error' in payload)
  ) {
    return unwrapVkResponse<T>(payload, method);
  }

  return unwrapVkResponse<T>({ response: payload }, method);
};

const parseDeviceBoundValue = (value: unknown, field: string) => {
  if (typeof value !== 'string') {
    badResponse('oauth2/auth', `invalid ${field} or device ID`);
  }
  const [secret, deviceId] = value.split('&&&&');
  if (!secret.trim() || !deviceId?.trim()) {
    badResponse('oauth2/auth', `invalid ${field} or device ID`);
  }
  return { secret, deviceId };
};

const parseOAuthTokens = (payload: unknown): VkOAuthTokens => {
  if (!payload || typeof payload !== 'object') {
    badResponse('oauth2/auth', 'invalid token fields');
  }

  const value = payload as Record<string, unknown>;
  if (
    typeof value.access_token !== 'string' ||
    !value.access_token.trim() ||
    typeof value.refresh_token !== 'string' ||
    !value.refresh_token.trim() ||
    typeof value.expires_in !== 'number' ||
    !Number.isFinite(value.expires_in) ||
    !Number.isInteger(value.expires_in) ||
    value.expires_in <= 0
  ) {
    badResponse('oauth2/auth', 'invalid token fields');
  }

  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    expiresIn: value.expires_in,
  };
};

const parseUserInfo = (payload: unknown): VkUserInfo => {
  if (!payload || typeof payload !== 'object') {
    badResponse('oauth2/user_info', 'invalid user');
  }

  const user = (payload as Record<string, unknown>).user;
  if (!user || typeof user !== 'object') {
    badResponse('oauth2/user_info', 'invalid user');
  }

  const value = user as Record<string, unknown>;
  const id = parseVkPositiveIntegerId(
    value.user_id,
    'oauth2/user_info',
    'user ID'
  );
  if (
    typeof value.first_name !== 'string' ||
    !value.first_name ||
    typeof value.last_name !== 'string' ||
    !value.last_name ||
    (value.avatar !== undefined && typeof value.avatar !== 'string')
  ) {
    badResponse('oauth2/user_info', 'invalid user');
  }

  return {
    id,
    firstName: value.first_name,
    lastName: value.last_name,
    avatar: typeof value.avatar === 'string' ? value.avatar : '',
  };
};

export const buildVkRedirectUri = (identifier: VkIdentifier): string =>
  `${
    process?.env.FRONTEND_URL?.indexOf('https') == -1
      ? `https://redirectmeto.com/${process?.env.FRONTEND_URL}`
      : `${process?.env.FRONTEND_URL}`
  }/integrations/social/${identifier}`;

export const generateVkAuthUrl = (input: {
  identifier: VkIdentifier;
  scopes: string[];
}): GenerateAuthUrlResponse => {
  const state = makeId(32);
  const codeVerifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  return {
    url:
      'https://id.vk.com/authorize' +
      `?response_type=code` +
      `&client_id=${process.env.VK_ID}` +
      `&code_challenge_method=S256` +
      `&code_challenge=${challenge}` +
      `&redirect_uri=${encodeURIComponent(
        buildVkRedirectUri(input.identifier)
      )}` +
      `&state=${state}` +
      `&scope=${encodeURIComponent(input.scopes.join(' '))}`,
    codeVerifier,
    state,
  };
};

const requestTokens = async (input: {
  body: FormData;
  fetcher: VkFetcher;
}): Promise<VkOAuthTokens> =>
  parseOAuthTokens(
    unwrapPayload<unknown>(
      await (
        await input.fetcher(oauthEndpoint, { method: 'POST', body: input.body })
      ).json(),
      'oauth2/auth'
    )
  );

const requestUser = async (input: {
  accessToken: string;
  fetcher: VkFetcher;
}): Promise<VkUserInfo> => {
  const formData = new FormData();
  formData.append('client_id', process.env.VK_ID!);
  formData.append('access_token', input.accessToken);

  return parseUserInfo(
    unwrapPayload<unknown>(
      await (
        await input.fetcher(userInfoEndpoint, {
          method: 'POST',
          body: formData,
        })
      ).json(),
      'oauth2/user_info'
    )
  );
};

const asUserOAuthResult = (
  tokens: VkOAuthTokens,
  user: VkUserInfo,
  deviceId: string
): VkUserOAuthResult => ({
  userId: user.id,
  name: user.firstName + ' ' + user.lastName,
  username: user.firstName.toLowerCase(),
  picture: user.avatar,
  accessToken: tokens.accessToken,
  refreshToken: tokens.refreshToken + '&&&&' + deviceId,
  expiresIn: tokens.expiresIn,
});

export const authenticateVkUser = async (input: {
  identifier: VkIdentifier;
  code: string;
  codeVerifier: string;
  fetcher: VkFetcher;
}): Promise<VkUserOAuthResult> => {
  const { secret: code, deviceId } = parseDeviceBoundValue(
    input.code,
    'authorization code'
  );
  const formData = new FormData();
  formData.append('client_id', process.env.VK_ID!);
  formData.append('grant_type', 'authorization_code');
  formData.append('code_verifier', input.codeVerifier);
  formData.append('device_id', deviceId);
  formData.append('code', code);
  formData.append('redirect_uri', buildVkRedirectUri(input.identifier));

  const tokens = await requestTokens({
    body: formData,
    fetcher: input.fetcher,
  });
  const user = await requestUser({
    accessToken: tokens.accessToken,
    fetcher: input.fetcher,
  });
  return asUserOAuthResult(tokens, user, deviceId);
};

export const refreshVkUser = async (input: {
  refresh: string;
  scopes: string[];
  fetcher: VkFetcher;
}): Promise<VkUserOAuthResult> => {
  const { secret: refreshToken, deviceId } = parseDeviceBoundValue(
    input.refresh,
    'refresh token'
  );
  const formData = new FormData();
  formData.append('grant_type', 'refresh_token');
  formData.append('refresh_token', refreshToken);
  formData.append('client_id', process.env.VK_ID!);
  formData.append('device_id', deviceId);
  formData.append('state', makeId(32));
  formData.append('scope', input.scopes.join(' '));

  const tokens = await requestTokens({
    body: formData,
    fetcher: input.fetcher,
  });
  const user = await requestUser({
    accessToken: tokens.accessToken,
    fetcher: input.fetcher,
  });
  return asUserOAuthResult(tokens, user, deviceId);
};
