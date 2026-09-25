import type { KeyValueStore } from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import type { TelegramBusinessConnection } from '@gitroom/nestjs-libraries/integrations/social/telegram.business.api';
import type { TelegramUpdatesHub } from '@gitroom/nestjs-libraries/integrations/social/telegram.updates.hub';

export type TelegramStoriesConnectionStatus =
  | 'waiting_start'
  | 'waiting_business'
  | 'missing_stories_right'
  | 'connection_disabled'
  | 'ready'
  | 'telegram_error';

export type VerifiedStoriesConnection = {
  telegramUserId: number;
  businessConnectionId: string;
};

const VERIFIED_TTL_MS = 15 * 60 * 1_000;
const verifiedKey = (nonce: string) => `telegram-stories:verified:${nonce}`;

export const evaluateBusinessConnection = (
  connection: TelegramBusinessConnection
): 'missing_stories_right' | 'connection_disabled' | 'ready' => {
  if (!connection.is_enabled) {
    return 'connection_disabled';
  }
  return connection.rights?.can_manage_stories === true
    ? 'ready'
    : 'missing_stories_right';
};

/**
 * A connection is accepted only when the private `/start <nonce>` sender and
 * the Telegram Business owner are the same user. The verified pair is kept
 * server-side so the client never supplies Telegram IDs.
 */
export const resolveStoriesConnection = async (
  hub: Pick<
    TelegramUpdatesHub,
    'poll' | 'findConnectionCommand' | 'findBusinessConnection'
  >,
  store: KeyValueStore,
  nonce: string
): Promise<{ status: TelegramStoriesConnectionStatus }> => {
  try {
    await hub.poll();
    const command = await hub.findConnectionCommand(nonce);
    if (
      !command ||
      command.chatType !== 'private' ||
      command.fromId === undefined
    ) {
      return { status: 'waiting_start' };
    }
    const connection = await hub.findBusinessConnection(command.fromId);
    if (!connection) {
      return { status: 'waiting_business' };
    }
    const status = evaluateBusinessConnection(connection);
    if (status === 'ready') {
      const record: VerifiedStoriesConnection = {
        telegramUserId: command.fromId,
        businessConnectionId: connection.id,
      };
      await store.set(
        verifiedKey(nonce),
        JSON.stringify(record),
        'PX',
        VERIFIED_TTL_MS
      );
    }
    return { status };
  } catch (error) {
    console.error('Failed to verify Telegram Stories connection:', error);
    return { status: 'telegram_error' };
  }
};

export const takeVerifiedStoriesConnection = async (
  store: KeyValueStore,
  nonce: string
): Promise<VerifiedStoriesConnection | null> => {
  const raw = await store.get(verifiedKey(nonce));
  if (!raw) {
    return null;
  }
  await store.del(verifiedKey(nonce));
  return JSON.parse(raw);
};
