import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@gitroom/helpers/utils/internal.fetch', () => ({
  internalFetch: vi.fn(),
}));
import { POST } from './route';
import { handleShare } from '@gitroom/frontend/components/mobile/share.handler';
import { decodeSharePayload } from '@gitroom/frontend/components/mobile/share.payload';

const payloadOf = (path: string) =>
  decodeSharePayload(
    new URL(path, 'https://app.test').searchParams.get('shared')
  );

describe('handleShare', () => {
  it('uploads shared files and redirects with the payload', async () => {
    const upload = vi.fn(async (file: File) => ({
      id: `id-${file.name}`,
      path: `/u/${file.name}`,
    }));
    const form = new FormData();
    form.append('text', 'Из галереи');
    form.append('media', new File(['a'], 'a.jpg', { type: 'image/jpeg' }));
    form.append('media', new File(['b'], 'b.mp4', { type: 'video/mp4' }));

    const target = await handleShare(form, { upload });

    expect(target.startsWith('/m?shared=')).toBe(true);
    expect(payloadOf(target)).toEqual({
      text: 'Из галереи',
      media: [
        { id: 'id-a.jpg', path: '/u/a.jpg' },
        { id: 'id-b.mp4', path: '/u/b.mp4' },
      ],
    });
  });

  it('redirects with text only', async () => {
    const upload = vi.fn();
    const form = new FormData();
    form.append('title', 'Заголовок');
    form.append('text', 'Только текст');
    form.append('url', 'https://example.com');

    const target = await handleShare(form, { upload });

    expect(upload).not.toHaveBeenCalled();
    expect(payloadOf(target)).toEqual({
      text: 'Заголовок\nТолько текст\nhttps://example.com',
      media: [],
    });
  });

  it('reports files the upload rejects instead of dropping them silently', async () => {
    const upload = vi.fn(async () => null);
    const form = new FormData();
    form.append('media', new File(['a'], 'a.jpg', { type: 'image/jpeg' }));

    const target = await handleShare(form, { upload });
    expect(payloadOf(target)).toEqual({ text: '', media: [], failed: 1 });
  });

  it('goes to a plain /m when nothing at all was shared', async () => {
    expect(await handleShare(new FormData(), { upload: vi.fn() })).toBe('/m');
  });
});

describe('POST /m/share', () => {
  it('redirects to the editor with share_error when the body cannot be read', async () => {
    const request = new NextRequest('https://app.vezdepost.ru/m/share', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=cut',
        cookie: 'auth=token',
      },
      body: '--cut\r\nContent-Disposition: form-data; name="media"; filename="a.jpg"\r\n\r\ntruncated',
    });
    const response = await POST(request);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      'https://app.vezdepost.ru/m?share_error=1'
    );
  });

  it('sends an unauthenticated share to login', async () => {
    const request = new NextRequest('https://app.vezdepost.ru/m/share', {
      method: 'POST',
    });
    const response = await POST(request);
    expect(response.headers.get('location')).toBe(
      'https://app.vezdepost.ru/auth?returnUrl=%2Fm'
    );
  });
});

describe('proxy matcher', () => {
  it('leaves /m/share to the route handler so the 10 MB proxy body cap does not apply', async () => {
    const { config } = await import('@gitroom/frontend/proxy');
    expect(config.matcher).toContain('m/share');
  });
});
