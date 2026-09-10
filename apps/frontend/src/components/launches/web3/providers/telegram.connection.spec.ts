import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildTelegramConnectCommand,
  buildTelegramDeepLink,
} from './telegram.connection';

describe('Telegram connection helpers', () => {
  it('builds a group admin deep link with the nonce', () => {
    expect(
      buildTelegramDeepLink({
        botName: '@vezdepost_bot',
        nonce: 'nonce_123',
        destination: 'group',
      })
    ).toBe('https://t.me/vezdepost_bot?startgroup=nonce_123&admin=manage_chat');
  });

  it('encodes the group nonce', () => {
    expect(
      buildTelegramDeepLink({
        botName: 'vezdepost_bot',
        nonce: 'nonce with spaces',
        destination: 'group',
      })
    ).toContain('startgroup=nonce%20with%20spaces');
  });

  it('builds a channel deep link with posting permission', () => {
    expect(
      buildTelegramDeepLink({
        botName: 'vezdepost_bot',
        nonce: 'ignored',
        destination: 'channel',
      })
    ).toBe('https://t.me/vezdepost_bot?startchannel&admin=post_messages');
  });

  it('builds the channel fallback command', () => {
    expect(buildTelegramConnectCommand('nonce_123')).toBe('/connect nonce_123');
  });

  it('ships the guided connection copy in English and Russian', () => {
    const load = (locale: 'en' | 'ru') =>
      JSON.parse(
        readFileSync(
          `libraries/react-shared-libraries/src/translation/locales/${locale}/translation.json`,
          'utf8'
        )
      ) as Record<string, string>;
    const english = load('en');
    const russian = load('ru');
    const keys = [
      'telegram_connection_choose_type',
      'telegram_connection_group_permission',
      'telegram_connection_channel_permission',
      'telegram_connection_bot_not_admin',
      'telegram_connection_missing_post_permission',
      'telegram_connection_manual_help',
    ];

    for (const key of keys) {
      expect(english[key], `English ${key}`).toBeTruthy();
      expect(russian[key], `Russian ${key}`).toBeTruthy();
    }
    expect(russian.telegram_connection_bot_not_admin).toBe(
      'Бот добавлен, но не назначен администратором.'
    );
  });
});
