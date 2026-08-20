import { afterEach, describe, expect, it, vi } from 'vitest';
import { MastodonProvider } from './mastodon.provider';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('MastodonProvider capability runtime', () => {
  it('maps documented instance limits into a trusted runtime overlay', async () => {
    vi.stubEnv('MASTODON_URL', 'https://mastodon.example');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
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
      )
    );

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
      },
    });
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
