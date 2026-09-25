import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export const TELEGRAM_STORIES_PROVIDER = 'telegram-stories';

export const isStoriesProviderVisible = (
  identifier: string,
  available: boolean | undefined
) => identifier !== TELEGRAM_STORIES_PROVIDER || available === true;

export const useTelegramStoriesAvailability = () => {
  const fetch = useFetch();
  return useSWR<{ available: boolean }>(
    'telegram-stories-availability',
    async () =>
      (await fetch('/integrations/telegram-stories/availability')).json()
  );
};
