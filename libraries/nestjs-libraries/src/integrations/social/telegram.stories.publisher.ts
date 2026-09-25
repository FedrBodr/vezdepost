import { createHash } from 'crypto';
import type { KeyValueStore } from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import { TelegramApiError } from '@gitroom/nestjs-libraries/integrations/social/telegram.rich.api';

const PROGRESS_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
// Transport failures after the upload started: Telegram may have published it.
const AMBIGUOUS_ERROR = /timed out|ECONNRESET|socket hang up/i;

export type StoryFrame = { index: number; path: string };
export type FrameResult = {
  index: number;
  state: 'published' | 'skipped' | 'failed' | 'unknown';
  storyId?: number;
  error?: string;
};

type Progress = { state: 'in_flight' } | { state: 'done'; storyId: number };

export const formatStorySeriesError = (results: FrameResult[]) => {
  const done = results.filter(
    (r) => r.state === 'published' || r.state === 'skipped'
  );
  const lines = results
    .filter((r) => r.state === 'failed' || r.state === 'unknown')
    .map((r) =>
      r.state === 'unknown'
        ? `Story ${
            r.index + 1
          }: result unknown, check your Telegram stories before retrying`
        : `Story ${r.index + 1}: ${r.error}`
    );
  return [`Published ${done.length}/${results.length} stories.`, ...lines].join(
    '\n'
  );
};

export class StorySeriesError extends Error {
  constructor(public readonly results: FrameResult[]) {
    super(formatStorySeriesError(results));
    this.name = 'StorySeriesError';
  }
}

// The media path hash keeps progress from a replaced file from counting.
const progressKey = (postId: string, frame: StoryFrame) =>
  `telegram-stories:progress:${postId}:${frame.index}:${createHash('sha1')
    .update(frame.path)
    .digest('hex')}`;

const isAmbiguous = (error: unknown) =>
  !(error instanceof TelegramApiError) &&
  error instanceof Error &&
  AMBIGUOUS_ERROR.test(error.message);

/**
 * Sends frames sequentially, remembering each one so a retry publishes only
 * what did not go out. A frame whose outcome is unknown is never re-sent.
 */
export const publishStorySeries = async ({
  postId,
  frames,
  store,
  send,
}: {
  postId: string;
  frames: StoryFrame[];
  store: KeyValueStore;
  send: (frame: StoryFrame) => Promise<number>;
}) => {
  const results: FrameResult[] = [];
  for (const frame of frames) {
    const key = progressKey(postId, frame);
    const raw = await store.get(key);
    const progress: Progress | null = raw ? JSON.parse(raw) : null;
    if (progress?.state === 'done') {
      results.push({
        index: frame.index,
        state: 'skipped',
        storyId: progress.storyId,
      });
      continue;
    }
    if (progress?.state === 'in_flight') {
      results.push({ index: frame.index, state: 'unknown' });
      continue;
    }

    await store.set(
      key,
      JSON.stringify({ state: 'in_flight' }),
      'PX',
      PROGRESS_TTL_MS
    );
    try {
      const storyId = await send(frame);
      await store.set(
        key,
        JSON.stringify({ state: 'done', storyId }),
        'PX',
        PROGRESS_TTL_MS
      );
      results.push({ index: frame.index, state: 'published', storyId });
    } catch (error) {
      if (isAmbiguous(error)) {
        results.push({ index: frame.index, state: 'unknown' });
        continue;
      }
      await store.del(key);
      results.push({
        index: frame.index,
        state: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (results.some((r) => r.state === 'failed' || r.state === 'unknown')) {
    throw new StorySeriesError(results);
  }
  return { storyIds: results.map((r) => r.storyId as number), results };
};
