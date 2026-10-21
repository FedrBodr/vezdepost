import { KeyValueStore } from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';

// Bot-based channels (Telegram, MAX) are connected by posting `/connect <nonce>`
// in the chat. The server remembers which chat posted the nonce, and
// authenticate accepts only that chat, once.
const TTL_SECONDS = 3600;

const key = (provider: string, kind: 'verified' | 'candidate', nonce: string) =>
  `chat-connect:${provider}:${kind}:${nonce}`;

export const rememberChatConnection = async (
  store: KeyValueStore,
  provider: string,
  nonce: string,
  result: { status: string; chatId?: number; candidateChatId?: number }
) => {
  if (result.status === 'ready' && result.chatId !== undefined) {
    await store.set(key(provider, 'verified', nonce), String(result.chatId), 'EX', TTL_SECONDS);
  } else if (result.candidateChatId !== undefined) {
    await store.set(key(provider, 'candidate', nonce), String(result.candidateChatId), 'EX', TTL_SECONDS);
  }
};

/** A re-check by chat id is allowed only for the chat that posted the nonce. */
export const isConnectionCandidate = async (
  store: KeyValueStore,
  provider: string,
  nonce: string,
  chatId: number
) => (await store.get(key(provider, 'candidate', nonce))) === String(chatId);

/** One-time: returns whether `chatId` is the chat verified for this nonce. */
export const takeVerifiedChat = async (
  store: KeyValueStore,
  provider: string,
  nonce: string,
  chatId: string
) => {
  if (!nonce) {
    return false;
  }
  const verified = await store.get(key(provider, 'verified', nonce));
  await store.del(key(provider, 'verified', nonce));
  return !!verified && verified === chatId;
};
