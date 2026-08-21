import { beforeEach, describe, expect, it, vi } from 'vitest';

const moduleBot = vi.hoisted(() => ({
  sendPhoto: vi.fn(() => {
    throw new Error('module-level Telegram bot was used');
  }),
  sendMediaGroup: vi.fn(() => {
    throw new Error('module-level Telegram bot was used');
  }),
  sendMessage: vi.fn(() => {
    throw new Error('module-level Telegram bot was used');
  }),
}));

vi.mock('node-telegram-bot-api', () => ({
  default: vi.fn(() => moduleBot),
}));

vi.mock(
  '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface',
  () => ({})
);
vi.mock('@gitroom/nestjs-libraries/services/make.is', () => ({
  makeId: vi.fn(() => 'id'),
}));
vi.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  SocialAbstract: class {},
}));
vi.mock(
  '@gitroom/helpers/utils/telegram.constraints',
  () => import('../../../../helpers/src/utils/telegram.constraints')
);

import { TelegramProvider } from './telegram.provider';

const media = [{ id: 'media', path: 'https://cdn.test/photo.jpg' }];
const albumMedia = [
  ...media,
  { id: 'media-2', path: 'https://cdn.test/photo-2.jpg' },
];
const mediaItems = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `media-${index}`,
    path: `https://cdn.test/photo-${index}.jpg`,
  }));
const details = (message: string, files = media) => [
  { id: 'post-1', message, media: files, settings: {} } as any,
];

const makeBot = () => {
  const calls: string[] = [];
  let albumNumber = 0;
  const bot = {
    sendPhoto: vi.fn(
      async (
        _chat: string,
        _media: string,
        options: { caption?: string; reply_to_message_id?: number }
      ) => {
        calls.push(`photo:${String(options.caption)}`);
        return { message_id: 41 };
      }
    ),
    sendMediaGroup: vi.fn(
      async (
        _chat: string,
        group: Array<{ caption?: string }>,
        _options?: { reply_to_message_id?: number }
      ) => {
        calls.push(`album:${String(group[0].caption)}`);
        return [{ message_id: 51 + albumNumber++ * 10 }];
      }
    ),
    sendMessage: vi.fn(
      async (
        _chat: string,
        text: string,
        _options?: { parse_mode?: string; reply_to_message_id?: number }
      ) => {
        calls.push(`text:${text}`);
        return { message_id: 42 };
      }
    ),
  };

  return { calls, bot };
};

