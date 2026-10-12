import type { InlineKeyboard } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.api';

export type AssistantTransportName = 'telegram' | 'max';

/** Canonical keyboard shape (Telegram's); other transports map it. */
export type AssistantKeyboard = InlineKeyboard;

export type AssistantFile = {
  fileId: string;
  kind: 'image' | 'video';
  size?: number;
};

export type AssistantEvent =
  | {
      kind: 'message';
      chatId: string;
      userId: string;
      text: string;
      file?: AssistantFile;
      unsupported?: boolean;
    }
  | {
      kind: 'callback';
      chatId: string;
      userId: string;
      messageId: string | undefined;
      callbackId: string;
      data: string;
    };

/** What a messenger must provide for the assistant to run on it. */
export type AssistantTransport = {
  name: AssistantTransportName;
  maxFileBytes: number;
  sendMessage(
    chatId: string,
    text: string,
    keyboard?: AssistantKeyboard
  ): Promise<string>;
  editMessage(
    chatId: string,
    messageId: string,
    text: string,
    keyboard?: AssistantKeyboard
  ): Promise<void>;
  deleteMessage(chatId: string, messageId: string): Promise<void>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
  downloadFile(fileId: string): Promise<Buffer>;
};
