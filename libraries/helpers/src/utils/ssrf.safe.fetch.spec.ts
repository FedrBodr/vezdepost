import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SAFE_REMOTE_IMAGE_FETCH_MAX_BYTES,
  SAFE_REMOTE_FETCH_MAX_BYTES,
  assertSafeRemoteUrl,
  fetchRemoteBuffer,
} from './ssrf.safe.fetch';

const publicLookup = vi.fn(async () => [
  { address: '93.184.216.34', family: 4 as const },
]);

describe('SSRF-safe remote media fetch', () => {
  const originalOptOut = process.env.DISABLE_SSRF_PROTECTION;

  afterEach(() => {
    vi.restoreAllMocks();
    publicLookup.mockClear();
    if (originalOptOut === undefined) {
      delete process.env.DISABLE_SSRF_PROTECTION;
    } else {
      process.env.DISABLE_SSRF_PROTECTION = originalOptOut;
    }
  });

  it.each([
    'http://169.254.169.254/latest/meta-data/photo.png',
    'http://127.0.0.1/photo.png',
    'http://[::ffff:127.0.0.1]/photo.png',
    'http://[fec0::1]/photo.png',
    'http://[64:ff9b::a9fe:a9fe]/photo.png',
    'http://[::ffff:0:7f00:1]/photo.png',
    'file:///tmp/photo.png',
  ])(
    'rejects direct private, metadata, or unsupported URLs: %s',
    async (url) => {
      const fetchImpl = vi.fn();

      await expect(
        fetchRemoteBuffer(url, { fetchImpl, lookup: publicLookup })
      ).rejects.toThrow(/blocked|http/i);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  );

  it('rejects a hostname resolving to a private address', async () => {
    const fetchImpl = vi.fn();
    const lookup = vi.fn(async () => [
      { address: '10.0.0.8', family: 4 as const },
    ]);

    await expect(
      fetchRemoteBuffer('https://media.example.test/photo.png', {
        fetchImpl,
        lookup,
      })
    ).rejects.toThrow(/blocked/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('revalidates and rejects a redirect to a private address', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/secret.png' },
      })
    );

    await expect(
      fetchRemoteBuffer('https://media.example.test/photo.png', {
        fetchImpl,
        lookup: publicLookup,
      })
    ).rejects.toThrow(/blocked/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns a bounded buffer for a safe public response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-length': '3' },
      })
    );

    const result = await fetchRemoteBuffer(
      'https://media.example.test/photo.png',
      { fetchImpl, lookup: publicLookup }
    );

    expect(result).toEqual(Buffer.from([1, 2, 3]));
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://media.example.test/photo.png',
      expect.objectContaining({ redirect: 'manual' })
    );
  });

  it('rejects a body larger than the configured limit', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-length': '3' },
      })
    );

    await expect(
      fetchRemoteBuffer('https://media.example.test/photo.png', {
        fetchImpl,
        lookup: publicLookup,
        maxBytes: 2,
      })
    ).rejects.toThrow(/too large/i);
  });

  it('does not apply the response-header timeout to an active body download', async () => {
    const fetchImpl = vi.fn(async (_input: string, init: RequestInit) =>
      delayedResponse(init.signal, 20)
    );

    await expect(
      fetchRemoteBuffer('https://media.example.test/clip.mp4', {
        fetchImpl,
        lookup: publicLookup,
        timeoutMs: 5,
        bodyTimeoutMs: 100,
      })
    ).resolves.toEqual(Buffer.from([1, 2, 3]));
  });

  it('still bounds the total body download time', async () => {
    const fetchImpl = vi.fn(async (_input: string, init: RequestInit) =>
      delayedResponse(init.signal, 20)
    );

    await expect(
      fetchRemoteBuffer('https://media.example.test/clip.mp4', {
        fetchImpl,
        lookup: publicLookup,
        timeoutMs: 100,
        bodyTimeoutMs: 5,
      })
    ).rejects.toThrow(/abort/i);
  });

  it('keeps the explicit SSRF protection opt-out', async () => {
    process.env.DISABLE_SSRF_PROTECTION = 'true';
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }));

    await expect(
      fetchRemoteBuffer('http://127.0.0.1/photo.png', {
        fetchImpl,
        lookup: publicLookup,
      })
    ).resolves.toEqual(Buffer.from([1]));
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('keeps bounded downloads compatible with accepted video and image sizes', async () => {
    expect(SAFE_REMOTE_FETCH_MAX_BYTES).toBe(1024 * 1024 * 1024);
    expect(SAFE_REMOTE_IMAGE_FETCH_MAX_BYTES).toBe(10 * 1024 * 1024);
    await expect(
      assertSafeRemoteUrl('https://media.example.test/photo.png', publicLookup)
    ).resolves.toBeUndefined();
  });
});

function delayedResponse(
  signal: AbortSignal | null | undefined,
  delayMs: number
): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        const timer = setTimeout(() => {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        }, delayMs);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            controller.error(new Error('Body download aborted'));
          },
          { once: true }
        );
      },
    }),
    { status: 200 }
  );
}
