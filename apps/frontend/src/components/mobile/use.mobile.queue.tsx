'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { expandPostsList } from '@gitroom/helpers/utils/posts.list.minify';

export type QueueItem = {
  id: string;
  group: string;
  content: string;
  publishDate: string;
  integration: {
    id: string;
    name: string;
    picture: string;
    providerIdentifier: string;
  };
};

export const useMobileQueue = () => {
  const fetch = useFetch();
  const load = useCallback(
    async (path: string) =>
      expandPostsList(await (await fetch(path)).json()) as {
        posts: QueueItem[];
      },
    [fetch]
  );
  return useSWR('/posts/list?state=scheduled&limit=50&page=0', load, {
    revalidateOnFocus: true,
    revalidateOnReconnect: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};
