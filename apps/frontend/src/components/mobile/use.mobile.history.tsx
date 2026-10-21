'use client';

import { useCallback } from 'react';
import useSWRInfinite from 'swr/infinite';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { expandPostsList } from '@gitroom/helpers/utils/posts.list.minify';
import type { QueueItem } from '@gitroom/frontend/components/mobile/use.mobile.queue';

export type HistoryItem = QueueItem & {
  releaseURL?: string | null;
  state?: 'QUEUE' | 'PUBLISHED' | 'ERROR' | 'DRAFT';
};

type HistoryPage = { posts: HistoryItem[]; hasMore: boolean };

const PAGE_SIZE = 20;

/** SWR key for page N of past posts; null stops pagination. */
export const historyKey = (
  page: number,
  previous: { hasMore: boolean } | null
) =>
  previous && !previous.hasMore
    ? null
    : `/posts/list?state=past&limit=${PAGE_SIZE}&page=${page}`;

export const flattenHistory = (pages: HistoryPage[] | undefined) => {
  const list = pages || [];
  return {
    posts: list.flatMap((page) => page.posts),
    hasMore: list.length > 0 && list[list.length - 1].hasMore,
  };
};

/** Sent, failed and overdue posts, newest first, page by page. */
export const useMobileHistory = () => {
  const fetch = useFetch();
  const load = useCallback(
    async (path: string) =>
      expandPostsList(await (await fetch(path)).json()) as HistoryPage,
    [fetch]
  );
  const { data, isLoading, size, setSize, mutate } = useSWRInfinite(
    historyKey,
    load,
    {
      revalidateOnFocus: false,
      revalidateFirstPage: false,
    }
  );
  const loadMore = useCallback(() => setSize(size + 1), [setSize, size]);
  const { posts, hasMore } = flattenHistory(data);
  return { posts, hasMore, isLoading, loadMore, mutate };
};
