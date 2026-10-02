import type { KeyValueStore } from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import {
  InlineKeyboard,
  TELEGRAM_DOWNLOAD_MAX_BYTES,
  TelegramAssistantUpdate,
} from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.api';

const DRAFT_TTL_MS = 60 * 60 * 1_000;
const MAX_FILES = 10;

export type DraftFile = { fileId: string; kind: 'image' | 'video' };
export type Draft = {
  text: string;
  files: DraftFile[];
  selected: string[];
  panelMessageId?: number;
};
export type DraftChannel = {
  id: string;
  name: string;
  providerIdentifier: string;
};
type Message = NonNullable<TelegramAssistantUpdate['message']>;

export const emptyDraft = (): Draft => ({ text: '', files: [], selected: [] });

const fileOf = (
  message: Message
): { file?: DraftFile; size?: number; unsupported?: boolean } => {
  if (message.photo?.length) {
    const largest = message.photo[message.photo.length - 1];
    return {
      file: { fileId: largest.file_id, kind: 'image' },
      size: largest.file_size,
    };
  }
  if (message.video) {
    return {
      file: { fileId: message.video.file_id, kind: 'video' },
      size: message.video.file_size,
    };
  }
  if (message.document) {
    const mime = message.document.mime_type || '';
    const kind = mime.startsWith('image/')
      ? 'image'
      : mime.startsWith('video/')
      ? 'video'
      : undefined;
    return kind
      ? {
          file: { fileId: message.document.file_id, kind },
          size: message.document.file_size,
        }
      : { unsupported: true };
  }
  return {};
};

/** Adds a Telegram message to the draft; the draft is unchanged on error. */
export const addMessageToDraft = (
  draft: Draft,
  message: Message
): { draft: Draft; error?: 'unsupported' | 'too_large' | 'too_many' } => {
  const { file, size, unsupported } = fileOf(message);
  if (unsupported) {
    return { draft, error: 'unsupported' };
  }
  if (file && (size ?? 0) > TELEGRAM_DOWNLOAD_MAX_BYTES) {
    return { draft, error: 'too_large' };
  }
  if (file && draft.files.length >= MAX_FILES) {
    return { draft, error: 'too_many' };
  }
  const text = (message.text ?? message.caption ?? '').trim();
  return {
    draft: {
      ...draft,
      text: [draft.text, text].filter(Boolean).join('\n\n'),
      files: file ? [...draft.files, file] : draft.files,
    },
  };
};

export const toggleChannel = (draft: Draft, channelId: string): Draft => ({
  ...draft,
  selected: draft.selected.includes(channelId)
    ? draft.selected.filter((id) => id !== channelId)
    : [...draft.selected, channelId],
});

export const renderPanel = (
  draft: Draft,
  channels: DraftChannel[]
): { text: string; keyboard: InlineKeyboard } => ({
  text: [
    '📝 Черновик',
    `Текст: ${draft.text.length} симв.`,
    `Файлы: ${draft.files.length}`,
    '',
    channels.length
      ? 'Выберите каналы и нажмите «Опубликовать». Можно дослать ещё текст или файлы.'
      : 'Нет подключённых каналов — подключите их на app.vezdepost.ru.',
  ].join('\n'),
  keyboard: {
    inline_keyboard: [
      ...channels.map((channel) => [
        {
          text: `${draft.selected.includes(channel.id) ? '✅' : '▫️'} ${
            channel.name
          } · ${channel.providerIdentifier}`,
          callback_data: `t:${channel.id}`,
        },
      ]),
      [
        { text: '🚀 Опубликовать', callback_data: 'p' },
        { text: '🗑 Сбросить', callback_data: 'r' },
      ],
    ],
  },
});

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain Telegram text to the editor's HTML: one paragraph per line. */
export const plainTextToHtml = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');

const draftKey = (telegramUserId: number) =>
  `tg-assistant:draft:${telegramUserId}`;

export class DraftStore {
  constructor(private readonly store: KeyValueStore) {}

  async get(telegramUserId: number): Promise<Draft> {
    const raw = await this.store.get(draftKey(telegramUserId));
    return raw ? JSON.parse(raw) : emptyDraft();
  }

  async save(telegramUserId: number, draft: Draft) {
    await this.store.set(
      draftKey(telegramUserId),
      JSON.stringify(draft),
      'PX',
      DRAFT_TTL_MS
    );
  }

  async clear(telegramUserId: number) {
    await this.store.del(draftKey(telegramUserId));
  }
}