describe('TelegramProvider media captions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends a 4096-character text-only post as one complete message', async () => {
    const { bot } = makeBot();
    const provider = new TelegramProvider(bot as any);
    const text = 'x'.repeat(4096);

    const result = await provider.post('channel', '-1001', details(text, []));

    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
    expect(bot.sendMessage).toHaveBeenCalledWith('-1001', text, {
      parse_mode: 'HTML',
    });
    expect(bot.sendPhoto).not.toHaveBeenCalled();
    expect(bot.sendMediaGroup).not.toHaveBeenCalled();
    expect(result[0].postId).toBe('42');
    expect(result[0].releaseURL).toContain('/42');
  });

  it('safely normalizes text again before Telegram HTML parse mode', async () => {
    const { bot } = makeBot();
    const provider = new TelegramProvider(bot as any);

    await provider.post(
      'channel',
      '-1001',
      details('AT&T < launch > &copy; &lt;b&gt;literal&lt;/b&gt; &nbsp;', [])
    );

    expect(bot.sendMessage).toHaveBeenCalledWith(
      '-1001',
      'AT&amp;T &lt; launch &gt; © &lt;b&gt;literal&lt;/b&gt; &#160;',
      { parse_mode: 'HTML' }
    );
  });

  it('keeps short text attached to a single media item', async () => {
    const { calls, bot } = makeBot();
    const provider = new TelegramProvider(bot as any);
    const shortText = 'short text';

    await provider.post('channel', '-1001', details(shortText));

    expect(calls).toEqual([`photo:${shortText}`]);
  });

  it.each([
    'https://cdn.test/photo.jpg',
    '/var/postiz/uploads/2026/08/21/photo.jpg',
  ])(
    'passes a local or remote media source through byte-identically: %s',
    async (path) => {
      const { bot } = makeBot();
      const provider = new TelegramProvider(bot as any);

      await provider.post(
        'channel',
        '-1001',
        details('caption', [{ id: 'media', path }])
      );

      expect(bot.sendPhoto).toHaveBeenCalledWith(
        '-1001',
        path,
        expect.objectContaining({ caption: 'caption' }),
        expect.objectContaining({ filename: 'photo.jpg' })
      );
    }
  );

  it('sends captionless single media before the full long text', async () => {
    const { calls, bot } = makeBot();
    const provider = new TelegramProvider(bot as any);
    const longText = 'x'.repeat(1025);

    const result = await provider.post('channel', '-1001', details(longText));

    expect(calls).toEqual(['photo:undefined', `text:${longText}`]);
    expect(result[0].postId).toBe('41');
    expect(result[0].releaseURL).toContain('/41');
  });

  it('uses visible text length when deciding whether to split text', async () => {
    const { calls, bot } = makeBot();
    const provider = new TelegramProvider(bot as any);
    const formattedText = `<strong>${'x'.repeat(1024)}</strong>`;
    const normalizedText = `<b>${'x'.repeat(1024)}</b>`;

    await provider.post('channel', '-1001', details(formattedText));

    expect(calls).toEqual([`photo:${normalizedText}`]);
  });

  it('keeps 1024 entity-encoded visible characters attached', async () => {
    const { calls, bot } = makeBot();
    const provider = new TelegramProvider(bot as any);
    const entityText = '&amp;'.repeat(1024);

    await provider.post('channel', '-1001', details(entityText));

    expect(calls).toEqual([`photo:${entityText}`]);
  });

  it('splits 1025 entity-encoded visible characters', async () => {
    const { calls, bot } = makeBot();
    const provider = new TelegramProvider(bot as any);
    const entityText = '&amp;'.repeat(1025);

    await provider.post('channel', '-1001', details(entityText));

    expect(calls).toEqual(['photo:undefined', `text:${entityText}`]);
  });

  it('uses UTF-16 length for numeric entity caption boundaries', async () => {
    const attached = makeBot();
    const split = makeBot();
    const boundaryText = '&#128512;'.repeat(512);
    const overBoundaryText = '&#x1F600;'.repeat(513);

    await new TelegramProvider(attached.bot as any).post(
      'channel',
      '-1001',
      details(boundaryText)
    );
    await new TelegramProvider(split.bot as any).post(
      'channel',
      '-1001',
      details(overBoundaryText)
    );

    expect(attached.calls).toEqual([`photo:${'😀'.repeat(512)}`]);
    expect(split.calls).toEqual([
      'photo:undefined',
      `text:${'😀'.repeat(513)}`,
    ]);
  });

  it('counts anchor labels rather than URLs', async () => {
    const { calls, bot } = makeBot();
    const provider = new TelegramProvider(bot as any);
    const link = `<a href="https://example.com/${'x'.repeat(
      1100
    )}">short label</a>`;

    await provider.post('channel', '-1001', details(link));

    expect(calls).toEqual(['photo:short label']);
  });

  it('keeps short text attached to the first album item', async () => {
    const { calls, bot } = makeBot();
    const provider = new TelegramProvider(bot as any);
    const shortText = 'short text';

    await provider.post('channel', '-1001', details(shortText, albumMedia));

    expect(calls).toEqual([`album:${shortText}`]);
  });

  it('sends a captionless album before the full long text', async () => {
    const { calls, bot } = makeBot();
    const provider = new TelegramProvider(bot as any);
    const longText = 'x'.repeat(1025);

    const result = await provider.post(
      'channel',
      '-1001',
      details(longText, albumMedia)
    );

    expect(calls).toEqual(['album:undefined', `text:${longText}`]);
    expect(result[0].postId).toBe('51');
    expect(result[0].releaseURL).toContain('/51');
  });

  it('finishes every media group before text and retains the first group ID', async () => {
    const { calls, bot } = makeBot();
    const provider = new TelegramProvider(bot as any);
    const longText = 'x'.repeat(1025);

    const result = await provider.post(
      'channel',
      '-1001',
      details(longText, mediaItems(11))
    );

    expect(calls).toEqual([
      'album:undefined',
      'album:undefined',
      `text:${longText}`,
    ]);
    expect(result[0].postId).toBe('51');
    expect(result[0].releaseURL).toContain('/51');
  });

  it.each([
    [11, [9, 2]],
    [21, [10, 9, 2]],
  ] as const)(
    'keeps every Telegram album within the 2-to-10 item transport contract for %i media',
    async (count, expectedGroupSizes) => {
      const { bot } = makeBot();
      const provider = new TelegramProvider(bot as any);

      await provider.post(
        'channel',
        '-1001',
        details('album', mediaItems(count))
      );

      const groupSizes = bot.sendMediaGroup.mock.calls.map(
        ([, group]) => group.length
      );
      expect(groupSizes).toEqual(expectedGroupSizes);
      expect(groupSizes.every((size) => size >= 2 && size <= 10)).toBe(true);
    }
  );

  it('does not send text when a later media group fails', async () => {
    const { calls, bot } = makeBot();
    const provider = new TelegramProvider(bot as any);
    const mediaError = new Error('second media group failed');
    bot.sendMediaGroup
      .mockImplementationOnce(async (_chat, group) => {
        calls.push(`album:${String(group[0].caption)}`);
        return [{ message_id: 51 }];
      })
      .mockImplementationOnce(async (_chat, group) => {
        calls.push(`album:${String(group[0].caption)}`);
        throw mediaError;
      });

    await expect(
      provider.post(
        'channel',
        '-1001',
        details('x'.repeat(1025), mediaItems(11))
      )
    ).rejects.toBe(mediaError);
    expect(calls).toEqual(['album:undefined', 'album:undefined']);
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('replies with the first media group but not later groups or split text', async () => {
    const { bot } = makeBot();
    const provider = new TelegramProvider(bot as any);
    const longText = 'x'.repeat(1025);

    await provider.comment(
      'channel',
      '99',
      undefined,
      '-1001',
      details(longText, mediaItems(11)),
      {} as any
    );

    expect(bot.sendMediaGroup).toHaveBeenCalledTimes(2);
    expect(bot.sendMediaGroup.mock.calls[0][2]).toEqual({
      reply_to_message_id: 99,
    });
    expect(bot.sendMediaGroup.mock.calls[1][2]).toEqual({});
    expect(bot.sendMessage.mock.calls[0][2]).toEqual({
      parse_mode: 'HTML',
    });
  });

  it('does not send the separate text when media delivery fails', async () => {
    const { bot } = makeBot();
    const mediaError = new Error('media failed');
    bot.sendPhoto.mockRejectedValueOnce(mediaError);
    const provider = new TelegramProvider(bot as any);

    await expect(
      provider.post('channel', '-1001', details('x'.repeat(1025)))
    ).rejects.toBe(mediaError);
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('propagates a failure from the separate text message', async () => {
    const { bot } = makeBot();
    const textError = new Error('text failed');
    bot.sendMessage.mockRejectedValueOnce(textError);
    const provider = new TelegramProvider(bot as any);

    await expect(
      provider.post('channel', '-1001', details('x'.repeat(1025)))
    ).rejects.toBe(textError);
  });
});
