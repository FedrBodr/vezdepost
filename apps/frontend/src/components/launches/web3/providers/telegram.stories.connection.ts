export type TelegramStoriesConnectionResponse = {
  status:
    | 'waiting_start'
    | 'waiting_business'
    | 'missing_stories_right'
    | 'connection_disabled'
    | 'ready'
    | 'telegram_error';
};

export const buildTelegramStoriesStartLink = (botName: string, nonce: string) =>
  `https://t.me/${botName.replace(/^@/, '')}?start=${encodeURIComponent(
    nonce
  )}`;
