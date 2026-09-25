import { describe, expect, it, vi } from 'vitest';
import { KeyValueStore, MemoryKeyValueStore } from './telegram.kv.store';
import { TelegramApiError } from './telegram.rich.api';
import {
  COMPLETED_PROGRESS_TTL_MS,
  publishStorySeries,
  StorySeriesError,
} from './telegram.stories.publisher';

const frames = [
  { index: 0, path: 'https://cdn/a.jpg' },
  { index: 1, path: 'https://cdn/b.jpg' },
  { index: 2, path: 'https://cdn/c.jpg' },
];

const prepare = async (frame: { path: string }) => `prepared:${frame.path}`;

const run = (
  store: KeyValueStore,
  send: (frame: any, prepared: string) => Promise<number>,
  series = frames,
  prepareFrame: (frame: any) => Promise<string> = prepare
) =>
  publishStorySeries({
    postId: 'p',
    frames: series,
    store,
    prepare: prepareFrame,
    send,
  });

describe('publishStorySeries', () => {
  it('publishes prepared frames in order', async () => {
    const send = vi.fn(async (frame, _prepared: string) => 100 + frame.index);

    const result = await run(new MemoryKeyValueStore(), send);

    expect(
      send.mock.calls.map(([frame, prepared]) => [frame.index, prepared])
    ).toEqual([
      [0, 'prepared:https://cdn/a.jpg'],
      [1, 'prepared:https://cdn/b.jpg'],
      [2, 'prepared:https://cdn/c.jpg'],
    ]);
    expect(result.storyIds).toEqual([100, 101, 102]);
  });

  it('stops at the first failure and resumes from it on retry', async () => {
    const store = new MemoryKeyValueStore();
    const failing = vi.fn(async (frame) => {
      if (frame.index === 1) {
        throw new TelegramApiError('Bad Request: wrong file', 'postStory', 400);
      }
      return 100 + frame.index;
    });

    const error = await run(store, failing).catch((e) => e);

    expect(error).toBeInstanceOf(StorySeriesError);
    expect(error.message).toContain('1/3');
    expect(error.results.map((r: any) => r.state)).toEqual([
      'published',
      'failed',
      'pending',
    ]);
    expect(failing).toHaveBeenCalledTimes(2);

    const retry = vi.fn(async (frame) => 200 + frame.index);
    const result = await run(store, retry);

    expect(retry.mock.calls.map(([frame]) => frame.index)).toEqual([1, 2]);
    expect(result.storyIds).toEqual([100, 201, 202]);
  });

  it('never re-sends a frame whose upload outcome is unknown', async () => {
    const store = new MemoryKeyValueStore();
    const timeout = vi.fn(async () => {
      throw new Error('Telegram postStory timed out');
    });

    await expect(run(store, timeout, frames.slice(0, 1))).rejects.toThrow(
      StorySeriesError
    );

    const retry = vi.fn(async () => 5);
    const error = await run(store, retry, frames.slice(0, 1)).catch((e) => e);

    expect(retry).not.toHaveBeenCalled();
    expect(error.results[0].state).toBe('unknown');
  });

  it('treats a failure while preparing media as retryable', async () => {
    const store = new MemoryKeyValueStore();
    const send = vi.fn(async () => 7);

    const error = await run(store, send, frames.slice(0, 1), async () => {
      throw new Error('Remote media headers timed out');
    }).catch((e) => e);

    expect(error.results[0].state).toBe('failed');
    expect(send).not.toHaveBeenCalled();

    await expect(run(store, send, frames.slice(0, 1))).resolves.toMatchObject({
      storyIds: [7],
    });
  });

  it('does not treat a replaced file as already published', async () => {
    const store = new MemoryKeyValueStore();
    await run(store, async () => 1, frames.slice(0, 1));

    const send = vi.fn(async () => 2);
    await run(store, send, [{ index: 0, path: 'https://cdn/new.jpg' }]);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not re-send published files after media are reordered', async () => {
    const store = new MemoryKeyValueStore();
    await run(store, async (frame) => {
      if (frame.index === 2) {
        throw new TelegramApiError('Bad Request', 'postStory', 400);
      }
      return 100 + frame.index;
    }).catch(() => undefined);

    const reordered = [
      { index: 0, path: 'https://cdn/c.jpg' },
      { index: 1, path: 'https://cdn/a.jpg' },
      { index: 2, path: 'https://cdn/b.jpg' },
    ];
    const send = vi.fn(async () => 300);
    const result = await run(store, send, reordered);

    expect(send.mock.calls.map(([frame]) => frame.path)).toEqual([
      'https://cdn/c.jpg',
    ]);
    expect(result.storyIds).toEqual([300, 100, 101]);
  });

  it('keeps the same file twice in a series as two stories', async () => {
    const send = vi.fn(async (frame) => 10 + frame.index);
    const result = await run(new MemoryKeyValueStore(), send, [
      { index: 0, path: 'https://cdn/a.jpg' },
      { index: 1, path: 'https://cdn/a.jpg' },
    ]);

    expect(send).toHaveBeenCalledTimes(2);
    expect(result.storyIds).toEqual([10, 11]);
  });

  it('reports a frame claimed by a concurrent attempt as unknown', async () => {
    const memory = new MemoryKeyValueStore();
    const racing: KeyValueStore = {
      get: (key) => memory.get(key),
      del: (key) => memory.del(key),
      // Another attempt claims the frame between our read and our claim.
      set: async (key, value, ...args) => {
        if (args.includes('NX')) {
          await memory.set(key, JSON.stringify({ state: 'in_flight' }));
          return null;
        }
        return memory.set(key, value, ...args);
      },
    };
    const send = vi.fn(async () => 1);

    const error = await run(racing, send, frames.slice(0, 1)).catch((e) => e);

    expect(send).not.toHaveBeenCalled();
    expect(error.results[0].state).toBe('unknown');
  });

  it('shortens progress after a full success so a repeat publishes again', async () => {
    const memory = new MemoryKeyValueStore();
    const writes: Array<[string, string, Array<string | number>]> = [];
    const store: KeyValueStore = {
      get: (key) => memory.get(key),
      del: (key) => memory.del(key),
      set: (key, value, ...args) => {
        writes.push([key, value, args]);
        return memory.set(key, value, ...args);
      },
    };

    await run(store, async (frame) => 100 + frame.index);

    const finalWrites = writes.slice(-3);
    expect(finalWrites.map(([, value]) => JSON.parse(value).state)).toEqual([
      'done',
      'done',
      'done',
    ]);
    expect(
      finalWrites.every(([, , args]) => args[1] === COMPLETED_PROGRESS_TTL_MS)
    ).toBe(true);
    expect(COMPLETED_PROGRESS_TTL_MS).toBeLessThan(24 * 60 * 60 * 1_000);
  });
});
