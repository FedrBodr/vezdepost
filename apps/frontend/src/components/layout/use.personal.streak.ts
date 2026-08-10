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
const TIMEZONE_RETRY_DELAY = 1_000;
const MAXIMUM_TIMEZONE_RETRY_DELAY = 30_000;
const MAXIMUM_TIMEZONE_ATTEMPTS = 5;

class NonRetryableTimezoneError extends Error {}

export const usePersonalStreak = () => {
  const fetch = useFetch();
  const loadStreak = useCallback(
    async (path: string) => {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Could not load personal streak (${response.status})`);
      }
      return await response.json();
    },
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
  if (timezone.startsWith('+') || timezone.startsWith('-')) {
    return false;
  }

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
  const requestVersion = useRef(0);
  const browserTimezone = getTimezone();

  useEffect(() => {
    const version = ++requestVersion.current;
    if (
      timezoneName === undefined ||
      !browserTimezone ||
      !isValidIanaTimezone(browserTimezone) ||
      browserTimezone === timezoneName
    ) {
      return;
    }

    const controller = new AbortController();
    let stopped = false;
    let attempt = 0;
    let retryTimeout: ReturnType<typeof setTimeout>;

    const scheduleRetry = (error: unknown) => {
      if (
        stopped ||
        version !== requestVersion.current ||
        error instanceof NonRetryableTimezoneError ||
        attempt >= MAXIMUM_TIMEZONE_ATTEMPTS
      ) {
        return;
      }

      const delay = Math.min(
        TIMEZONE_RETRY_DELAY * 2 ** (attempt - 1),
        MAXIMUM_TIMEZONE_RETRY_DELAY
      );
      retryTimeout = setTimeout(syncTimezone, delay);
    };

    const syncTimezone = async () => {
      attempt += 1;
      try {
        const response = await fetch('/user/timezone', {
          method: 'PUT',
          body: JSON.stringify({ timezoneName: browserTimezone }),
          signal: controller.signal,
        });
        if (!response.ok) {
          if (
            response.status >= 400 &&
            response.status < 500 &&
            response.status !== 408 &&
            response.status !== 429
          ) {
            throw new NonRetryableTimezoneError(
              'Could not update user timezone'
            );
          }
          throw new Error('Could not update user timezone');
        }

        if (stopped || version !== requestVersion.current) {
          return;
        }
        await Promise.allSettled([mutateUser(), mutate('/user/streak')]);
      } catch (error) {
        scheduleRetry(error);
      }
    };

    void syncTimezone();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(retryTimeout);
    };
  }, [browserTimezone, fetch, mutate, mutateUser, timezoneName]);
};
