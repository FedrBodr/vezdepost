import type { TelegramAssistantLinkService } from '@gitroom/nestjs-libraries/database/prisma/telegram-assistant/telegram.assistant.link.service';
import type {
  TelegramAssistantApi,
  TelegramAssistantUpdate,
} from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.api';
import {
  addMessageToDraft,
  DraftStore,
  renderPanel,
  toggleChannel,
} from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.draft';
import {
  PublishError,
  PublishResult,
  TelegramAssistantPublisher,
} from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.publisher';

export type TelegramAssistantRouterDeps = {
  api: Pick<
    TelegramAssistantApi,
    'sendMessage' | 'editMessage' | 'deleteMessage' | 'answerCallback'
  >;
  linkService: Pick<TelegramAssistantLinkService, 'consumeLinkCode' | 'findLink'>;
  publisher: Pick<TelegramAssistantPublisher, 'listChannels' | 'publish'>;
  drafts: DraftStore;
  appUrl: string;
};

type Message = NonNullable<TelegramAssistantUpdate['message']>;
type CallbackQuery = NonNullable<TelegramAssistantUpdate['callback_query']>;

const DRAFT_ERRORS = {
  unsupported: 'Этот тип файла не поддерживается — отправьте фото или видео.',
  too_large: 'Файл больше 20 МБ — Telegram не даёт боту скачать такой. Сожмите видео или опубликуйте через сайт.',
  too_many: 'В одном посте до 10 файлов.',
};

const summary = ({ published, failed }: PublishResult) =>
  [
    published.length ? `✅ Отправлено в публикацию: ${published.join(', ')}` : '',
    ...failed.map(({ name, error }) => `⚠️ ${name}: ${error}`),
  ]
    .filter(Boolean)
    .join('\n');

/** Handles one Telegram update for @vezde_post_bot. */
export class TelegramAssistantRouter {
  constructor(private readonly deps: TelegramAssistantRouterDeps) {}

  private get help() {
    return [
      'Как постить:',
      '1. Отправьте сюда текст, фото или видео (до 20 МБ, можно альбомом).',
      '2. Отметьте каналы в черновике.',
      '3. Нажмите «🚀 Опубликовать».',
      '',
      `Каналы подключаются на ${this.deps.appUrl}`,
    ].join('\n');
  }

  private get linkInstructions() {
    return [
      'Привет! Я публикую посты Вездепоста во все ваши соцсети.',
      '',
      `1. Зарегистрируйтесь на ${this.deps.appUrl} и подключите каналы.`,
      '2. Нажмите там «Постить из Telegram» — я привяжусь к аккаунту.',
      '3. Присылайте сюда посты.',
    ].join('\n');
  }

  async handle(update: TelegramAssistantUpdate) {
    if (update.callback_query) {
      return this.handleCallback(update.callback_query);
    }
    if (update.message?.chat.type === 'private' && update.message.from) {
      return this.handleMessage(update.message);
    }
  }

  private async handleMessage(message: Message) {
    const chatId = message.chat.id;
    const userId = message.from!.id;
    const text = message.text?.trim() ?? '';

    const start = text.match(/^\/start(?:\s+(\S+))?$/);
    if (start) {
      if (!start[1]) {
        const link = await this.deps.linkService.findLink(userId);
        await this.deps.api.sendMessage(chatId, link ? this.help : this.linkInstructions);
        return;
      }
      const link = await this.deps.linkService.consumeLinkCode(start[1], userId);
      await this.deps.api.sendMessage(
        chatId,
        link
          ? '✅ Готово, Telegram привязан к Вездепосту. Отправьте текст, фото или видео — я предложу каналы.'
          : `Ссылка устарела. Откройте ${this.deps.appUrl} и нажмите «Постить из Telegram» ещё раз.`
      );
      return;
    }
    if (text === '/help') {
      await this.deps.api.sendMessage(chatId, this.help);
      return;
    }

    const link = await this.deps.linkService.findLink(userId);
    if (!link) {
      await this.deps.api.sendMessage(chatId, this.linkInstructions);
      return;
    }

    const current = await this.deps.drafts.get(userId);
    const { draft, error } = addMessageToDraft(current, message);
    if (error) {
      await this.deps.api.sendMessage(chatId, DRAFT_ERRORS[error]);
    }

    // Keep a single panel below the latest message.
    if (draft.panelMessageId) {
      await this.deps.api.deleteMessage(chatId, draft.panelMessageId);
    }
    const panel = renderPanel(
      draft,
      await this.deps.publisher.listChannels(link.organizationId)
    );
    const panelMessageId = await this.deps.api.sendMessage(
      chatId,
      panel.text,
      panel.keyboard
    );
    await this.deps.drafts.save(userId, { ...draft, panelMessageId });
  }

  private async handleCallback(query: CallbackQuery) {
    const userId = query.from.id;
    const chatId = query.message?.chat.id ?? userId;
    const messageId = query.message?.message_id;
    const link = await this.deps.linkService.findLink(userId);
    if (!link || messageId === undefined) {
      await this.deps.api.answerCallback(query.id, 'Сначала привяжите аккаунт');
      return;
    }

    const draft = await this.deps.drafts.get(userId);
    const data = query.data ?? '';

    if (data.startsWith('t:')) {
      const next = toggleChannel(draft, data.slice(2));
      await this.deps.drafts.save(userId, next);
      const panel = renderPanel(
        next,
        await this.deps.publisher.listChannels(link.organizationId)
      );
      await this.deps.api.editMessage(chatId, messageId, panel.text, panel.keyboard);
      await this.deps.api.answerCallback(query.id, undefined);
      return;
    }

    if (data === 'r') {
      await this.deps.drafts.clear(userId);
      await this.deps.api.editMessage(chatId, messageId, '🗑 Черновик сброшен.');
      await this.deps.api.answerCallback(query.id, undefined);
      return;
    }

    if (data === 'p') {
      // Telegram expires a button press within seconds; downloading files
      // takes longer, so answer first and report by message.
      await this.deps.api.answerCallback(query.id, '⏳ Публикую…');
      try {
        const result = await this.deps.publisher.publish(link.organizationId, draft);
        await this.deps.drafts.clear(userId);
        await this.deps.api.editMessage(chatId, messageId, '📤 Черновик отправлен.');
        await this.deps.api.sendMessage(chatId, summary(result));
      } catch (error) {
        if (error instanceof PublishError) {
          await this.deps.api.sendMessage(chatId, `⚠️ ${error.message}`);
          return;
        }
        await this.deps.api.sendMessage(
          chatId,
          `Не удалось опубликовать: ${(error as Error).message}. Черновик сохранён — попробуйте ещё раз.`
        );
      }
      return;
    }

    await this.deps.api.answerCallback(query.id, undefined);
  }
}
