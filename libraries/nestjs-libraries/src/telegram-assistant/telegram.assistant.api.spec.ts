import { beforeEach, describe, expect, it, vi } from 'vitest';

const callMock = vi.hoisted(() => vi.fn());
vi.mock(
  '@gitroom/nestjs-libraries/integrations/social/telegram.rich.api',
  async (importOriginal) => ({
    ...(await importOriginal<any>()),
    callTelegramApi: callMock,
  })
);

import {
  FileTooLargeError,
  TELEGRAM_DOWNLOAD_MAX_BYTES,
  TelegramAssistantApi,
} from './telegram.assistant.api';

const keyboard = { inline_keyboard: [[{ text: 'A', callback_data: 'a' }]] };

describe('TelegramAssistantApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('long-polls messages and button presses', async () => {
    callMock.mockResolvedValue([{ update_id: 1 }]);

    await new TelegramAssistantApi('T').getUpdates(5, 25);

    expect(callMock).toHaveBeenCalledWith('T', 'getUpdates', {
      offset: 5,
      timeout: 25,
      allowed_updates: ['message', 'callback_query'],
    });
  });

  it('sends and edits messages with a keyboard', async () => {
    callMock.mockResolvedValue({ message_id: 42 });
    const api = new TelegramAssistantApi('T');

    await expect(api.sendMessage(7, 'Hi', keyboard)).resolves.toBe(42);
    await api.editMessage(7, 42, 'Upd', keyboard);

    expect(callMock).toHaveBeenNthCalledWith(1, 'T', 'sendMessage', {
      chat_id: 7,
      text: 'Hi',
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
    expect(callMock).toHaveBeenNthCalledWith(2, 'T', 'editMessageText', {
      chat_id: 7,
      message_id: 42,
      text: 'Upd',
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
  });

  it('ignores "message is not modified" when editing', async () => {
    callMock.mockRejectedValue(
      new Error('Bad Request: message is not modified')
    );

    await expect(
      new TelegramAssistantApi('T').editMessage(7, 42, 'Same')
    ).resolves.toBeUndefined();
  });

  it('refuses files above the Bot API download limit before downloading', async () => {
    callMock.mockResolvedValue({
      file_path: 'videos/a.mp4',
      file_size: TELEGRAM_DOWNLOAD_MAX_BYTES + 1,
    });
    const download = vi.fn();

    await expect(
      new TelegramAssistantApi('T', download).downloadFile('file-1')
    ).rejects.toBeInstanceOf(FileTooLargeError);
    expect(download).not.toHaveBeenCalled();
  });

  it('downloads a file through its path', async () => {
    callMock.mockResolvedValue({ file_path: 'photos/a.jpg', file_size: 10 });
    const download = vi.fn().mockResolvedValue(Buffer.from('jpeg'));

    const file = await new TelegramAssistantApi('T', download).downloadFile(
      'file-1'
    );

    expect(file.toString()).toBe('jpeg');
    expect(callMock).toHaveBeenCalledWith('T', 'getFile', {
      file_id: 'file-1',
    });
    expect(download).toHaveBeenCalledWith(
      'https://api.telegram.org/file/botT/photos/a.jpg',
      TELEGRAM_DOWNLOAD_MAX_BYTES
    );
  });

  it('deletes a message and ignores one that is already gone', async () => {
    callMock.mockResolvedValueOnce(true);
    const api = new TelegramAssistantApi('T');

    await api.deleteMessage(7, 42);
    expect(callMock).toHaveBeenCalledWith('T', 'deleteMessage', {
      chat_id: 7,
      message_id: 42,
    });

    callMock.mockRejectedValueOnce(
      new Error('Bad Request: message to delete not found')
    );
    await expect(api.deleteMessage(7, 42)).resolves.toBeUndefined();
  });

  it('never throws when a button press is too old to answer', async () => {
    callMock.mockRejectedValueOnce(
      new Error('Bad Request: query is too old and response timeout expired')
    );

    await expect(
      new TelegramAssistantApi('T').answerCallback('cb', 'x')
    ).resolves.toBeUndefined();
  });
});
