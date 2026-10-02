import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
import {
  buildFirstTouch,
  FIRST_TOUCH_COOKIE,
  FIRST_TOUCH_MAX_AGE_SECONDS,
  serializeFirstTouch,
} from '@gitroom/helpers/utils/first.touch';
import acceptLanguage from 'accept-language';
import {
  cookieName,
  fallbackLng,
  headerName,
  isSupportedLanguage,
  languageCookieMaxAgeSeconds,
  languages,
} from '@gitroom/react/translation/i18n.config';
acceptLanguage.languages(languages);

export const resolveProxyLanguage = (
  cookieLanguage: string | undefined,
  acceptLanguageHeader: string | null
): string => {
  if (typeof cookieLanguage !== 'undefined') {
    return isSupportedLanguage(cookieLanguage) ? cookieLanguage : fallbackLng;
  }

  return acceptLanguage.get(acceptLanguageHeader || '') || fallbackLng;
};

// Remember where an anonymous visitor came from on their first request; the
// backend copies it onto the user at registration. Server-side, so content
// blockers that hide the visit from Metrika/PostHog do not affect it.
export const rememberFirstTouch = (
  request: NextRequest,
  response: NextResponse
) => {
  if (
    request.cookies.has(FIRST_TOUCH_COOKIE) ||
    request.cookies.has('auth') ||
    !process.env.FRONTEND_URL
  ) {
    return response;
  }

  response.cookies.set({
    name: FIRST_TOUCH_COOKIE,
    value: serializeFirstTouch(
      buildFirstTouch(
        'app',
        request.nextUrl,
        request.headers.get('referer'),
        new Date()
      )
    ),
    path: '/',
    domain: getCookieUrlFromDomain(process.env.FRONTEND_URL),
    maxAge: FIRST_TOUCH_MAX_AGE_SECONDS,
    sameSite: 'lax',
    // behind Caddy the proxy sees plain http; the public scheme is in FRONTEND_URL
    secure: process.env.FRONTEND_URL.startsWith('https:'),
    httpOnly: false,
  });
  return response;
};

export async function proxy(request: NextRequest) {
  return rememberFirstTouch(request, await routeRequest(request));
}

async function routeRequest(request: NextRequest) {
  const nextUrl = request.nextUrl;
  const authCookie =
    request.cookies.get('auth') ||
    request.headers.get('auth') ||
    nextUrl.searchParams.get('loggedAuth');
  const lng = resolveProxyLanguage(
    request.cookies.get(cookieName)?.value,
    request.headers.get('Accept-Language') ||
      request.headers.get('accept-language')
  );

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(headerName, lng);

  const topResponse = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  topResponse.cookies.set({
    name: cookieName,
    value: lng,
    path: '/',
    maxAge: languageCookieMaxAgeSeconds,
    sameSite: 'lax',
    secure: nextUrl.protocol === 'https:',
    httpOnly: false,
  });

  if (nextUrl.pathname.startsWith('/modal/') && !authCookie) {
    return NextResponse.redirect(new URL(`/auth/login-required`, nextUrl.href));
  }

  if (
    nextUrl.pathname.startsWith('/uploads/') ||
    nextUrl.pathname.startsWith('/p/') ||
    nextUrl.pathname.startsWith('/provider/') ||
    nextUrl.pathname.startsWith('/icons/')
  ) {
    return topResponse;
  }

  if (
    nextUrl.pathname.startsWith('/integrations/social/') &&
    nextUrl.href.indexOf('state=login') === -1
  ) {
    return topResponse;
  }

  // If the URL is logout, delete the cookie and redirect to login
  if (nextUrl.href.indexOf('/auth/logout') > -1) {
    const response = NextResponse.redirect(
      new URL('/auth/login', nextUrl.href)
    );
    response.cookies.set('auth', '', {
      path: '/',
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: false,
          }
        : {}),
      maxAge: -1,
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
    });
    return response;
  }

  if (
    nextUrl.pathname.startsWith('/auth/register') &&
    process.env.DISABLE_REGISTRATION === 'true'
  ) {
    return NextResponse.redirect(new URL('/auth/login', nextUrl.href));
  }

  const org = nextUrl.searchParams.get('org');
  const url = new URL(nextUrl).search;
  if (!nextUrl.pathname.startsWith('/auth') && !authCookie) {
    const providers = ['google', 'settings'];
    const findIndex = providers.find((p) => nextUrl.href.indexOf(p) > -1);
    const additional = !findIndex
      ? ''
      : (url.indexOf('?') > -1 ? '&' : '?') +
        `provider=${(findIndex === 'settings'
          ? process.env.POSTIZ_GENERIC_OAUTH
            ? 'generic'
            : 'github'
          : findIndex
        ).toUpperCase()}`;
    return NextResponse.redirect(
      new URL(`/auth${url}${additional}`, nextUrl.href)
    );
  }

  // If the url is /auth and the cookie exists, redirect to /
  if (nextUrl.pathname.startsWith('/auth') && authCookie) {
    return NextResponse.redirect(new URL(`/${url}`, nextUrl.href));
  }
  if (nextUrl.pathname.startsWith('/auth') && !authCookie) {
    if (org) {
      const redirect = NextResponse.redirect(new URL(`/`, nextUrl.href));
      redirect.cookies.set('org', org, {
        ...(!process.env.NOT_SECURED
          ? {
              path: '/',
              secure: true,
              httpOnly: true,
              sameSite: false,
              domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
            }
          : {}),
        expires: new Date(Date.now() + 15 * 60 * 1000),
      });
      return redirect;
    }
    return topResponse;
  }
  try {
    if (org) {
      const { id } = await (
        await internalFetch('/user/join-org', {
          body: JSON.stringify({
            org,
          }),
          method: 'POST',
        })
      ).json();
      const redirect = NextResponse.redirect(
        new URL(`/?added=true`, nextUrl.href)
      );
      if (id) {
        redirect.cookies.set('showorg', id, {
          ...(!process.env.NOT_SECURED
            ? {
                path: '/',
                secure: true,
                httpOnly: true,
                sameSite: false,
                domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
              }
            : {}),
          expires: new Date(Date.now() + 15 * 60 * 1000),
        });
      }
      return redirect;
    }
    if (nextUrl.pathname === '/') {
      return NextResponse.redirect(
        new URL(
          !!process.env.IS_GENERAL ? '/launches' : `/analytics`,
          nextUrl.href
        )
      );
    }

    return topResponse;
  } catch (err) {
    console.log('err', err);
    return NextResponse.redirect(new URL('/auth/logout', nextUrl.href));
  }
}

// See "Matching Paths" below to learn more
export const config = {
  matcher: '/((?!api/|_next/|_static/|_vercel|[\\w-]+\\.\\w+).*)',
};
