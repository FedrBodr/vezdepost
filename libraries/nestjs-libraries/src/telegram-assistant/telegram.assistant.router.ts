import type { TelegramAssistantLinkService } from '@gitroom/nestjs-libraries/database/prisma/telegram-assistant/telegram.assistant.link.service';
import {
  TELEGRAM_DOWNLOAD_MAX_BYTES,
  type TelegramAssistantApi,
  type TelegramAssistantUpdate,
} from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.api';
import type { DraftStore } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.draft';
import type { TelegramAssistantPublisher } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.publisher';
import { AssistantRouter } from '@gitroom/nestjs-libraries/assistant/assistant.router';
import { telegramUpdateToEvent } from '@gitroom/nestjs-libraries/assistant/telegram.events';
import type { AssistantTransport } from '@gitroom/nestjs-libraries/assistant/assistant.types';

export type TelegramAssistantRouterDeps = {
  api: Pick<
    TelegramAssistantApi,
    'sendMessage' | 'editMessage' | 'deleteMessage' | 'answerCallback'
  > &
    Partial<Pick<TelegramAssistantApi, 'downloadFile'>>;
  linkService: Pick<
    TelegramAssistantLinkService,
    'consumeLinkCode' | 'findLink'
  >;
  publisher: Pick<TelegramAssistantPublisher, 'listChannels' | 'publish'>;
  drafts: DraftStore;
  appUrl: string;
  /** Quiet period before the panel is re-rendered (albums arrive in bursts). */
  panelDelayMs?: number;
};

/** Telegram adapter over the generic assistant router (numeric ids for the API). */
export class TelegramAssistantRouter {
  private readonly inner: AssistantRouter;

  constructor(deps: TelegramAssistantRouterDeps) {
    const transport: AssistantTransport = {
      name: 'telegram',
      maxFileBytes: TELEGRAM_DOWNLOAD_MAX_BYTES,
      sendMessage: (chatId, text, keyboard) =>
        deps.api.sendMessage(Number(chatId), text, keyboard),
      editMessage: (chatId, messageId, text, keyboard) =>
        deps.api.editMessage(Number(chatId), Number(messageId), text, keyboard),
      deleteMessage: (chatId, messageId) =>
        deps.api.deleteMessage(Number(chatId), Number(messageId)),
      answerCallback: (callbackId, text) =>
        deps.api.answerCallback(callbackId, text),
      downloadFile: (fileId) =>
        deps.api.downloadFile
          ? deps.api.downloadFile(fileId)
          : Promise.reject(new Error('downloadFile not available')),
    };
    this.inner = new AssistantRouter({
      transport,
      linkService: {
        consumeLinkCode: (code, _transport, userId) =>
          deps.linkService.consumeLinkCode(code, Number(userId)),
        findLink: (_transport, userId) =>
          deps.linkService.findLink(Number(userId)),
      },
      publisher: {
        listChannels: (orgId) => deps.publisher.listChannels(orgId),
        // The Telegram publisher downloads through its own API client.
        publish: (orgId, draft) => deps.publisher.publish(orgId, draft),
      },
      drafts: deps.drafts,
      draftKeyOf: (userId) => Number(userId),
      appUrl: deps.appUrl,
      linkButtonLabel: 'Постить из Telegram',
      panelDelayMs: deps.panelDelayMs,
    });
  }

  /** Resolves when scheduled panels and background publishes are done. */
  idle() {
    return this.inner.idle();
  }

  async handle(update: TelegramAssistantUpdate) {
    const event = telegramUpdateToEvent(update);
    if (event) {
      await this.inner.handle(event);
    }
  }
}
