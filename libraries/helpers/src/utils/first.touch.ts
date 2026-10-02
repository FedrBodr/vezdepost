// First-touch attribution: where a visitor came from on their very first visit.
// Written once into a cookie shared by vezdepost.ru (landing, inline script in
// deploy/landing/index.html — keep the format in sync) and the app (Next proxy),
// then copied onto the User row at registration.

export const FIRST_TOUCH_COOKIE = 'vp_first_touch';
export const FIRST_TOUCH_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;
const MAX_URL_LENGTH = 500;
const MAX_UTM_LENGTH = 200;

export interface FirstTouch {
  src: 'landing' | 'app';
  ref: string;
  path: string;
  utm: Partial<Record<(typeof UTM_KEYS)[number], string>>;
  at: string;
}

const clip = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : '';

export const buildFirstTouch = (
  src: FirstTouch['src'],
  entryUrl: URL,
  referrer: string | null,
  now: Date
): FirstTouch => {
  const utm: FirstTouch['utm'] = {};
  for (const key of UTM_KEYS) {
    const value = entryUrl.searchParams.get(key);
    if (value) {
      utm[key] = clip(value, MAX_UTM_LENGTH);
    }
  }

  return {
    src,
    ref: clip(referrer || '', MAX_URL_LENGTH),
    path: clip(entryUrl.pathname + entryUrl.search, MAX_URL_LENGTH),
    utm,
    at: now.toISOString(),
  };
};

// Plain JSON: cookie writers (Next cookies API, landing script) URL-encode it.
export const serializeFirstTouch = (touch: FirstTouch) => JSON.stringify(touch);

const decodeJson = (raw: string) => {
  try {
    return JSON.parse(raw);
  } catch {
    // value that was not URL-decoded by the cookie parser
    return JSON.parse(decodeURIComponent(raw));
  }
};

// The cookie is client-controlled: accept only the known shape, clip lengths.
export const parseFirstTouch = (
  raw?: string | null
): FirstTouch | undefined => {
  if (!raw) {
    return undefined;
  }

  let data: any;
  try {
    data = decodeJson(raw);
  } catch {
    return undefined;
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return undefined;
  }

  const utm: FirstTouch['utm'] = {};
  if (data.utm && typeof data.utm === 'object') {
    for (const key of UTM_KEYS) {
      const value = clip(data.utm[key], MAX_UTM_LENGTH);
      if (value) {
        utm[key] = value;
      }
    }
  }

  const at = new Date(clip(data.at, 40));

  return {
    src: data.src === 'landing' ? 'landing' : 'app',
    ref: clip(data.ref, MAX_URL_LENGTH),
    path: clip(data.path, MAX_URL_LENGTH),
    utm,
    at: isNaN(at.getTime()) ? '' : at.toISOString(),
  };
};
