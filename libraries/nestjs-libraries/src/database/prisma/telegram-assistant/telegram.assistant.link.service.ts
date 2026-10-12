import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  KeyValueStore,
  redisKeyValueStore,
} from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import {
  AssistantLinkTransport,
  TelegramAssistantLinkRepository,
} from '@gitroom/nestjs-libraries/database/prisma/telegram-assistant/telegram.assistant.link.repository';

export const TELEGRAM_ASSISTANT_STORE = 'TELEGRAM_ASSISTANT_STORE';
export const TELEGRAM_ASSISTANT_BOT_NAME = 'TELEGRAM_ASSISTANT_BOT_NAME';
export const MAX_ASSISTANT_BOT_NAME = 'MAX_ASSISTANT_BOT_NAME';

const LINK_CODE_TTL_MS = 15 * 60 * 1_000;
const codeKey = (code: string) => `tg-assistant:link:${code}`;
const botName = (value: string) => value.replace(/^@/, '');

export type TelegramAssistantLink = {
  telegramUserId: string;
  userId: string;
  organizationId: string;
};

/**
 * Links a messenger user (Telegram or MAX) to a Vezdepost user and
 * organization via a one-time /start code. The class name is historical.
 */
@Injectable()
export class TelegramAssistantLinkService {
  private readonly _store: KeyValueStore;
  private readonly _telegramBot: string;
  private readonly _maxBot: string;

  constructor(
    private _repository: TelegramAssistantLinkRepository,
    @Optional() @Inject(TELEGRAM_ASSISTANT_STORE) store?: KeyValueStore,
    @Optional() @Inject(TELEGRAM_ASSISTANT_BOT_NAME) telegramBot?: string,
    @Optional() @Inject(MAX_ASSISTANT_BOT_NAME) maxBot?: string
  ) {
    this._store = store ?? redisKeyValueStore;
    this._telegramBot = botName(
      telegramBot ?? process.env.TELEGRAM_ASSISTANT_BOT_NAME ?? 'vezde_post_bot'
    );
    this._maxBot = botName(
      maxBot ?? process.env.MAX_ASSISTANT_BOT_NAME ?? 'vezdepost_assistant_bot'
    );
  }

  async createLinkUrl(
    userId: string,
    organizationId: string,
    transport: AssistantLinkTransport = 'telegram'
  ) {
    const code = randomBytes(18).toString('base64url');
    await this._store.set(
      codeKey(code),
      JSON.stringify({ userId, organizationId }),
      'PX',
      LINK_CODE_TTL_MS
    );
    return transport === 'max'
      ? `https://max.ru/${this._maxBot}?start=${code}`
      : `https://t.me/${this._telegramBot}?start=${code}`;
  }

  async consumeLinkCode(
    code: string,
    messengerUserId: number | string,
    transport: AssistantLinkTransport = 'telegram'
  ): Promise<TelegramAssistantLink | null> {
    const raw = await this._store.get(codeKey(code));
    if (!raw) {
      return null;
    }
    await this._store.del(codeKey(code));
    const { userId, organizationId } = JSON.parse(raw);
    const link = await this._repository.upsertLink(
      transport,
      String(messengerUserId),
      userId,
      organizationId
    );
    return {
      telegramUserId: link.telegramUserId,
      userId: link.userId,
      organizationId: link.organizationId,
    };
  }

  /** The link, if its user still belongs to the organization. */
  async findLink(
    messengerUserId: number | string,
    transport: AssistantLinkTransport = 'telegram'
  ) {
    const link = await this._repository.findByMessengerUserId(
      transport,
      String(messengerUserId)
    );
    if (!link) {
      return null;
    }
    if (
      !(await this._repository.isActiveMember(link.userId, link.organizationId))
    ) {
      await this._repository.deleteByMessengerUserId(
        transport,
        link.telegramUserId
      );
      return null;
    }
    return link;
  }
}
