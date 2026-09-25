import { describe, expect, it, vi } from 'vitest';
import { MemoryKeyValueStore } from './telegram.kv.store';
import {
  resolveStoriesConnection,
  takeVerifiedStoriesConnection,
} from './telegram.stories.connection';

const hubWith = (command: any, connection: any) => ({
  poll: vi.fn().mockResolvedValue(undefined),
  findConnectionCommand: vi.fn().mockResolvedValue(command),
  findBusinessConnection: vi.fn().mockResolvedValue(connection),
});
const privateStart = { chatId: 7, chatType: 'private', fromId: 7 };
const connection = (patch: any = {}) => ({
  id: 'bc-1',
  user: { id: 7 },
  is_enabled: true,
  rights: { can_manage_stories: true },
  ...patch,
});

describe('resolveStoriesConnection', () => {
  it('waits for /start', async () => {
    await expect(
      resolveStoriesConnection(
        hubWith(null, null),
        new MemoryKeyValueStore(),
        'n'
      )
    ).resolves.toEqual({ status: 'waiting_start' });
  });

  it('ignores /start sent from a group', async () => {
    const hub = hubWith(
      { chatId: -5, chatType: 'supergroup', fromId: 7 },
      connection()
    );

    await expect(
      resolveStoriesConnection(hub, new MemoryKeyValueStore(), 'n')
    ).resolves.toEqual({ status: 'waiting_start' });
  });

  it('waits for the business connection of the same user', async () => {
    const hub = hubWith(privateStart, null);

    await expect(
      resolveStoriesConnection(hub, new MemoryKeyValueStore(), 'n')
    ).resolves.toEqual({ status: 'waiting_business' });
    expect(hub.findBusinessConnection).toHaveBeenCalledWith(7);
  });

  it.each([
    [{ is_enabled: false }, 'connection_disabled'],
    [{ rights: { can_manage_stories: false } }, 'missing_stories_right'],
    [{ rights: undefined }, 'missing_stories_right'],
  ])('reports %j as %s', async (patch, status) => {
    await expect(
      resolveStoriesConnection(
        hubWith(privateStart, connection(patch)),
        new MemoryKeyValueStore(),
        'n'
      )
    ).resolves.toEqual({ status });
  });

  it('stores a verified record once ready and hands it out once', async () => {
    const store = new MemoryKeyValueStore();

    await expect(
      resolveStoriesConnection(hubWith(privateStart, connection()), store, 'n')
    ).resolves.toEqual({ status: 'ready' });
    await expect(takeVerifiedStoriesConnection(store, 'n')).resolves.toEqual({
      telegramUserId: 7,
      businessConnectionId: 'bc-1',
    });
    await expect(takeVerifiedStoriesConnection(store, 'n')).resolves.toBeNull();
  });

  it('reports telegram_error when polling fails', async () => {
    const hub = hubWith(null, null);
    hub.poll.mockRejectedValue(new Error('down'));

    await expect(
      resolveStoriesConnection(hub, new MemoryKeyValueStore(), 'n')
    ).resolves.toEqual({ status: 'telegram_error' });
  });
});
