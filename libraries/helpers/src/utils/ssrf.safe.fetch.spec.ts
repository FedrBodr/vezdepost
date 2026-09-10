import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SAFE_REMOTE_IMAGE_FETCH_MAX_BYTES,
  SAFE_REMOTE_FETCH_MAX_BYTES,
  assertSafeRemoteUrl,
  fetchRemoteMetadata,
  fetchRemoteBuffer,
  getSsrfSafeDispatcher,
  withSafeRemoteRange,
  withSafeRemoteStream,
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

  it('bounds preliminary DNS resolution before any request is attempted', async () => {
    const fetchImpl = vi.fn();
    const lookup = vi.fn(() => new Promise<never>(() => undefined));

    const result = await Promise.race([
      fetchRemoteBuffer('https://media.example.test/photo.png', {
        fetchImpl,
        lookup,
        dnsTimeoutMs: 5,
      } as any).then(
        () => 'resolved',
        (error) => error
      ),
      new Promise((resolve) => setTimeout(() => resolve('unbounded'), 50)),
    ]);

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/dns.*timed out/i);
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

  it('cancels a redirect response body before following the next hop', async () => {
    const cancel = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response(pendingBody(cancel), {
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
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels a redirect response body when Location is missing', async () => {
    const cancel = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(pendingBody(cancel), { status: 302 })
      );

    await expect(
      fetchRemoteBuffer('https://media.example.test/photo.png', {
        fetchImpl,
        lookup: publicLookup,
      })
    ).rejects.toThrow(/location/i);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels a non-success response body before rejecting', async () => {
    const cancel = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(pendingBody(cancel), { status: 404 }));

    await expect(
      fetchRemoteBuffer('https://media.example.test/missing.png', {
        fetchImpl,
        lookup: publicLookup,
      })
    ).rejects.toThrow(/404/);
    expect(cancel).toHaveBeenCalledOnce();
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

  it('pins the approved DNS result in a per-request dispatcher', async () => {
    const lookup = vi.fn(async () => [
      { address: '93.184.216.34', family: 4 as const },
    ]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }));

    await fetchRemoteBuffer('https://media.example.test/photo.png', {
      fetchImpl,
      lookup,
    });

    expect(lookup).toHaveBeenCalledOnce();
    const dispatcher = fetchImpl.mock.calls[0][1].dispatcher;
    expect(dispatcher).toBeDefined();
    expect(dispatcher).not.toBe(getSsrfSafeDispatcher());
  });

  it('rejects a body larger than the configured limit', async () => {
    const cancel = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(pendingBody(cancel), {
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
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels a stream that exceeds its limit while reading', async () => {
    const cancel = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(pendingBody(cancel), { status: 200 }));

    await expect(
      withSafeRemoteStream(
        'https://media.example.test/photo.png',
        { fetchImpl, lookup: publicLookup, maxBytes: 2 },
        async ({ stream }) => {
          for await (const _chunk of stream) {
            // Consume through the boundary so its streaming byte limit applies.
          }
        }
      )
    ).rejects.toThrow(/too large/i);
    expect(cancel).toHaveBeenCalledOnce();
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

  it('bounds and cancels the body even while the consumer is stalled', async () => {
    const cancel = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(pendingBody(cancel), { status: 200 }));

    await expect(
      withSafeRemoteStream(
        'https://media.example.test/clip.mp4',
        {
          fetchImpl,
          lookup: publicLookup,
          bodyTimeoutMs: 5,
          idleTimeoutMs: 100,
        },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
      )
    ).rejects.toThrow(/body.*timeout/i);
    expect(cancel).toHaveBeenCalledOnce();
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

  it('destroys a safe remote stream when its consumer fails', async () => {
    const cancel = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(pendingBody(cancel), {
        status: 200,
        headers: { 'content-length': '3' },
      })
    );

    await expect(
      withSafeRemoteStream(
        'https://media.example.test/photo.png',
        { fetchImpl, lookup: publicLookup, maxBytes: 10 },
        async () => {
          throw new Error('provider failed');
        }
      )
    ).rejects.toThrow('provider failed');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('reads bounded HEAD metadata without exposing a response body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {
          'content-length': '42',
          'content-type': 'video/mp4',
        },
      })
    );

    await expect(
      fetchRemoteMetadata('https://media.example.test/clip.mp4', {
        fetchImpl,
        lookup: publicLookup,
        maxBytes: 100,
      })
    ).resolves.toMatchObject({
      size: 42,
      contentType: 'video/mp4',
      finalUrl: 'https://media.example.test/clip.mp4',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://media.example.test/clip.mp4',
      expect.objectContaining({ method: 'HEAD', redirect: 'manual' })
    );
  });

  it('validates ranged responses before exposing their stream', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([2, 3]), {
        status: 206,
        headers: {
          'content-length': '2',
          'content-range': 'bytes 1-2/4',
        },
      })
    );

    const bytes = await withSafeRemoteRange(
      'https://media.example.test/clip.mp4',
      { fetchImpl, lookup: publicLookup, start: 1, end: 2, totalSize: 4 },
      async ({ stream }: any) => {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks);
      }
    );

    expect(bytes).toEqual(Buffer.from([2, 3]));
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://media.example.test/clip.mp4',
      expect.objectContaining({
        headers: expect.objectContaining({ Range: 'bytes=1-2' }),
        redirect: 'manual',
      })
    );
  });

  it('cancels a ranged response with invalid Content-Range metadata', async () => {
    const cancel = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(pendingBody(cancel), {
        status: 206,
        headers: {
          'content-length': '2',
          'content-range': 'bytes 0-1/4',
        },
      })
    );

    await expect(
      withSafeRemoteRange(
        'https://media.example.test/clip.mp4',
        {
          fetchImpl,
          lookup: publicLookup,
          start: 1,
          end: 2,
          totalSize: 4,
        },
        async () => undefined
      )
    ).rejects.toThrow(/content-range/i);
    expect(cancel).toHaveBeenCalledOnce();
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

function pendingBody(cancel: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
    },
    cancel,
  });
}
