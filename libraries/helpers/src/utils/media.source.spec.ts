import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  authorizeMediaSource,
  getMediaSourceMetadata,
  readMediaSourceBuffer,
  withMediaSourceRange,
} from './media.source';

describe('MediaSource local and remote boundary', () => {
  let uploadDirectory: string;
  let outsideDirectory: string;

  beforeEach(() => {
    uploadDirectory = mkdtempSync(join(tmpdir(), 'postiz-media-source-'));
    outsideDirectory = mkdtempSync(join(tmpdir(), 'postiz-media-outside-'));
    mkdirSync(join(uploadDirectory, 'nested'));
    writeFileSync(
      join(uploadDirectory, 'nested', 'clip.mp4'),
      Buffer.from([1, 2, 3, 4])
    );
    vi.stubEnv('UPLOAD_DIRECTORY', uploadDirectory);
    vi.stubEnv('STORAGE_PROVIDER', 'local');
    vi.stubEnv('FRONTEND_URL', 'https://app.example.test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(uploadDirectory, { recursive: true, force: true });
    rmSync(outsideDirectory, { recursive: true, force: true });
  });

  it('reads confined local paths and exact app-owned URLs without network I/O', async () => {
    await expect(
      readMediaSourceBuffer('nested/clip.mp4', {
        maxBytes: 4,
      })
    ).resolves.toEqual(Buffer.from([1, 2, 3, 4]));

    await expect(
      readMediaSourceBuffer(join(uploadDirectory, 'nested', 'clip.mp4'), {
        maxBytes: 4,
      })
    ).resolves.toEqual(Buffer.from([1, 2, 3, 4]));

    await expect(
      readMediaSourceBuffer(
        'https://app.example.test/uploads/nested/clip.mp4',
        { maxBytes: 4 }
      )
    ).resolves.toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it('rejects local traversal and local files over the configured limit', async () => {
    await expect(
      readMediaSourceBuffer('../secret.mp4', {
        maxBytes: 4,
      })
    ).rejects.toThrow(/invalid media source/i);
    await expect(
      readMediaSourceBuffer('nested/clip.mp4', {
        maxBytes: 3,
      })
    ).rejects.toThrow(/too large/i);
  });

  it('rejects a symlink that escapes the upload directory', async () => {
    writeFileSync(join(outsideDirectory, 'secret.mp4'), Buffer.from([9]));
    symlinkSync(
      join(outsideDirectory, 'secret.mp4'),
      join(uploadDirectory, 'nested', 'escaped.mp4')
    );

    await expect(
      readMediaSourceBuffer('nested/escaped.mp4', { maxBytes: 1 })
    ).rejects.toThrow(/invalid media source/i);
  });

  it('rejects a confined directory rather than authorizing it as media', async () => {
    mkdirSync(join(uploadDirectory, 'nested', 'fake.jpg'));

    await expect(authorizeMediaSource('nested/fake.jpg')).rejects.toThrow(
      /invalid media source/i
    );
  });

  it('provides local metadata and an exact ranged stream', async () => {
    await expect(
      getMediaSourceMetadata('nested/clip.mp4', {
        maxBytes: 4,
      })
    ).resolves.toMatchObject({ size: 4, local: true });

    const range = await withMediaSourceRange(
      'nested/clip.mp4',
      { start: 1, end: 2, totalSize: 4 },
      async ({ stream }: any) => {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks);
      }
    );
    expect(range).toEqual(Buffer.from([2, 3]));
  });

  it('does not treat a deceptive app-host suffix as a local upload URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([9]), {
        status: 200,
        headers: { 'content-length': '1' },
      })
    );
    const lookup = vi.fn(async () => [
      { address: '93.184.216.34', family: 4 as const },
    ]);

    await expect(
      readMediaSourceBuffer(
        'https://app.example.test.attacker/nested/clip.mp4',
        { fetchImpl, lookup, maxBytes: 1 }
      )
    ).resolves.toEqual(Buffer.from([9]));
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe('attacker URL ingestion MediaSource contract', () => {
  it.each([
    ['libraries/nestjs-libraries/src/upload/local.storage.ts', /fetch\(path/],
    [
      'libraries/nestjs-libraries/src/upload/cloudflare.storage.ts',
      /fetch\(path/,
    ],
    [
      'apps/backend/src/public-api/routes/v1/public.integrations.controller.ts',
      /fetch\(body\.url/,
    ],
    [
      'libraries/nestjs-libraries/src/chat/tools/upload.from.url.tool.ts',
      /fetch\(inputData\.url/,
    ],
  ])('%s routes its remote source through MediaSource', (file, forbidden) => {
    expect(readFileSync(resolve(process.cwd(), file), 'utf8')).not.toMatch(
      forbidden as RegExp
    );
  });
});
