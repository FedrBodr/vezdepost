import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({
  default: vi.fn().mockResolvedValue({ data: Buffer.from('unsafe') }),
}));
vi.mock('./ssrf.safe.fetch', () => ({
  fetchRemoteBuffer: vi.fn(),
}));
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

import { fetchRemoteBuffer } from './ssrf.safe.fetch';
import { readOrFetch } from './read.or.fetch';
import { readFileSync } from 'fs';

describe('readOrFetch remote media', () => {
  beforeEach(() => {
    vi.mocked(fetchRemoteBuffer).mockReset();
    vi.mocked(readFileSync).mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('routes remote reads through the shared SSRF-safe boundary', async () => {
    vi.mocked(fetchRemoteBuffer).mockResolvedValue(Buffer.from('safe'));

    await expect(
      readOrFetch('https://media.example.test/photo.png')
    ).resolves.toEqual(Buffer.from('safe'));
    expect(fetchRemoteBuffer).toHaveBeenCalledWith(
      'https://media.example.test/photo.png'
    );
  });

  it('reads an exact app-owned local-storage URL from the confined upload root', async () => {
    vi.stubEnv('STORAGE_PROVIDER', 'local');
    vi.stubEnv('FRONTEND_URL', 'http://localhost:4200');
    vi.stubEnv('UPLOAD_DIRECTORY', '/uploads');
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('trusted-local'));

    await expect(
      readOrFetch('http://localhost:4200/uploads/2026/08/20/photo.png')
    ).resolves.toEqual(Buffer.from('trusted-local'));
    expect(readFileSync).toHaveBeenCalledWith('/uploads/2026/08/20/photo.png');
    expect(fetchRemoteBuffer).not.toHaveBeenCalled();
  });
});
