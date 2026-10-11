import { google } from 'googleapis';
import { HttpException } from '@nestjs/common';
import {
  AuthProvider,
  AuthProviderAbstract,
} from '@gitroom/backend/services/auth/providers.interface';

const defaultRedirect = () =>
  `${process.env.FRONTEND_URL}/auth?provider=GOOGLE`;

const getCredentials = () => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (googleClientId || googleClientSecret) {
    if (!googleClientId || !googleClientSecret) {
      throw new Error(
        'Google OAuth is misconfigured: set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'
      );
    }

    return { clientId: googleClientId, clientSecret: googleClientSecret };
  }

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'Google OAuth is not configured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'
    );
  }

  return { clientId, clientSecret };
};

const makeClient = (redirectUri: string) => {
  const { clientId, clientSecret } = getCredentials();
  return new google.auth.OAuth2({ clientId, clientSecret, redirectUri });
};

@AuthProvider({ provider: 'GOOGLE' })
export class GoogleProvider extends AuthProviderAbstract {
  generateLink(query?: { redirect_uri?: string; state?: string }) {
    const redirectUri = query?.redirect_uri || defaultRedirect();
    return makeClient(redirectUri).generateAuthUrl({
      access_type: 'online',
      prompt: 'consent',
      state: query?.state || 'login',
      redirect_uri: redirectUri,
      scope: [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
    });
  }

  async getToken(code: string, redirectUri?: string) {
    const client = makeClient(redirectUri || defaultRedirect());
    try {
      const { tokens } = await client.getToken(code);
      return tokens.access_token!;
    } catch (err: any) {
      // The code is single use and short lived (callback reloaded or too slow)
      if (err?.response?.data?.error === 'invalid_grant') {
        throw new HttpException(
          'Google sign-in expired, please sign in again',
          400
        );
      }
      throw err;
    }
  }

  async getUser(providerToken: string) {
    const client = makeClient(defaultRedirect());
    client.setCredentials({ access_token: providerToken });
    const { data } = await google
      .oauth2({ version: 'v2', auth: client })
      .userinfo.get();

    return {
      id: data.id!,
      email: data.email!,
    };
  }
}
