export type SharePayload = {
  text: string;
  media: { id: string; path: string }[];
};

const toBase64Url = (value: string) =>
  Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const fromBase64Url = (value: string) =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
    'utf8'
  );

export const encodeSharePayload = (payload: SharePayload) =>
  toBase64Url(JSON.stringify(payload));

export const decodeSharePayload = (
  value: string | null
): SharePayload | null => {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fromBase64Url(value));
    if (typeof parsed?.text !== 'string' || !Array.isArray(parsed?.media)) {
      return null;
    }
    return {
      text: parsed.text,
      media: parsed.media
        .filter(
          (m: any) =>
            m && typeof m.id === 'string' && typeof m.path === 'string'
        )
        .map((m: any) => ({ id: m.id, path: m.path })),
    };
  } catch {
    return null;
  }
};
