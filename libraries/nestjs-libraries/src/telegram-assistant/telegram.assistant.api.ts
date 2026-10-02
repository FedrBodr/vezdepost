import { get as httpsGet } from 'https';
import { callTelegramApi } from '@gitroom/nestjs-libraries/integrations/social/telegram.rich.api';

// Bot API getFile only serves files up to 20 MB.
export const TELEGRAM_DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024;

export class FileTooLargeError extends Error {
  constructor() {
    super('File is larger than 20 MB');
    this.name = 'FileTooLargeError';
  }
}

export type InlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export type TelegramAssistantUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number; first_name?: string };
    text?: string;
    caption?: string;
    media_group_id?: string;
    photo?: Array<{ file_id: string; file_size?: number }>;
    video?: { file_id: string; file_size?: number; mime_type?: string };
    document?: { file_id: string; file_size?: number; mime_type?: string };
  };
  callback_query?: {
    id: string;
    from: { id: number };
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
};

type Downloader = (url: string, maxBytes: number) => Promise<Buffer>;

const downloadOverHttps: Downloader = (url, maxBytes) =>
  new Promise((resolve, reject) => {
    const request = httpsGet(url, { timeout: 120_000 }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Telegram file download failed (${response.statusCode})`));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          request.destroy(new FileTooLargeError());
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('timeout', () =>
      request.destroy(new Error('Telegram file download timed out'))
    );
    request.on('error', reject);
  });

const NO_PREVIEW = { link_preview_options: { is_disabled: true } };

export class TelegramAssistantApi {
  constructor(
    private readonly token = process.env.TELEGRAM_ASSISTANT_TOKEN || '',
    private readonly download: Downloader = downloadOverHttps
  ) {}

  getUpdates(offset: number | undefined, timeout: number) {
    return callTelegramApi<TelegramAssistantUpdate[]>(this.token, 'getUpdates', {
      offset,
      timeout,
      allowed_updates: ['message', 'callback_query'],
    });
  }

  async sendMessage(chatId: number, text: string, keyboard?: InlineKeyboard) {
    const result = await callTelegramApi<{ message_id: number }>(
      this.token,
      'sendMessage',
      {
        chat_id: chatId,
        text,
        ...(keyboard ? { reply_markup: keyboard } : {}),
        ...NO_PREVIEW,
      }
    );
    return result.message_id;
  }

  async editMessage(
    chatId: number,
    messageId: number,
    text: string,
    keyboard?: InlineKeyboard
  ) {
    try {
      await callTelegramApi(this.token, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        ...(keyboard ? { reply_markup: keyboard } : {}),
        ...NO_PREVIEW,
      });
    } catch (error) {
      if (!/message is not modified/i.test((error as Error).message)) {
        throw error;
      }
    }
  }

  async answerCallback(callbackId: string, text?: string) {
    await callTelegramApi(this.token, 'answerCallbackQuery', {
      callback_query_id: callbackId,
      ...(text ? { text } : {}),
    });
  }

  async downloadFile(fileId: string) {
    const file = await callTelegramApi<{ file_path?: string; file_size?: number }>(
      this.token,
      'getFile',
      { file_id: fileId }
    );
    if (
      !file.file_path ||
      (file.file_size ?? 0) > TELEGRAM_DOWNLOAD_MAX_BYTES
    ) {
      throw new FileTooLargeError();
    }
    return this.download(
      `https://api.telegram.org/file/bot${this.token}/${file.file_path}`,
      TELEGRAM_DOWNLOAD_MAX_BYTES
    );
  }
}
