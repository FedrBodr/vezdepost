import { describe, expect, it, vi } from 'vitest';
import { MemoryKeyValueStore } from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import { MaxAssistantPoller } from './max.assistant.poller';

const user = { user_id: 42, name: 'U', username: null };
const created = (mid: string, text: string) => ({
  update_type: 'message_created',
  timestamp: 1,
  message: {
    sender: user,
    recipient: { chat_id: 500, chat_type: 'dialog' },
    timestamp: 1,
    body: { mid, seq: 1, text, attachments: null },
  },
});

const make = (batches: Array<{ updates: any[]; marker?: number }>) => {
  const getUpdates = vi.fn();
  batches.forEach((batch) => getUpdates.mockResolvedValueOnce(batch));
  getUpdates.mockResolvedValue({ updates: [] });
  const handle = vi.fn(async (event: any) => {
    if (event.text === 'boom') {
      throw new Error('handler failed');
    }
  });
  const store = new MemoryKeyValueStore();
  const poller = new MaxAssistantPoller(
    { getUpdates } as any,
    { handle } as any,
    store,
    'instance-a'
  );
  return { poller, getUpdates, handle, store };
};

describe('MaxAssistantPoller', () => {
  it('routes mapped events, survives handler errors and advances the marker', async () => {
    const { poller, getUpdates, handle } = make([
      {
        updates: [
          created('m1', 'hi'),
          created('m2', 'boom'),
          { update_type: 'message_removed', timestamp: 1 },
        ],
        marker: 77,
      },
    ]);

    await poller.runOnce();
    await poller.runOnce();

    expect(handle).toHaveBeenCalledTimes(2);
    expect(handle.mock.calls[0][0]).toMatchObject({ kind: 'message', text: 'hi' });
    expect(getUpdates.mock.calls[0]).toEqual([undefined, 25]);
    expect(getUpdates.mock.calls[1]).toEqual([77, 25]);
  });

  it('uses its own lock key', async () => {
    const { poller, store } = make([]);
    await poller.runOnce();
    expect(await store.get('max-assistant:poller')).toBe('instance-a');
    expect(await store.get('tg-assistant:poller')).toBeFalsy();
  });

  it('does not poll while another instance holds the lock', async () => {
    const { poller, getUpdates, store } = make([]);
    await store.set('max-assistant:poller', 'instance-b', 'PX', 60_000, 'NX');

    await expect(poller.runOnce()).resolves.toBe(false);
    expect(getUpdates).not.toHaveBeenCalled();
  });

  it('releases its lock on stop', async () => {
    const { poller, store } = make([]);
    await poller.runOnce();
    await poller.stop();
    await expect(store.get('max-assistant:poller')).resolves.toBeNull();
  });
});
