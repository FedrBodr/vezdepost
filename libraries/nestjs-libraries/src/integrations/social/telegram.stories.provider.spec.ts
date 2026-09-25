import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node-telegram-bot-api', () => ({ default: vi.fn(() => ({})) }));
vi.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  SocialAbstract: class {},
  RefreshToken: class RefreshToken extends Error {
    constructor(_id: string, _json: string, _body: unknown, message = '') {
      super(message);
      this.name = 'RefreshToken';
    }
  },
}));
vi.mock('@gitroom/nestjs-libraries/services/make.is', () => ({
  makeId: vi.fn(() => 'nonce'),
}));

import { TelegramStoriesProvider } from './telegram.stories.provider';
import { MemoryKeyValueStore } from './telegram.kv.store';

const connection = (patch: any = {}) => ({
  id: 'bc-1',
  user: { id: 7, first_name: 'Dmitry', username: 'fedr' },
  is_enabled: true,
  rights: { can_manage_stories: true },
  ...patch,
});

const make = (patch: any = {}) => {
  const store = new MemoryKeyValueStore();
  let nextId = 500;
  const deps = {
    store,
    api: {
      getBusinessConnection: vi.fn().mockResolvedValue(connection()),
      postStory: vi.fn(async () => ({ id: nextId++ })),
    },
    hub: {
      poll: vi.fn(),
      findConnectionCommand: vi.fn(),
      findBusinessConnection: vi.fn(),
    },
    readMedia: vi.fn(async (path: string) => Buffer.from(path)),
    preparePhoto: vi.fn(async () => Buffer.from('jpeg')),
    prepareVideo: vi.fn(async () => ({
      file: Buffer.from('mp4'),
      durationSeconds: 9,
    })),
    probeDuration: vi.fn(async () => 10),
    ...patch,
  };
  return { provider: new TelegramStoriesProvider(deps), deps, store };
};

const post = (
  settings: any = {},
  media: any[] = [
    { id: 'a', type: 'image', path: 'https://cdn/a.jpg' },
    { id: 'b', type: 'video', path: 'https://cdn/b.mp4' },
  ]
) =>
  [
    {
      id: 'post-1',
      message:
        '<p><strong>Hello</strong> <a href="https://x.test">link</a></p><h2>Title</h2>',
      settings,
      media,
    },
  ] as any;

describe('TelegramStoriesProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('authenticates only from a server-verified record', async () => {
    const { provider, store } = make();

    await expect(
      provider.authenticate({ code: 'nonce', codeVerifier: '' })
    ).resolves.toBe('Telegram Stories connection expired. Start again.');

    await store.set(
      'telegram-stories:verified:nonce',
      JSON.stringify({ telegramUserId: 7, businessConnectionId: 'bc-1' })
    );
    await expect(
      provider.authenticate({ code: 'nonce', codeVerifier: '' })
    ).resolves.toMatchObject({
      id: '7',
      accessToken: 'bc-1',
      name: 'Dmitry',
      username: 'fedr',
    });
  });

  it('refuses a verified record whose connection lost the right', async () => {
    const { provider, store, deps } = make();
    deps.api.getBusinessConnection.mockResolvedValue(
      connection({ rights: {} })
    );
    await store.set(
      'telegram-stories:verified:nonce',
      JSON.stringify({ telegramUserId: 7, businessConnectionId: 'bc-1' })
    );

    await expect(
      provider.authenticate({ code: 'nonce', codeVerifier: '' })
    ).resolves.toBe('Enable "Manage stories" for the bot in Telegram Business.');
  });

  it('publishes each media as a story with default captions and lifetime', async () => {
    const { provider, deps } = make();

    const [result] = await provider.post('7', 'bc-1', post(), {
      profile: 'fedr',
    } as any);

    const calls = deps.api.postStory.mock.calls.map(([p]: any) => p);
    expect(calls.map((c: any) => [c.kind, c.activePeriod, c.caption])).toEqual(
      [
        [
          'photo',
          86400,
          '<b>Hello</b> <a href="https://x.test">link</a>\n\n<b>Title</b>',
        ],
        ['video', 86400, undefined],
      ]
    );
    expect(calls[1]).toMatchObject({
      durationSeconds: 9,
      businessConnectionId: 'bc-1',
    });
    expect(result).toEqual({
      id: 'post-1',
      postId: '500,501',
      releaseURL: 'https://t.me/fedr/s/500',
      status: 'completed',
    });
  });

  it('applies per-frame text and lifetime settings', async () => {
    const { provider, deps } = make();

    await provider.post(
      '7',
      'bc-1',
      post({
        active_period: '172800',
        frames: [
          { mediaId: 'b', text: 'custom', caption: 'Second' },
          { mediaId: 'a', text: 'none' },
        ],
      }),
      {} as any
    );

    const calls = deps.api.postStory.mock.calls.map(([p]: any) => [
      p.activePeriod,
      p.caption,
    ]);
    expect(calls).toEqual([
      [172800, undefined],
      [172800, 'Second'],
    ]);
  });

  it('asks for reconnection when the stories right was revoked', async () => {
    const { provider, deps } = make();
    deps.api.getBusinessConnection.mockResolvedValue(
      connection({ is_enabled: false })
    );

    await expect(
      provider.post('7', 'bc-1', post(), {} as any)
    ).rejects.toMatchObject({ name: 'RefreshToken' });
    expect(deps.api.postStory).not.toHaveBeenCalled();
  });

  it('validates media before scheduling', async () => {
    const { provider, deps } = make();

    await expect(provider.checkValidity([[]])).resolves.toBe(
      'Telegram Stories needs at least one photo or video.'
    );
    await expect(
      provider.checkValidity([
        Array.from({ length: 11 }, (_, i) => ({
          path: `${i}.jpg`,
          type: 'image',
        })),
      ])
    ).resolves.toBe('Telegram Stories supports at most 10 files per post.');

    deps.probeDuration.mockResolvedValue(61);
    await expect(
      provider.checkValidity([[{ path: 'v.mp4', type: 'video' }]])
    ).resolves.toBe('Story videos must be at most 60 seconds long.');

    deps.probeDuration.mockResolvedValue(30);
    await expect(
      provider.checkValidity([
        [
          { path: 'v.mp4', type: 'video' },
          { path: 'p.jpg', type: 'image' },
        ],
      ])
    ).resolves.toBe(true);
  });

  it('rejects captions longer than 2048 visible characters', async () => {
    const { provider, deps } = make();
    const [longPost] = post({}, [
      { id: 'a', type: 'image', path: 'x.jpg' },
    ]);

    await expect(
      provider.post(
        '7',
        'bc-1',
        [{ ...longPost, message: 'a'.repeat(2049) }],
        {} as any
      )
    ).rejects.toThrow('2048');
    expect(deps.api.postStory).not.toHaveBeenCalled();
  });
});
