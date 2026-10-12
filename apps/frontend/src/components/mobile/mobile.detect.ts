export const DESKTOP_COOKIE = 'vz-desktop';

/** Phones only: tablets keep the desktop layout. */
export const isPhoneUserAgent = (userAgent: string | null | undefined) => {
  if (!userAgent) {
    return false;
  }
  if (/iPad/i.test(userAgent)) {
    return false;
  }
  if (/iPhone|iPod/i.test(userAgent)) {
    return true;
  }
  // Android phones carry "Mobile"; Android tablets do not.
  return /Android/i.test(userAgent) && /Mobile/i.test(userAgent);
};

/** Paths whose mobile counterpart is the /m root. */
const MOBILE_ROOTS = new Set(['/launches']);

export const resolveMobileRedirect = ({
  pathname,
  search,
  userAgent,
  desktopCookie,
  enabled,
}: {
  pathname: string;
  search: string;
  userAgent: string | null | undefined;
  desktopCookie: string | undefined;
  enabled: boolean;
}): string | null => {
  if (!enabled || desktopCookie === '1' || !MOBILE_ROOTS.has(pathname)) {
    return null;
  }
  if (!isPhoneUserAgent(userAgent)) {
    return null;
  }
  return `/m${search || ''}`;
};
