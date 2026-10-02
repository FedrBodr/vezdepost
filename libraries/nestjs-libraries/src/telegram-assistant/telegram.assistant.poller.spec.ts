import { describe, expect, it, vi } from 'vitest';
import { MemoryKeyValueStore } from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import { TelegramAssistantPoller } from './telegram.assistant.poller';

const make = (batches: any[][]) => {
  const getUpdates = vi.fn();
  batches.forEach((batch) => getUpdates.mockResolvedValueOnce(batch));
  getUpdates.mockResolvedValue([]);
  const handle = vi.fn(async (update: any) => {
    if (update.update_id === 2) {
      throw new Error('handler failed');
    }
  });
  const store = new MemoryKeyValueStore();
  const poller = new TelegramAssistantPoller(
    { getUpdates } as any,
    { handle } as any,
    store,
    'instance-a'
  );
  return { poller, getUpdates, handle, store };
};

describe('TelegramAssistantPoller', () => {
  it('handles every update, survives handler errors and advances the offset', async () => {
    const { poller, getUpdates, handle } = make([
      [{ update_id: 1 }, { update_id: 2 }, { update_id: 3 }],
    ]);

    await poller.runOnce();
    await poller.runOnce();

    expect(handle).toHaveBeenCalledTimes(3);
    expect(getUpdates.mock.calls[0]).toEqual([undefined, 25]);
    expect(getUpdates.mock.calls[1]).toEqual([4, 25]);
  });

  it('does not poll while another instance holds the lock', async () => {
    const { poller, getUpdates, store } = make([]);
    await store.set('tg-assistant:poller', 'instance-b', 'PX', 60_000, 'NX');

    await expect(poller.runOnce()).resolves.toBe(false);
    expect(getUpdates).not.toHaveBeenCalled();
  });

  it('keeps polling with its own lock', async () => {
    const { poller, getUpdates } = make([[{ update_id: 1 }]]);

    await expect(poller.runOnce()).resolves.toBe(true);
    await expect(poller.runOnce()).resolves.toBe(true);
    expect(getUpdates).toHaveBeenCalledTimes(2);
  });

  it('releases its lock on stop so the next deploy takes over at once', async () => {
    const { poller, store } = make([]);
    await poller.runOnce();

    await poller.stop();

    await expect(store.get('tg-assistant:poller')).resolves.toBeNull();
  });

  it('does not release a lock it does not own', async () => {
    const { poller, store } = make([]);
    await store.set('tg-assistant:poller', 'instance-b');

    await poller.stop();

    await expect(store.get('tg-assistant:poller')).resolves.toBe('instance-b');
  });
});
