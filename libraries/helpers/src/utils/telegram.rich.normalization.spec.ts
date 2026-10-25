import { describe, expect, it } from 'vitest';
import { buildTelegramRichMessage } from './telegram.rich.normalization';

describe('buildTelegramRichMessage', () => {
  it('leaves a text-only post as bare html with no media array', () => {
    expect(buildTelegramRichMessage('<p>hello</p>', [])).toEqual({
      html: '<p>hello</p>',
    });
  });

  it('rewrites a rendered https <img> to a tg://photo link and declares the media', () => {
    const result = buildTelegramRichMessage(
      '<img src="https://cdn.test/a.jpg"/>\n\n<p>Body</p>',
      [{ type: 'image', path: 'https://cdn.test/a.jpg' }]
    );

    expect(result.html).toBe(
      '<img src="tg://photo?id=p0"/>\n\n<p>Body</p>'
    );
    expect(result.media).toEqual([
      { id: 'p0', media: { type: 'photo', media: 'https://cdn.test/a.jpg' } },
    ]);
  });

  it('prepends a tg://photo reference when the html does not embed the image', () => {
    const result = buildTelegramRichMessage('<p>Body only</p>', [
      { type: 'image', path: 'https://cdn.test/a.jpg' },
    ]);

    expect(result.html).toBe(
      '<img src="tg://photo?id=p0"/>\n\n<p>Body only</p>'
    );
    expect(result.media).toEqual([
      { id: 'p0', media: { type: 'photo', media: 'https://cdn.test/a.jpg' } },
    ]);
  });

  it('numbers multiple photos sequentially', () => {
    const result = buildTelegramRichMessage(
      '<img src="https://cdn.test/a.jpg"/>\n\n<img src="https://cdn.test/b.jpg"/>\n\n<p>Body</p>',
      [
        { type: 'image', path: 'https://cdn.test/a.jpg' },
        { type: 'image', path: 'https://cdn.test/b.jpg' },
      ]
    );

    expect(result.html).toContain('tg://photo?id=p0');
    expect(result.html).toContain('tg://photo?id=p1');
    expect(result.media).toEqual([
      { id: 'p0', media: { type: 'photo', media: 'https://cdn.test/a.jpg' } },
      { id: 'p1', media: { type: 'photo', media: 'https://cdn.test/b.jpg' } },
    ]);
  });

  it('ignores non-image and non-https media (no media array)', () => {
    expect(
      buildTelegramRichMessage('<p>v</p>', [
        { type: 'video', path: 'https://cdn.test/v.mp4' },
      ])
    ).toEqual({ html: '<p>v</p>' });

    expect(
      buildTelegramRichMessage('<p>l</p>', [
        { type: 'image', path: '/var/postiz/uploads/a.jpg' },
      ])
    ).toEqual({ html: '<p>l</p>' });
  });
});
