import { describe, expect, it } from 'vitest';
import { decodeSharePayload, encodeSharePayload } from './share.payload';

describe('share payload', () => {
  it('round-trips text and media through a URL-safe string', () => {
    const payload = {
      text: 'Привет, мир!?&=',
      media: [{ id: 'm1', path: 'https://app.test/uploads/a.jpg' }],
    };
    const encoded = encodeSharePayload(payload);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSharePayload(encoded)).toEqual(payload);
  });

  it('carries the number of files that failed to upload', () => {
    expect(
      decodeSharePayload(encodeSharePayload({ text: '', media: [], failed: 3 }))
    ).toEqual({ text: '', media: [], failed: 3 });
  });

  it('returns null for missing or broken values', () => {
    expect(decodeSharePayload(null)).toBeNull();
    expect(decodeSharePayload('***')).toBeNull();
    expect(
      decodeSharePayload(encodeSharePayload({ text: 'x', media: [] }))
    ).toEqual({ text: 'x', media: [] });
  });
});
