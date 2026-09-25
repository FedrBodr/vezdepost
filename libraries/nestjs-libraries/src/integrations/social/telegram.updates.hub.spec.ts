import { describe, expect, it, vi } from 'vitest';
import { MemoryKeyValueStore } from './telegram.kv.store';
import {
  TELEGRAM_ALLOWED_UPDATES,
  TelegramUpdatesHub,
} from './telegram.updates.hub';

const bot = (batches: any[][]) => {
  const getUpdates = vi.fn();
  batches.forEach((batch) => getUpdates.mockResolvedValueOnce(batch));
  getUpdates.mockResolvedValue([]);
  return { getUpdates };
};

describe('TelegramUpdatesHub', () => {
  it('requests every update type and stores the next offset', async () => {
    const store = new MemoryKeyValueStore();
    const client = bot([[{ update_id: 10 }, { update_id: 11 }], []]);
    const hub = new TelegramUpdatesHub(client as any, store);

    await hub.poll();
    await hub.poll();

    expect(client.getUpdates.mock.calls[0][0]).toEqual({
      timeout: 0,
      allowed_updates: TELEGRAM_ALLOWED_UPDATES,
    });
    expect(client.getUpdates.mock.calls[1][0]).toMatchObject({ offset: 12 });
  });

  it('indexes connection commands by nonce and business connections by user', async () => {
    const store = new MemoryKeyValueStore();
    const hub = new TelegramUpdatesHub(
      bot([
        [
          {
            update_id: 1,
            message: {
              text: '/start abc',
              chat: { id: 7, type: 'private' },
              from: { id: 7 },
            },
          },
          {
            update_id: 2,
            channel_post: {
              text: '/connect chan',
              chat: { id: -100, type: 'channel' },
            },
          },
          {
            update_id: 3,
            business_connection: {
              id: 'bc-1',
              user: { id: 7 },
              is_enabled: true,
              rights: { can_manage_stories: true },
            },
          },
        ],
      ]) as any,
      store
    );

    await hub.poll();

    await expect(hub.findConnectionCommand('abc')).resolves.toEqual({
      chatId: 7,
      chatType: 'private',
      fromId: 7,
    });
    await expect(hub.findConnectionCommand('chan')).resolves.toEqual({
      chatId: -100,
      chatType: 'channel',
    });
    await expect(hub.findConnectionCommand('ab')).resolves.toBeNull();
    await expect(hub.findBusinessConnection(7)).resolves.toMatchObject({
      id: 'bc-1',
    });
  });

  it('keeps updates for a second reader when two readers poll', async () => {
    const store = new MemoryKeyValueStore();
    const client = bot([
      [
        {
          update_id: 1,
          message: {
            text: '/start first',
            chat: { id: 1, type: 'private' },
            from: { id: 1 },
          },
        },
        {
          update_id: 2,
          message: {
            text: '/start second',
            chat: { id: 2, type: 'private' },
            from: { id: 2 },
          },
        },
      ],
    ]);
    const hub = new TelegramUpdatesHub(client as any, store);

    await hub.poll(); // reader A
    await hub.poll(); // reader B, Telegram already confirmed both updates

    await expect(hub.findConnectionCommand('first')).resolves.not.toBeNull();
    await expect(hub.findConnectionCommand('second')).resolves.not.toBeNull();
  });

  it('skips polling while another reader holds the lock', async () => {
    const store = new MemoryKeyValueStore();
    await store.set('telegram:updates:lock', 'other', 'PX', 10_000, 'NX');
    const client = bot([]);

    await new TelegramUpdatesHub(client as any, store).poll();

    expect(client.getUpdates).not.toHaveBeenCalled();
  });

  it('releases the lock when Telegram fails', async () => {
    const store = new MemoryKeyValueStore();
    const client = {
      getUpdates: vi.fn().mockRejectedValue(new Error('down')),
    };
    const hub = new TelegramUpdatesHub(client as any, store);

    await expect(hub.poll()).rejects.toThrow('down');
    await expect(store.get('telegram:updates:lock')).resolves.toBeNull();
  });
});
