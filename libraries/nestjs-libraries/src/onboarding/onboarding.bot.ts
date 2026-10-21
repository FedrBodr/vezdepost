import { Bot } from '@maxhub/max-bot-api';
import { TelegramAssistantApi } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.api';

export type AssistantMessenger = 'telegram' | 'max';

/**
 * Sends a plain-text message to a linked assistant user. The link stores the
 * messenger user id: in Telegram it doubles as the private chat id, in MAX it
 * needs the user endpoint. False when that assistant bot is not configured.
 */
export async function sendAssistantText(
  transport: string,
  messengerUserId: string,
  text: string
): Promise<AssistantMessenger | false> {
  if (transport === 'telegram' && process.env.TELEGRAM_ASSISTANT_TOKEN) {
    await new TelegramAssistantApi(
      process.env.TELEGRAM_ASSISTANT_TOKEN
    ).sendMessage(Number(messengerUserId), text);
    return 'telegram';
  }
  if (transport === 'max' && process.env.MAX_ASSISTANT_TOKEN) {
    await new Bot(process.env.MAX_ASSISTANT_TOKEN).api.sendMessageToUser(
      Number(messengerUserId),
      text
    );
    return 'max';
  }
  return false;
}
