import { describe, expect, it, vi } from 'vitest';
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

  it('skips files the upload rejects and goes to a plain /m when nothing is left', async () => {
    const upload = vi.fn(async () => null);
    const form = new FormData();
    form.append('media', new File(['a'], 'a.jpg', { type: 'image/jpeg' }));

    expect(await handleShare(form, { upload })).toBe('/m');
  });
});
