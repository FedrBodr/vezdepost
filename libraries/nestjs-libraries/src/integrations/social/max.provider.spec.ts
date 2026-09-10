import { describe, expect, it, vi } from 'vitest';
import {
  evaluateMaxPermissions,
  MaxProvider,
  parseMaxConnectionMessage,
} from './max.provider';

const makeApi = ({
  updates = [],
  marker,
  member = {
    is_admin: true,
    permissions: ['read_all_messages', 'write'],
  },
}: {
  updates?: unknown[];
  marker?: number;
  member?: { is_admin?: boolean; permissions?: string[] | null };
} = {}) => ({
  getUpdates: vi.fn().mockResolvedValue({ updates, marker }),
  getChat: vi.fn().mockResolvedValue({ chat_id: 321, type: 'chat' }),
  getChatMembership: vi.fn().mockResolvedValue(member),
});

describe('MAX connection command', () => {
  it('accepts only an exact connect command', () => {
    expect(parseMaxConnectionMessage('/connect nonce_123')).toEqual({
      nonce: 'nonce_123',
    });
    expect(parseMaxConnectionMessage('/connect nonce_1234')).toEqual({
      nonce: 'nonce_1234',
    });
    expect(parseMaxConnectionMessage('/connect nonce_123 extra')).toBeNull();
    expect(parseMaxConnectionMessage(' /connect nonce_123')).toBeNull();
  });
});

describe('MAX connection permissions', () => {
  it('requires administrator status', () => {
    expect(
      evaluateMaxPermissions({
        is_admin: false,
        permissions: ['read_all_messages', 'write'],
      })
    ).toBe('bot_not_admin');
  });

  it.each([['write'], ['read_all_messages'], null])(
    'requires read and write permissions (%s)',
    (permissions) => {
      expect(evaluateMaxPermissions({ is_admin: true, permissions })).toBe(
        'missing_permissions'
      );
    }
  );

  it('accepts an administrator with both permissions', () => {
    expect(
      evaluateMaxPermissions({
        is_admin: true,
        permissions: ['read_all_messages', 'write'],
      })
    ).toBe('ready');
  });
});

describe('MAX connection discovery', () => {
  it('returns the next marker while waiting', async () => {
    const api = makeApi({ marker: 77 });

    await expect(
      new MaxProvider(api as any).getBotId({ word: 'nonce_123' })
    ).resolves.toEqual({ status: 'waiting', lastChatId: 77 });
  });

  it('discovers and verifies an exact command', async () => {
    const api = makeApi({
      updates: [
        {
          message: {
            body: { text: '/connect nonce_123' },
            recipient: { chat_id: 321 },
          },
        },
      ],
    });

    await expect(
      new MaxProvider(api as any).getBotId({ word: 'nonce_123' })
    ).resolves.toEqual({ status: 'ready', chatId: 321 });
  });

  it('does not accept a near nonce match', async () => {
    const api = makeApi({
      updates: [
        {
          message: {
            body: { text: '/connect nonce_1234' },
            recipient: { chat_id: 321 },
          },
        },
      ],
    });

    await expect(
      new MaxProvider(api as any).getBotId({ word: 'nonce_123' })
    ).resolves.toEqual({ status: 'waiting' });
    expect(api.getChatMembership).not.toHaveBeenCalled();
  });

  it.each([
    [
      { is_admin: false, permissions: ['read_all_messages', 'write'] },
      'bot_not_admin',
    ],
    [{ is_admin: true, permissions: ['write'] }, 'missing_permissions'],
  ])('returns a recoverable permission status', async (member, status) => {
    const api = makeApi({
      member,
      updates: [
        {
          message: {
            body: { text: '/connect nonce_123' },
            recipient: { chat_id: 321 },
          },
        },
      ],
    });

    await expect(
      new MaxProvider(api as any).getBotId({ word: 'nonce_123' })
    ).resolves.toEqual({ status, candidateChatId: 321 });
  });

  it('rechecks a candidate without fetching updates', async () => {
    const api = makeApi();

    await expect(
      new MaxProvider(api as any).getBotId({
        word: 'nonce_123',
        chatId: 321,
      })
    ).resolves.toEqual({ status: 'ready', chatId: 321 });
    expect(api.getUpdates).not.toHaveBeenCalled();
  });

  it('returns a recoverable status when MAX fails', async () => {
    const api = makeApi();
    api.getUpdates.mockRejectedValueOnce(new Error('MAX unavailable'));

    await expect(
      new MaxProvider(api as any).getBotId({ word: 'nonce_123' })
    ).resolves.toEqual({ status: 'max_error' });
  });
});
