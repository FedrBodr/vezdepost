import { GenerateAuthUrlResponse } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { createHash, randomBytes } from 'crypto';
import { BadBody, RefreshToken } from '../social.abstract';
import { parseVkPositiveIntegerId, unwrapVkResponse } from './vk.response';

export type VkIdentifier = 'vk' | 'vk-group';

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

// Stored token lifetime is shortened so the scheduled refresh runs while the
// access token is still valid and a temporary VK ID failure can be retried.
const REFRESH_AHEAD_SECONDS = 600;

// A failed refresh is retried after these delays before it is reported as
// transient; VK ID rejections (invalid_grant and friends) are never retried.
const REFRESH_RETRY_DELAYS_MS = [2000, 10000, 30000];

const DEFINITIVE_OAUTH_ERRORS =
  /\b(invalid_grant|invalid_client|unauthorized_client|invalid_request|invalid_scope|access_denied|invalid_token)\b/;

export class VkTransientRefreshError extends Error {
  readonly transient = true;

  constructor(cause: string) {
    super(`VK ID refresh failed after retries: ${cause}`);
    this.name = 'VkTransientRefreshError';
  }
}

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
  // VK ID OAuth endpoints report failures as {"error": "invalid_grant", ...}
  // rather than the VK API envelope; keep only the error code.
  const oauthError =
    payload && typeof payload === 'object'
      ? (payload as { error?: unknown }).error
      : undefined;
  if (typeof oauthError === 'string') {
    const code = /^[a-z_]{1,64}$/.test(oauthError)
      ? oauthError
      : 'unknown_error';
    throw new BadBody(
      'vk',
      JSON.stringify({ error: code }),
      {} as BodyInit,
      `VK ${method} failed with ${code}`
    );
  }

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
    return badResponse('oauth2/auth', `invalid ${field} or device ID`);
  }
  const [secret, deviceId] = value.split('&&&&');
  if (!secret.trim() || !deviceId || !deviceId.trim()) {
    return badResponse('oauth2/auth', `invalid ${field} or device ID`);
  }
  return { secret, deviceId };
};

const parseOAuthTokens = (payload: unknown): VkOAuthTokens => {
  if (!payload || typeof payload !== 'object') {
    badResponse('oauth2/auth', 'invalid token fields');
  }

  const value = payload as Record<string, unknown>;
  const accessToken = value.access_token;
  const refreshToken = value.refresh_token;
  const expiresIn = value.expires_in;
  if (
    typeof accessToken !== 'string' ||
    !accessToken.trim() ||
    typeof refreshToken !== 'string' ||
    !refreshToken.trim() ||
    typeof expiresIn !== 'number' ||
    !Number.isFinite(expiresIn) ||
    !Number.isInteger(expiresIn) ||
    expiresIn <= 0
  ) {
    return badResponse('oauth2/auth', 'invalid token fields');
  }

  return {
    accessToken,
    refreshToken,
    expiresIn,
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
  const firstName = value.first_name;
  const lastName = value.last_name;
  const avatar = value.avatar;
  const id = parseVkPositiveIntegerId(
    value.user_id,
    'oauth2/user_info',
    'user ID'
  );
  if (
    typeof firstName !== 'string' ||
    !firstName ||
    typeof lastName !== 'string' ||
    !lastName ||
    (avatar !== undefined && typeof avatar !== 'string')
  ) {
    return badResponse('oauth2/user_info', 'invalid user');
  }

  return {
    id,
    firstName,
    lastName,
    avatar: typeof avatar === 'string' ? avatar : '',
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
  expiresIn: refreshAheadExpiresIn(tokens.expiresIn),
});

const refreshAheadExpiresIn = (expiresIn: number) =>
  expiresIn > REFRESH_AHEAD_SECONDS * 2
    ? expiresIn - REFRESH_AHEAD_SECONDS
    : expiresIn;

const isDefinitiveRefreshFailure = (error: unknown) => {
  if (error instanceof RefreshToken) {
    return true;
  }
  if (!(error instanceof BadBody)) {
    return false;
  }
  // VK ID answered, but with an error or a malformed token payload.
  if (error.message.startsWith('VK oauth2/auth ')) {
    return true;
  }
  // Raised by the HTTP layer: definitive only when the body is an OAuth
  // rejection, otherwise (5xx pages, gateway errors) it is worth a retry.
  const json = (error.details?.[0] as { json?: unknown } | undefined)?.json;
  return DEFINITIVE_OAUTH_ERRORS.test(
    `${error.message} ${typeof json === 'string' ? json : ''}`
  );
};

const describeFailure = (error: unknown) =>
  error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';

const sleepMs = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  sleep?: (ms: number) => Promise<void>;
}): Promise<VkUserOAuthResult> => {
  const { secret: refreshToken, deviceId } = parseDeviceBoundValue(
    input.refresh,
    'refresh token'
  );
  const sleep = input.sleep ?? sleepMs;
  const refreshBody = () => {
    const formData = new FormData();
    formData.append('grant_type', 'refresh_token');
    formData.append('refresh_token', refreshToken);
    formData.append('client_id', process.env.VK_ID!);
    formData.append('device_id', deviceId);
    formData.append('state', makeId(32));
    formData.append('scope', input.scopes.join(' '));
    return formData;
  };

  let tokens: VkOAuthTokens | undefined;
  for (let attempt = 0; !tokens; attempt++) {
    try {
      tokens = await requestTokens({
        body: refreshBody(),
        fetcher: input.fetcher,
      });
    } catch (error) {
      if (isDefinitiveRefreshFailure(error)) {
        throw error;
      }
      if (attempt >= REFRESH_RETRY_DELAYS_MS.length) {
        throw new VkTransientRefreshError(describeFailure(error));
      }
      await sleep(REFRESH_RETRY_DELAYS_MS[attempt]);
    }
  }

  // The old refresh token is already spent: a failed profile lookup must not
  // drop the rotated pair, so the profile is best-effort here.
  const user = await requestUser({
    accessToken: tokens.accessToken,
    fetcher: input.fetcher,
  }).catch(
    (): VkUserInfo => ({
      id: '',
      firstName: '',
      lastName: '',
      avatar: '',
    })
  );
  return asUserOAuthResult(tokens, user, deviceId);
};
