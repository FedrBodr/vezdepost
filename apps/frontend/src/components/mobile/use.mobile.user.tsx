'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export const useMobileUser = () => {
  const fetch = useFetch();
  const load = useCallback(
    async (path: string) => (await fetch(path)).json(),
    [fetch]
  );
  return useSWR('/user/self', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenOffline: false,
    refreshWhenHidden: false,
  });
};
