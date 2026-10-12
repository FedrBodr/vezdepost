import type {
  AssistantEvent,
  AssistantFile,
} from '@gitroom/nestjs-libraries/assistant/assistant.types';

/** Structural view of a MAX Bot API update (only what the assistant reads). */
export type MaxUpdate = {
  update_type: string;
  timestamp?: number;
  message?: {
    sender?: { user_id: number } | null;
    recipient?: { chat_id: number | null; chat_type?: string };
    body?: {
      mid: string;
      text?: string | null;
      attachments?: Array<{ type: string; payload?: unknown }> | null;
    };
  } | null;
  callback?: {
    callback_id: string;
    payload?: string | null;
    user: { user_id: number };
  };
  chat_id?: number;
  user?: { user_id: number };
  payload?: string | null;
};

const urlOf = (payload: unknown) =>
  payload && typeof payload === 'object' && 'url' in payload
    ? (payload as { url?: unknown }).url
    : undefined;

const filesOf = (
  attachments: NonNullable<NonNullable<MaxUpdate['message']>['body']>['attachments']
): { files?: AssistantFile[]; unsupported?: boolean } => {
  const files: AssistantFile[] = [];
  for (const attachment of attachments || []) {
    const url = urlOf(attachment.payload);
    if (attachment.type === 'image' && typeof url === 'string' && url) {
      files.push({ fileId: url, kind: 'image' });
      continue;
    }
    if (
      attachment.type === 'video' ||
      attachment.type === 'file' ||
      attachment.type === 'audio'
    ) {
      // Video download URLs are not verified on a live bot yet (spec stage 5):
      // refuse the whole message rather than silently keeping only the photos.
      return { unsupported: true };
    }
  }
  return files.length ? { files } : {};
};

/** Dialog messages, button presses and /start deep links become assistant events. */
export const maxUpdateToEvent = (update: MaxUpdate): AssistantEvent | null => {
  if (update.update_type === 'message_callback' && update.callback) {
    const message = update.message;
    const chatId = message?.recipient?.chat_id ?? update.callback.user.user_id;
    return {
      kind: 'callback',
      chatId: String(chatId),
      userId: String(update.callback.user.user_id),
      messageId: message?.body?.mid,
      callbackId: update.callback.callback_id,
      data: update.callback.payload ?? '',
    };
  }
  if (update.update_type === 'bot_started' && update.user) {
    return {
      kind: 'message',
      chatId: String(update.chat_id ?? update.user.user_id),
      userId: String(update.user.user_id),
      text: update.payload ? `/start ${update.payload}` : '/start',
    };
  }
  if (update.update_type !== 'message_created') {
    return null;
  }
  const message = update.message;
  if (
    !message?.sender ||
    message.recipient?.chat_type !== 'dialog' ||
    message.recipient.chat_id === null ||
    message.recipient.chat_id === undefined
  ) {
    return null;
  }
  const { files, unsupported } = filesOf(message.body?.attachments);
  return {
    kind: 'message',
    chatId: String(message.recipient.chat_id),
    userId: String(message.sender.user_id),
    text: (message.body?.text ?? '').trim(),
    ...(files ? { files } : {}),
    ...(unsupported ? { unsupported: true } : {}),
  };
};
