import type {
  AssistantKeyboard,
  AssistantTransport,
} from '@gitroom/nestjs-libraries/assistant/assistant.types';
import type { MaxUpdate } from '@gitroom/nestjs-libraries/assistant/max.events';

export const MAX_DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024;

/** Update types the assistant subscribes to (a subset of the library's union). */
export type MaxUpdateType = 'message_created' | 'message_callback' | 'bot_started';
const UPDATE_TYPES: MaxUpdateType[] = [
  'message_created',
  'message_callback',
  'bot_started',
];

type MaxKeyboard = {
  type: 'inline_keyboard';
  payload: {
    buttons: Array<Array<{ type: 'callback'; text: string; payload: string }>>;
  };
};

/** The canonical (Telegram-shaped) keyboard as a MAX inline keyboard attachment. */
export const toMaxKeyboard = (keyboard: AssistantKeyboard): MaxKeyboard => ({
  type: 'inline_keyboard',
  payload: {
    buttons: keyboard.inline_keyboard.map((row) =>
      row.map((button) => ({
        type: 'callback' as const,
        text: button.text,
        payload: button.callback_data,
      }))
    ),
  },
});

/** Subset of `Bot['api']` from @maxhub/max-bot-api that the assistant uses. */
export type MaxBotApi = {
  sendMessageToChat(
    chatId: number,
    text: string,
    extra?: { attachments?: unknown[] }
  ): Promise<{ body: { mid: string } }>;
  editMessage(
    messageId: string,
    extra?: { text?: string; attachments?: unknown[] }
  ): Promise<unknown>;
  deleteMessage(messageId: string): Promise<unknown>;
  answerOnCallback(
    callbackId: string,
    extra?: { notification?: string }
  ): Promise<unknown>;
  getUpdates(
    types?: MaxUpdateType[],
    extra?: { marker?: number; timeout?: number }
  ): Promise<{ updates?: MaxUpdate[]; marker?: number } | MaxUpdate[]>;
};

type Downloader = (url: string, maxBytes: number) => Promise<Buffer>;

/** MAX messenger transport for the assistant (separate bot from the channel provider). */
export class MaxAssistantTransport implements AssistantTransport {
  readonly name = 'max' as const;
  readonly maxFileBytes = MAX_DOWNLOAD_MAX_BYTES;

  constructor(
    private readonly api: MaxBotApi,
    private readonly download: Downloader
  ) {}

  async sendMessage(chatId: string, text: string, keyboard?: AssistantKeyboard) {
    const message = await this.api.sendMessageToChat(Number(chatId), text, {
      attachments: keyboard ? [toMaxKeyboard(keyboard)] : [],
    });
    return message.body.mid;
  }

  async editMessage(
    _chatId: string,
    messageId: string,
    text: string,
    keyboard?: AssistantKeyboard
  ) {
    await this.api.editMessage(messageId, {
      text,
      attachments: keyboard ? [toMaxKeyboard(keyboard)] : [],
    });
  }

  async deleteMessage(_chatId: string, messageId: string) {
    try {
      await this.api.deleteMessage(messageId);
    } catch {
      // Already deleted: nothing to clean up.
    }
  }

  /** Best effort: the press is still handled; only the toast is lost. */
  async answerCallback(callbackId: string, text?: string) {
    try {
      await this.api.answerOnCallback(
        callbackId,
        text ? { notification: text } : {}
      );
    } catch {
      // ignore
    }
  }

  downloadFile = (url: string) => this.download(url, this.maxFileBytes);

  async getUpdates(marker: number | undefined, timeout: number) {
    const response = await this.api.getUpdates(UPDATE_TYPES, {
      ...(marker !== undefined ? { marker } : {}),
      timeout,
    });
    if (Array.isArray(response)) {
      return { updates: response, marker: undefined as number | undefined };
    }
    return { updates: response.updates || [], marker: response.marker };
  }
}
