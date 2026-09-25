import { describe, expect, it, vi } from 'vitest';
import { MemoryKeyValueStore } from './telegram.kv.store';
import { TelegramApiError } from './telegram.rich.api';
import {
  publishStorySeries,
  StorySeriesError,
} from './telegram.stories.publisher';

const frames = [
  { index: 0, path: 'https://cdn/a.jpg' },
  { index: 1, path: 'https://cdn/b.jpg' },
  { index: 2, path: 'https://cdn/c.jpg' },
];

describe('publishStorySeries', () => {
  it('publishes frames in order', async () => {
    const send = vi.fn(async (frame) => 100 + frame.index);

    const result = await publishStorySeries({
      postId: 'p',
      frames,
      store: new MemoryKeyValueStore(),
      send,
    });

    expect(send.mock.calls.map(([frame]) => frame.index)).toEqual([0, 1, 2]);
    expect(result.storyIds).toEqual([100, 101, 102]);
  });

  it('reports a partial failure and retries only the missing frames', async () => {
    const store = new MemoryKeyValueStore();
    const failing = vi.fn(async (frame) => {
      if (frame.index === 1) {
        throw new TelegramApiError('Bad Request: wrong file', 'postStory', 400);
      }
      return 100 + frame.index;
    });

    const error = await publishStorySeries({
      postId: 'p',
      frames,
      store,
      send: failing,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(StorySeriesError);
    expect(error.message).toContain('2/3');
    expect(error.results.map((r: any) => r.state)).toEqual([
      'published',
      'failed',
      'published',
    ]);

    const retry = vi.fn(async (frame) => 200 + frame.index);
    const result = await publishStorySeries({
      postId: 'p',
      frames,
      store,
      send: retry,
    });

    expect(retry.mock.calls.map(([frame]) => frame.index)).toEqual([1]);
    expect(result.storyIds).toEqual([100, 201, 102]);
  });

  it('never re-sends a frame whose outcome is unknown', async () => {
    const store = new MemoryKeyValueStore();
    const timeout = vi.fn(async (frame) => {
      if (frame.index === 0) {
        throw new Error('Telegram postStory timed out');
      }
      return 1;
    });

    await expect(
      publishStorySeries({
        postId: 'p',
        frames: frames.slice(0, 1),
        store,
        send: timeout,
      })
    ).rejects.toThrow(StorySeriesError);

    const retry = vi.fn(async () => 5);
    const error = await publishStorySeries({
      postId: 'p',
      frames: frames.slice(0, 1),
      store,
      send: retry,
    }).catch((e) => e);

    expect(retry).not.toHaveBeenCalled();
    expect(error.results[0].state).toBe('unknown');
  });

  it('does not treat a replaced file as already published', async () => {
    const store = new MemoryKeyValueStore();
    await publishStorySeries({
      postId: 'p',
      frames: frames.slice(0, 1),
      store,
      send: async () => 1,
    });

    const send = vi.fn(async () => 2);
    await publishStorySeries({
      postId: 'p',
      frames: [{ index: 0, path: 'https://cdn/new.jpg' }],
      store,
      send,
    });

    expect(send).toHaveBeenCalledTimes(1);
  });
});
