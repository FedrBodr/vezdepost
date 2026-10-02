import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  KeyValueStore,
  redisKeyValueStore,
} from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import { TelegramAssistantLinkRepository } from '@gitroom/nestjs-libraries/database/prisma/telegram-assistant/telegram.assistant.link.repository';

export const TELEGRAM_ASSISTANT_STORE = 'TELEGRAM_ASSISTANT_STORE';
export const TELEGRAM_ASSISTANT_BOT_NAME = 'TELEGRAM_ASSISTANT_BOT_NAME';

const LINK_CODE_TTL_MS = 15 * 60 * 1_000;
const codeKey = (code: string) => `tg-assistant:link:${code}`;

export type TelegramAssistantLink = {
  telegramUserId: string;
  userId: string;
  organizationId: string;
};

/** Links a Telegram user to a Vezdepost user and organization via /start. */
@Injectable()
export class TelegramAssistantLinkService {
  private readonly _store: KeyValueStore;
  private readonly _botName: string;

  constructor(
    private _repository: TelegramAssistantLinkRepository,
    @Optional() @Inject(TELEGRAM_ASSISTANT_STORE) store?: KeyValueStore,
    @Optional() @Inject(TELEGRAM_ASSISTANT_BOT_NAME) botName?: string
  ) {
    this._store = store ?? redisKeyValueStore;
    this._botName = (
      botName ??
      process.env.TELEGRAM_ASSISTANT_BOT_NAME ??
      'vezde_post_bot'
    ).replace(/^@/, '');
  }

  async createLinkUrl(userId: string, organizationId: string) {
    const code = randomBytes(18).toString('base64url');
    await this._store.set(
      codeKey(code),
      JSON.stringify({ userId, organizationId }),
      'PX',
      LINK_CODE_TTL_MS
    );
    return `https://t.me/${this._botName}?start=${code}`;
  }

  async consumeLinkCode(
    code: string,
    telegramUserId: number | string
  ): Promise<TelegramAssistantLink | null> {
    const raw = await this._store.get(codeKey(code));
    if (!raw) {
      return null;
    }
    await this._store.del(codeKey(code));
    const { userId, organizationId } = JSON.parse(raw);
    const link = await this._repository.upsertLink(
      String(telegramUserId),
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
  async findLink(telegramUserId: number | string) {
    const link = await this._repository.findByTelegramUserId(
      String(telegramUserId)
    );
    if (!link) {
      return null;
    }
    if (
      !(await this._repository.isActiveMember(link.userId, link.organizationId))
    ) {
      await this._repository.deleteByTelegramUserId(link.telegramUserId);
      return null;
    }
    return link;
  }
}
