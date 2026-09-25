import { createHash } from 'crypto';
import type { KeyValueStore } from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import { TelegramApiError } from '@gitroom/nestjs-libraries/integrations/social/telegram.rich.api';

// Long enough for Temporal retries of one publication run.
const RUN_PROGRESS_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
// After a full success progress only has to survive the workflow re-running
// postSocial (minutes); a repeat post (>= 1 day later) must publish again.
export const COMPLETED_PROGRESS_TTL_MS = 60 * 60 * 1_000;
// Transport failures after the upload started: Telegram may have published it.
const AMBIGUOUS_ERROR = /timed out|ECONNRESET|socket hang up/i;

export type StoryFrame = { index: number; path: string };
export type FrameResult = {
  index: number;
  state: 'published' | 'skipped' | 'failed' | 'unknown' | 'pending';
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
  const pending = results.filter((r) => r.state === 'pending').length;
  return [
    `Published ${done.length}/${results.length} stories.`,
    ...lines,
    ...(pending ? [`${pending} stories were not attempted.`] : []),
  ].join('\n');
};

export class StorySeriesError extends Error {
  constructor(public readonly results: FrameResult[]) {
    super(formatStorySeriesError(results));
    this.name = 'StorySeriesError';
  }
}

/**
 * Progress is keyed by file (plus its occurrence), not by position, so
 * reordering media never re-sends a published story and a replaced file
 * never counts as published.
 */
const progressKeys = (postId: string, frames: StoryFrame[]) => {
  const seen = new Map<string, number>();
  return frames.map((frame) => {
    const hash = createHash('sha1').update(frame.path).digest('hex');
    const occurrence = seen.get(hash) ?? 0;
    seen.set(hash, occurrence + 1);
    return `telegram-stories:progress:${postId}:${hash}:${occurrence}`;
  });
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const isAmbiguous = (error: unknown) =>
  !(error instanceof TelegramApiError) &&
  error instanceof Error &&
  AMBIGUOUS_ERROR.test(error.message);

/**
 * Publishes frames in media order. Each frame is prepared before it is
 * claimed, so download or transcoding failures stay retryable. The series
 * stops at the first frame that did not go out to keep story order; a frame
 * whose upload outcome is unknown is never re-sent.
 */
export const publishStorySeries = async <P>({
  postId,
  frames,
  store,
  prepare,
  send,
}: {
  postId: string;
  frames: StoryFrame[];
  store: KeyValueStore;
  prepare: (frame: StoryFrame) => Promise<P>;
  send: (frame: StoryFrame, prepared: P) => Promise<number>;
}) => {
  const keys = progressKeys(postId, frames);
  const results: FrameResult[] = [];
  let stopped = false;

  for (const [position, frame] of frames.entries()) {
    if (stopped) {
      results.push({ index: frame.index, state: 'pending' });
      continue;
    }
    const key = keys[position];
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
      stopped = true;
      continue;
    }

    let prepared: P;
    try {
      prepared = await prepare(frame);
    } catch (error) {
      results.push({
        index: frame.index,
        state: 'failed',
        error: errorMessage(error),
      });
      stopped = true;
      continue;
    }

    const claimed = await store.set(
      key,
      JSON.stringify({ state: 'in_flight' }),
      'PX',
      RUN_PROGRESS_TTL_MS,
      'NX'
    );
    if (claimed !== 'OK') {
      // A concurrent attempt is sending this frame.
      results.push({ index: frame.index, state: 'unknown' });
      stopped = true;
      continue;
    }

    try {
      const storyId = await send(frame, prepared);
      await store.set(
        key,
        JSON.stringify({ state: 'done', storyId }),
        'PX',
        RUN_PROGRESS_TTL_MS
      );
      results.push({ index: frame.index, state: 'published', storyId });
    } catch (error) {
      stopped = true;
      if (isAmbiguous(error)) {
        results.push({ index: frame.index, state: 'unknown' });
        continue;
      }
      await store.del(key);
      results.push({
        index: frame.index,
        state: 'failed',
        error: errorMessage(error),
      });
    }
  }

  if (stopped) {
    throw new StorySeriesError(results);
  }

  for (const [position, result] of results.entries()) {
    await store.set(
      keys[position],
      JSON.stringify({ state: 'done', storyId: result.storyId }),
      'PX',
      COMPLETED_PROGRESS_TTL_MS
    );
  }
  return { storyIds: results.map((r) => r.storyId as number), results };
};
