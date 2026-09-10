export type MaxConnectionResponse = {
  status:
    | 'waiting'
    | 'ready'
    | 'bot_not_admin'
    | 'missing_permissions'
    | 'max_error';
  chatId?: number;
  candidateChatId?: number;
  lastChatId?: number;
};

export const buildMaxBotUrl = (botName: string) =>
  `https://max.ru/${encodeURIComponent(botName.trim().replace(/^@/, ''))}`;

export const buildMaxConnectCommand = (nonce: string) => `/connect ${nonce}`;
