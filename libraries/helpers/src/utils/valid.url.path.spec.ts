import { afterEach, describe, expect, it } from 'vitest';
import { hasExtension } from './has.extension';
import { ValidUrlExtension, ValidUrlPath } from './valid.url.path';

const extensionValidator = new ValidUrlExtension();
const pathValidator = new ValidUrlPath();
const args = {} as any;

describe('terminal media extensions', () => {
  it('accepts a case-insensitive terminal extension before query parameters', () => {
    expect(hasExtension('uploads/CLIP.MP4?download=1', 'mp4')).toBe(true);
    expect(
      extensionValidator.validate('uploads/CLIP.MP4?download=1', args)
    ).toBe(true);
  });

  it.each(['photo.jpg?x=.mp4', 'clip.mp4.jpg', 'photo.jpg#preview=.mp4'])(
    'uses the real terminal jpg extension despite mp4 confusion: %s',
    (path) => {
      expect(hasExtension(path, 'mp4')).toBe(false);
      expect(hasExtension(path, 'jpg')).toBe(true);
      expect(extensionValidator.validate(path, args)).toBe(true);
    }
  );

  it.each([
    'uploads/photo.PNG',
    'uploads/photo.jpg?download=1',
    'uploads/photo.JPEG#preview',
    'uploads/animation.gif',
    'uploads/photo.webp',
    '/absolute/local/clip.mp4',
  ])('preserves supported local media paths: %s', (path) => {
    expect(extensionValidator.validate(path, args)).toBe(true);
  });

  it.each(['uploads/file.pdf', 'uploads/no-extension'])(
    'rejects unsupported terminal extensions: %s',
    (path) => {
      expect(extensionValidator.validate(path, args)).toBe(false);
    }
  );
});

describe('media URL paths', () => {
  const originalRestriction = process.env.RESTRICT_UPLOAD_DOMAINS;

  afterEach(() => {
    if (originalRestriction === undefined) {
      delete process.env.RESTRICT_UPLOAD_DOMAINS;
    } else {
      process.env.RESTRICT_UPLOAD_DOMAINS = originalRestriction;
    }
  });

  it('allows existing local stored paths and http(s) remote URLs', () => {
    delete process.env.RESTRICT_UPLOAD_DOMAINS;

    expect(pathValidator.validate('uploads/photo.png', args)).toBe(true);
    expect(pathValidator.validate('/uploads/photo.png', args)).toBe(true);
    expect(
      pathValidator.validate('https://cdn.example.com/photo.png', args)
    ).toBe(true);
    expect(
      pathValidator.validate('http://cdn.example.com/photo.png', args)
    ).toBe(true);
  });

  it.each(['ftp://cdn.example.com/photo.png', 'file:///tmp/photo.png'])(
    'rejects non-http remote protocols: %s',
    (url) => {
      delete process.env.RESTRICT_UPLOAD_DOMAINS;
      expect(pathValidator.validate(url, args)).toBe(false);
    }
  );

  it.each([
    '../tmp/secret.png',
    '/../../tmp/secret.png',
    'uploads/../tmp/secret.png',
    'uploads/%2e%2e/tmp/secret.png',
    'C:\\tmp\\secret.png',
  ])('rejects local paths that can escape the upload root: %s', (path) => {
    delete process.env.RESTRICT_UPLOAD_DOMAINS;
    expect(pathValidator.validate(path, args)).toBe(false);
  });

  it('matches the configured upload hostname or a proper subdomain', () => {
    process.env.RESTRICT_UPLOAD_DOMAINS = 'uploads.example.com';

    expect(
      pathValidator.validate('https://uploads.example.com/a.png', args)
    ).toBe(true);
    expect(
      pathValidator.validate('https://media.uploads.example.com/a.png', args)
    ).toBe(true);
    expect(pathValidator.validate('uploads/local.png', args)).toBe(true);
  });

  it.each([
    'https://uploads.example.com.evil.test/a.png',
    'https://uploads.example.com@evil.test/a.png',
    'https://evil.test/uploads.example.com/a.png',
    'https://evil.test/a.png?next=uploads.example.com',
  ])('rejects configured-domain confusion: %s', (url) => {
    process.env.RESTRICT_UPLOAD_DOMAINS = 'uploads.example.com';
    expect(pathValidator.validate(url, args)).toBe(false);
  });
});
