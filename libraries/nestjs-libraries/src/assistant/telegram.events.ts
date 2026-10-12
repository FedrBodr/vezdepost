import { PUBLISHABLE_MIME } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.draft';
import type { TelegramAssistantUpdate } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.api';
import type {
  AssistantEvent,
  AssistantFile,
} from '@gitroom/nestjs-libraries/assistant/assistant.types';

type Message = NonNullable<TelegramAssistantUpdate['message']>;

const fileOf = (
  message: Message
): { file?: AssistantFile; unsupported?: boolean } => {
  if (message.photo?.length) {
    const largest = message.photo[message.photo.length - 1];
    return {
      file: { fileId: largest.file_id, kind: 'image', size: largest.file_size },
    };
  }
  if (message.video) {
    if (
      message.video.mime_type &&
      !PUBLISHABLE_MIME.has(message.video.mime_type)
    ) {
      return { unsupported: true };
    }
    return {
      file: {
        fileId: message.video.file_id,
        kind: 'video',
        size: message.video.file_size,
      },
    };
  }
  if (message.document) {
    const mime = message.document.mime_type || '';
    if (!PUBLISHABLE_MIME.has(mime)) {
      return { unsupported: true };
    }
    return {
      file: {
        fileId: message.document.file_id,
        kind: mime.startsWith('image/') ? 'image' : 'video',
        size: message.document.file_size,
      },
    };
  }
  return {};
};

/** Private-chat messages and button presses become assistant events. */
export const telegramUpdateToEvent = (
  update: TelegramAssistantUpdate
): AssistantEvent | null => {
  if (update.callback_query) {
    const q = update.callback_query;
    return {
      kind: 'callback',
      chatId: String(q.message?.chat.id ?? q.from.id),
      userId: String(q.from.id),
      messageId: q.message ? String(q.message.message_id) : undefined,
      callbackId: q.id,
      data: q.data ?? '',
    };
  }
  const message = update.message;
  if (!message || message.chat.type !== 'private' || !message.from) {
    return null;
  }
  const { file, unsupported } = fileOf(message);
  return {
    kind: 'message',
    chatId: String(message.chat.id),
    userId: String(message.from.id),
    text: (message.text ?? message.caption ?? '').trim(),
    ...(file ? { file } : {}),
    ...(unsupported ? { unsupported: true } : {}),
  };
};
