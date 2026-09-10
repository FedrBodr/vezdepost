import { describe, expect, it } from 'vitest';
import i18next from '@gitroom/react/translation/i18next';
import { buildMaxBotUrl, buildMaxConnectCommand } from './max.connection';

describe('MAX connection helpers', () => {
  it('builds a bot profile URL without duplicating @', () => {
    expect(buildMaxBotUrl('@vezdepost_bot')).toBe(
      'https://max.ru/vezdepost_bot'
    );
    expect(buildMaxBotUrl('vezdepost_bot')).toBe(
      'https://max.ru/vezdepost_bot'
    );
  });

  it('builds the exact connection command', () => {
    expect(buildMaxConnectCommand('nonce_123')).toBe('/connect nonce_123');
  });

  it('ships the required copy in English and Russian', async () => {
    const keys = [
      'max_connection_choose_type',
      'max_connection_group',
      'max_connection_channel',
      'max_connection_admin_permissions',
      'max_connection_bot_not_admin',
      'max_connection_missing_permissions',
      'max_connection_timed_out',
    ];
    for (const language of ['en', 'ru']) {
      await i18next.changeLanguage(language);
      keys.forEach((key) => expect(i18next.exists(key), key).toBe(true));
    }
  });
});
