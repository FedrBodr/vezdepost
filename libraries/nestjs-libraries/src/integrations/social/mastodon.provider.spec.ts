import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MASTODON_CAPABILITY_RUNTIME_CACHE_TTL_MS,
  MASTODON_CAPABILITY_RUNTIME_TIMEOUT_MS,
  MastodonProvider,
} from './mastodon.provider';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const instanceResponse = () =>
  new Response(
    JSON.stringify({
      configuration: {
        statuses: {
          max_characters: 777,
          max_media_attachments: 6,
        },
      },
    }),
    { status: 200 }
  );

describe('MastodonProvider capability runtime', () => {
  it('maps documented instance limits into a trusted runtime overlay', async () => {
    vi.stubEnv('MASTODON_URL', 'https://mastodon.example');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(instanceResponse());

    const overlay = await new MastodonProvider().fetchCapabilityRuntime({
      id: 'stored-integration',
    } as never);

    expect(globalThis.fetch).toHaveBeenCalledExactlyOnceWith(
      'https://mastodon.example/api/v2/instance',
      expect.anything()
    );
    expect(overlay).toMatchObject({
      observedAt: expect.any(String),
      textLimits: {
        body: { max: 777, unit: 'graphemes', source: 'runtime' },
      },
      mediaRule: {
        type: 'optional',
        images: { min: 1, max: 6 },
        videos: { min: 1, max: 6 },
        mixed: true,
        maxTotal: 6,
      },
    });
  });

  it('aborts optional runtime enrichment after a short timeout', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal?.reason));
      });
    });
    const provider = new MastodonProvider();

    const runtime = provider.fetchCapabilityRuntime({} as never);
    await vi.advanceTimersByTimeAsync(MASTODON_CAPABILITY_RUNTIME_TIMEOUT_MS);

    expect(signal?.aborted).toBe(true);
    await expect(runtime).resolves.toBeUndefined();
  });

  it('shares a concurrent in-flight instance request', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const provider = new MastodonProvider();

    const first = provider.fetchCapabilityRuntime({ id: 'first' } as never);
    const second = provider.fetchCapabilityRuntime({ id: 'second' } as never);

    expect(fetchSpy).toHaveBeenCalledOnce();
    resolveFetch?.(instanceResponse());
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ observedAt: expect.any(String) }),
      expect.objectContaining({ observedAt: expect.any(String) }),
    ]);
  });

  it('caches valid runtime data for a finite TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T10:00:00.000Z'));
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => instanceResponse());
    const provider = new MastodonProvider();

    const first = await provider.fetchCapabilityRuntime({} as never);
    await vi.advanceTimersByTimeAsync(
      MASTODON_CAPABILITY_RUNTIME_CACHE_TTL_MS - 1
    );
    const cached = await provider.fetchCapabilityRuntime({} as never);

    expect(cached).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(2);
    await provider.fetchCapabilityRuntime({} as never);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not cache a malformed runtime fallback for the success TTL', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{not-json', { status: 200 }))
      .mockResolvedValueOnce(instanceResponse());
    const provider = new MastodonProvider();

    await expect(
      provider.fetchCapabilityRuntime({} as never)
    ).resolves.toBeUndefined();
    await expect(
      provider.fetchCapabilityRuntime({} as never)
    ).resolves.toMatchObject({ observedAt: expect.any(String) });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['missing configuration', {}],
    ['missing status fields', { configuration: { statuses: {} } }],
    [
      'non-positive text limit',
      {
        configuration: {
          statuses: { max_characters: 0, max_media_attachments: 4 },
        },
      },
    ],
    [
      'non-integer media limit',
      {
        configuration: {
          statuses: { max_characters: 500, max_media_attachments: 4.5 },
        },
      },
    ],
  ])('returns undefined for %s', async (_name, body) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 })
    );

    await expect(
      new MastodonProvider().fetchCapabilityRuntime({} as never)
    ).resolves.toBeUndefined();
  });

  it.each([
    ['network errors', () => Promise.reject(new Error('network failure'))],
    [
      'non-OK responses',
      () => Promise.resolve(new Response('upstream failure', { status: 503 })),
    ],
    [
      'malformed JSON',
      () => Promise.resolve(new Response('{not-json', { status: 200 })),
    ],
  ])('returns undefined for %s', async (_name, response) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(response as never);

    await expect(
      new MastodonProvider().fetchCapabilityRuntime({} as never)
    ).resolves.toBeUndefined();
  });
});
