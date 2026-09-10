import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./media.source', () => ({
  readMediaSourceBuffer: vi.fn(),
}));

import { readMediaSourceBuffer } from './media.source';
import { readOrFetch } from './read.or.fetch';

describe('readOrFetch remote media', () => {
  beforeEach(() => {
    vi.mocked(readMediaSourceBuffer).mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('routes remote reads through the shared SSRF-safe boundary', async () => {
    vi.mocked(readMediaSourceBuffer).mockResolvedValue(Buffer.from('safe'));

    await expect(
      readOrFetch('https://media.example.test/photo.png')
    ).resolves.toEqual(Buffer.from('safe'));
    expect(readMediaSourceBuffer).toHaveBeenCalledWith(
      'https://media.example.test/photo.png'
    );
  });

  it('forwards purpose-specific byte and body-timeout limits', async () => {
    vi.mocked(readMediaSourceBuffer).mockResolvedValue(Buffer.from('image'));

    await readOrFetch('https://media.example.test/photo.png', {
      maxBytes: 10 * 1024 * 1024,
      bodyTimeoutMs: 30_000,
    });

    expect(readMediaSourceBuffer).toHaveBeenCalledWith(
      'https://media.example.test/photo.png',
      { maxBytes: 10 * 1024 * 1024, bodyTimeoutMs: 30_000 }
    );
  });

  it('reads an exact app-owned local-storage URL from the confined upload root', async () => {
    vi.stubEnv('STORAGE_PROVIDER', 'local');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:4200');
    vi.stubEnv('UPLOAD_DIRECTORY', '/uploads');
    vi.mocked(readMediaSourceBuffer).mockResolvedValue(
      Buffer.from('trusted-local')
    );

    await expect(
      readOrFetch('http://localhost:4200/uploads/2026/08/20/photo.png')
    ).resolves.toEqual(Buffer.from('trusted-local'));
    expect(readMediaSourceBuffer).toHaveBeenCalledWith(
      'http://localhost:4200/uploads/2026/08/20/photo.png'
    );
  });
});
