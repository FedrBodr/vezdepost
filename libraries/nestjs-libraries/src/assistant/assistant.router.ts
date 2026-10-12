import type {
  AssistantEvent,
  AssistantTransport,
  AssistantTransportName,
} from '@gitroom/nestjs-libraries/assistant/assistant.types';
import {
  addToDraft,
  Draft,
  DraftChannel,
  DraftStore,
  renderPanel,
  toggleChannel,
} from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.draft';
import {
  PublishError,
  PublishResult,
} from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.publisher';

export type AssistantRouterDeps = {
  transport: AssistantTransport;
  linkService: {
    consumeLinkCode(
      code: string,
      transport: AssistantTransportName,
      messengerUserId: string
    ): Promise<{ organizationId: string } | null>;
    findLink(
      transport: AssistantTransportName,
      messengerUserId: string
    ): Promise<{ organizationId: string } | null>;
  };
  publisher: {
    listChannels(organizationId: string): Promise<DraftChannel[]>;
    publish(
      organizationId: string,
      draft: Draft,
      download: (fileId: string) => Promise<Buffer>
    ): Promise<PublishResult>;
  };
  drafts: DraftStore;
  /** Draft store key for a messenger user (Telegram keeps numeric keys). */
  draftKeyOf: (userId: string) => number | string;
  appUrl: string;
  /** Button label on the site that starts the link flow for this messenger. */
  linkButtonLabel: string;
  /** Quiet period before the panel is re-rendered (albums arrive in bursts). */
  panelDelayMs?: number;
};

type MessageEvent = Extract<AssistantEvent, { kind: 'message' }>;
type CallbackEvent = Extract<AssistantEvent, { kind: 'callback' }>;

const summary = ({ published, failed }: PublishResult) =>
  [
    published.length
      ? `✅ Отправлено в публикацию: ${published.join(', ')}`
      : '',
    ...failed.map(({ name, error }) => `⚠️ ${name}: ${error}`),
  ]
    .filter(Boolean)
    .join('\n');

const messengerTitle = (name: AssistantTransportName) =>
  name === 'telegram' ? 'Telegram' : 'MAX';

