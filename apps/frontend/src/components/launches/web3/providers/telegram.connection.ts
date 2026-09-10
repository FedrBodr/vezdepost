export type TelegramDestination = 'group' | 'channel';

export type TelegramConnectionResponse = {
  status:
    | 'waiting'
    | 'ready'
    | 'bot_not_admin'
    | 'missing_post_permission'
    | 'telegram_error';
  chatId?: number;
  candidateChatId?: number;
  lastChatId?: number;
};

export const buildTelegramConnectCommand = (nonce: string) =>
  `/connect ${nonce}`;

export const buildTelegramDeepLink = ({
  botName,
  nonce,
  destination,
}: {
  botName: string;
  nonce: string;
  destination: TelegramDestination;
}) => {
  const username = botName.replace(/^@/, '');

  return destination === 'group'
    ? `https://t.me/${username}?startgroup=${encodeURIComponent(
        nonce
      )}&admin=manage_chat`
    : `https://t.me/${username}?startchannel&admin=post_messages`;
};
