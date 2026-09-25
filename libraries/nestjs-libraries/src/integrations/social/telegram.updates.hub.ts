import type TelegramBot from 'node-telegram-bot-api';
import type { KeyValueStore } from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import type { TelegramBusinessConnection } from '@gitroom/nestjs-libraries/integrations/social/telegram.business.api';

// Telegram drops update types missing from allowed_updates, so every reader
// of this bot must request the same union.
export const TELEGRAM_ALLOWED_UPDATES = [
  'message',
  'channel_post',
  'business_connection',
];

const LOCK_KEY = 'telegram:updates:lock';
const OFFSET_KEY = 'telegram:updates:offset';
const LOCK_TTL_MS = 10_000;
const INDEX_TTL_MS = 15 * 60 * 1_000;

export type TelegramConnectionCommand = {
  chatId: number;
  chatType?: string;
  fromId?: number;
};

export const parseTelegramConnectionMessage = (text?: string) => {
  if (!text) {
    return null;
  }

  const match = text.match(
    /^\/(start|connect)(?:@[A-Za-z0-9_]+)? ([A-Za-z0-9_-]{1,64})$/
  );
  if (!match) {
    return null;
  }

  return {
    kind: match[1] as 'start' | 'connect',
    nonce: match[2],
  };
};

/**
 * Single reader of the bot's getUpdates queue. Confirmed updates are indexed
 * in the shared store so concurrent connection wizards never consume each
 * other's events.
 */
export class TelegramUpdatesHub {
  constructor(
    private readonly bot: Pick<TelegramBot, 'getUpdates'>,
    private readonly store: KeyValueStore
  ) {}

  async poll(): Promise<void> {
    const locked = await this.store.set(LOCK_KEY, '1', 'PX', LOCK_TTL_MS, 'NX');
    if (locked !== 'OK') {
      return;
    }
    try {
      const offset = await this.store.get(OFFSET_KEY);
      const updates = await this.bot.getUpdates({
        ...(offset ? { offset: Number(offset) } : {}),
        timeout: 0,
        allowed_updates: TELEGRAM_ALLOWED_UPDATES as any,
      });
      for (const update of updates) {
        await this.index(update as any);
      }
      if (updates.length) {
        await this.store.set(
          OFFSET_KEY,
          String(updates[updates.length - 1].update_id + 1)
        );
      }
    } finally {
      await this.store.del(LOCK_KEY);
    }
  }

  async findConnectionCommand(
    nonce: string
  ): Promise<TelegramConnectionCommand | null> {
    const raw = await this.store.get(`telegram:updates:nonce:${nonce}`);
    return raw ? JSON.parse(raw) : null;
  }

  async findBusinessConnection(
    userId: number
  ): Promise<TelegramBusinessConnection | null> {
    const raw = await this.store.get(`telegram:updates:business:${userId}`);
    return raw ? JSON.parse(raw) : null;
  }

  private async index(update: {
    message?: TelegramBot.Message;
    channel_post?: TelegramBot.Message;
    business_connection?: TelegramBusinessConnection;
  }) {
    const message = update.message || update.channel_post;
    const command = parseTelegramConnectionMessage(message?.text);
    if (command && message?.chat?.id !== undefined) {
      const value: TelegramConnectionCommand = {
        chatId: message.chat.id,
        chatType: message.chat.type,
        ...(message.from?.id !== undefined ? { fromId: message.from.id } : {}),
      };
      await this.store.set(
        `telegram:updates:nonce:${command.nonce}`,
        JSON.stringify(value),
        'PX',
        INDEX_TTL_MS
      );
    }
    if (update.business_connection?.user?.id !== undefined) {
      await this.store.set(
        `telegram:updates:business:${update.business_connection.user.id}`,
        JSON.stringify(update.business_connection),
        'PX',
        INDEX_TTL_MS
      );
    }
  }
}
