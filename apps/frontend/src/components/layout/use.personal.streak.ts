'use client';

import { useCallback, useEffect, useRef } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { getTimezone } from '@gitroom/frontend/components/layout/set.timezone';

export type PersonalStreak = {
  days: number;
  timezone: string;
  lastPublishedLocalDate: string | null;
  nextChangeAt: string | null;
};

const MAXIMUM_TIMEOUT = 2_147_483_647;

export const usePersonalStreak = () => {
  const fetch = useFetch();
  const loadStreak = useCallback(
    async (path: string) => await (await fetch(path)).json(),
    [fetch]
  );
  const response = useSWR<PersonalStreak>('/user/streak', loadStreak, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    refreshInterval: 300_000,
  });

  useEffect(() => {
    if (!response.data?.nextChangeAt) {
      return;
    }

    const boundary = Date.parse(response.data.nextChangeAt);
    if (!Number.isFinite(boundary)) {
      return;
    }

    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const remaining = boundary - Date.now();
      if (remaining <= 0) {
        void response.mutate();
        return;
      }

      timeout = setTimeout(schedule, Math.min(remaining, MAXIMUM_TIMEOUT));
    };

    timeout = setTimeout(schedule, 0);
    return () => clearTimeout(timeout);
  }, [response.data?.nextChangeAt, response.mutate]);

  return response;
};

const isValidIanaTimezone = (timezone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
};

export const useUserTimezoneSync = (
  timezoneName: string | null | undefined,
  mutateUser: () => Promise<unknown>
) => {
  const fetch = useFetch();
  const { mutate } = useSWRConfig();
  const requestedTimezone = useRef<string | null>(null);

  useEffect(() => {
    if (timezoneName === undefined) {
      return;
    }

    const browserTimezone = getTimezone();
    if (
      !browserTimezone ||
      !isValidIanaTimezone(browserTimezone) ||
      browserTimezone === timezoneName
    ) {
      if (browserTimezone === timezoneName) {
        requestedTimezone.current = null;
      }
      return;
    }

    if (requestedTimezone.current === browserTimezone) {
      return;
    }
    requestedTimezone.current = browserTimezone;

    void (async () => {
      try {
        const response = await fetch('/user/timezone', {
          method: 'PUT',
          body: JSON.stringify({ timezoneName: browserTimezone }),
        });
        if (!response.ok) {
          throw new Error('Could not update user timezone');
        }

        await Promise.all([mutateUser(), mutate('/user/streak')]);
      } catch {
        if (requestedTimezone.current === browserTimezone) {
          requestedTimezone.current = null;
        }
      }
    })();
  }, [fetch, mutate, mutateUser, timezoneName]);
};
