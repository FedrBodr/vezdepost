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
    ).toBe(
      'https://t.me/vezdepost_bot?startgroup=nonce_123&admin=manage_chat'
    );
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
    ).toBe(
      'https://t.me/vezdepost_bot?startchannel&admin=post_messages'
    );
  });

  it('builds the channel fallback command', () => {
    expect(buildTelegramConnectCommand('nonce_123')).toBe(
      '/connect nonce_123'
    );
  });
});
