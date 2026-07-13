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
const details = (message: string, files = media) => [
  { id: 'post-1', message, media: files, settings: {} } as any,
];

const makeBot = () => {
  const calls: string[] = [];
  const bot = {
    sendPhoto: vi.fn(
      async (_chat: string, _media: string, options: { caption?: string }) => {
        calls.push(`photo:${String(options.caption)}`);
        return { message_id: 41 };
      }
    ),
    sendMediaGroup: vi.fn(
      async (_chat: string, group: Array<{ caption?: string }>) => {
        calls.push(`album:${String(group[0].caption)}`);
        return [{ message_id: 51 }];
      }
    ),
    sendMessage: vi.fn(async (_chat: string, text: string) => {
      calls.push(`text:${text}`);
      return { message_id: 42 };
    }),
  };

  return { calls, bot };
};

describe('TelegramProvider media captions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps short text attached to a single media item', async () => {
    const { calls, bot } = makeBot();
    const provider = new TelegramProvider(bot as any);
    const shortText = 'short text';

    await provider.post('channel', '-1001', details(shortText));

    expect(calls).toEqual([`photo:${shortText}`]);
  });

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

    await provider.post('channel', '-1001', details(longText, albumMedia));

    expect(calls).toEqual(['album:undefined', `text:${longText}`]);
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