/** Messenger-agnostic assistant: draft, channel panel, link flow, publish. */
export class AssistantRouter {
  private readonly panelTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly publishing = new Set<string>();
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly deps: AssistantRouterDeps) {}

  /** Resolves when scheduled panels and background publishes are done. */
  async idle() {
    while (this.panelTimers.size || this.pending.size) {
      await Promise.all([...this.pending]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  private get name() {
    return this.deps.transport.name;
  }

  private get draftErrors() {
    const mb = Math.round(this.deps.transport.maxFileBytes / 1024 / 1024);
    const telegram = this.name === 'telegram';
    return {
      unsupported: telegram
        ? 'Этот тип файла не поддерживается — отправьте фото или видео.'
        : 'Видео из MAX пока не принимается — отправьте фото или опубликуйте через сайт.',
      too_large: `Файл больше ${mb} МБ — ${
        telegram
          ? 'Telegram не даёт боту скачать такой'
          : 'бот не может скачать такой'
      }. Сожмите видео или опубликуйте через сайт.`,
      too_many: 'В одном посте до 10 файлов.',
    };
  }

  /** What the user may send: Telegram takes video, MAX photos only for now. */
  private get mediaWords() {
    return this.name === 'telegram' ? 'текст, фото или видео' : 'текст или фото';
  }

  private track(work: Promise<void>) {
    const tracked = work
      .catch((error) => console.error(`[${this.name}-assistant]`, error))
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }

  private schedulePanel(userId: string, chatId: string, organizationId: string) {
    clearTimeout(this.panelTimers.get(userId));
    this.panelTimers.set(
      userId,
      setTimeout(() => {
        this.panelTimers.delete(userId);
        this.track(this.refreshPanel(userId, chatId, organizationId));
      }, this.deps.panelDelayMs ?? 1_500)
    );
  }

  /** Keeps a single panel below the latest message. */
  private async refreshPanel(
    userId: string,
    chatId: string,
    organizationId: string
  ) {
    const key = this.deps.draftKeyOf(userId);
    const draft = await this.deps.drafts.get(key);
    if (draft.panelMessageId) {
      await this.deps.transport.deleteMessage(
        chatId,
        String(draft.panelMessageId)
      );
    }
    const panel = renderPanel(
      draft,
      await this.deps.publisher.listChannels(organizationId)
    );
    const panelMessageId = await this.deps.transport.sendMessage(
      chatId,
      panel.text,
      panel.keyboard
    );
    const latest = await this.deps.drafts.get(key);
    await this.deps.drafts.save(key, { ...latest, panelMessageId });
  }

  private get help() {
    const mb = Math.round(this.deps.transport.maxFileBytes / 1024 / 1024);
    return [
      'Как постить:',
      `1. Отправьте сюда ${this.mediaWords} (до ${mb} МБ, можно альбомом).`,
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
      `2. Нажмите там «${this.deps.linkButtonLabel}» — я привяжусь к аккаунту.`,
      '3. Присылайте сюда посты.',
    ].join('\n');
  }

  async handle(event: AssistantEvent) {
    if (event.kind === 'callback') {
      return this.handleCallback(event);
    }
    return this.handleMessage(event);
  }

  private async handleMessage(event: MessageEvent) {
    const { chatId, userId } = event;
    const text = event.text.trim();
    const { transport, linkService } = this.deps;

    const start = text.match(/^\/start(?:\s+(\S+))?$/);
    if (start) {
      if (!start[1]) {
        const link = await linkService.findLink(this.name, userId);
        await transport.sendMessage(
          chatId,
          link ? this.help : this.linkInstructions
        );
        return;
      }
      const link = await linkService.consumeLinkCode(
        start[1],
        this.name,
        userId
      );
      await transport.sendMessage(
        chatId,
        link
          ? `✅ Готово, ${messengerTitle(
              this.name
            )} привязан к Вездепосту. Отправьте ${this.mediaWords} — я предложу каналы.`
          : `Ссылка устарела. Откройте ${this.deps.appUrl} и нажмите «${this.deps.linkButtonLabel}» ещё раз.`
      );
      return;
    }
    if (text === '/help') {
      await transport.sendMessage(chatId, this.help);
      return;
    }

    const link = await linkService.findLink(this.name, userId);
    if (!link) {
      await transport.sendMessage(chatId, this.linkInstructions);
      return;
    }

    const key = this.deps.draftKeyOf(userId);
    let draft = await this.deps.drafts.get(key);
    // Text goes in with the first file; every further file of the same
    // message (MAX albums) is added on its own so the file limit applies.
    const inputs: Array<Parameters<typeof addToDraft>[1]> = event.files?.length
      ? event.files.map((file, index) => ({
          text: index === 0 ? text : '',
          file,
        }))
      : [{ text, unsupported: event.unsupported }];
    let firstError: keyof typeof this.draftErrors | undefined;
    for (const input of inputs) {
      const result = addToDraft(draft, input, transport.maxFileBytes);
      draft = result.draft;
      firstError = firstError ?? result.error;
    }
    await this.deps.drafts.save(key, draft);
    if (firstError) {
      await transport.sendMessage(chatId, this.draftErrors[firstError]);
    }
    this.schedulePanel(userId, chatId, link.organizationId);
  }

  private async handleCallback(event: CallbackEvent) {
    const { chatId, userId, messageId, callbackId, data } = event;
    const { transport } = this.deps;
    const link = await this.deps.linkService.findLink(this.name, userId);
    if (!link || messageId === undefined) {
      await transport.answerCallback(callbackId, 'Сначала привяжите аккаунт');
      return;
    }

    const key = this.deps.draftKeyOf(userId);
    const draft = await this.deps.drafts.get(key);

    if (data.startsWith('t:')) {
      const next = toggleChannel(draft, data.slice(2));
      await this.deps.drafts.save(key, next);
      const panel = renderPanel(
        next,
        await this.deps.publisher.listChannels(link.organizationId)
      );
      await transport.editMessage(chatId, messageId, panel.text, panel.keyboard);
      await transport.answerCallback(callbackId, undefined);
      return;
    }

    if (data === 'r') {
      await this.deps.drafts.clear(key);
      await transport.editMessage(chatId, messageId, '🗑 Черновик сброшен.');
      await transport.answerCallback(callbackId, undefined);
      return;
    }

    if (data === 'p') {
      // Button presses expire within seconds and downloads take longer:
      // answer now, publish in the background, report by message.
      await transport.answerCallback(callbackId, '⏳ Публикую…');
      if (this.publishing.has(userId)) {
        await transport.sendMessage(chatId, '⏳ Уже публикую предыдущий пост…');
        return;
      }
      this.publishing.add(userId);
      this.track(
        this.publishDraft(
          userId,
          chatId,
          messageId,
          link.organizationId
        ).finally(() => this.publishing.delete(userId))
      );
      return;
    }

    await transport.answerCallback(callbackId, undefined);
  }

  private async publishDraft(
    userId: string,
    chatId: string,
    messageId: string,
    organizationId: string
  ) {
    const key = this.deps.draftKeyOf(userId);
    const draft = await this.deps.drafts.get(key);
    const { transport } = this.deps;
    try {
      const result = await this.deps.publisher.publish(
        organizationId,
        draft,
        transport.downloadFile
      );
      await this.deps.drafts.clear(key);
      await transport.editMessage(chatId, messageId, '📤 Черновик отправлен.');
      await transport.sendMessage(chatId, summary(result));
    } catch (error) {
      await transport.sendMessage(
        chatId,
        error instanceof PublishError
          ? `⚠️ ${error.message}`
          : `Не удалось опубликовать: ${
              (error as Error).message
            }. Черновик сохранён — попробуйте ещё раз.`
      );
    }
  }
}
