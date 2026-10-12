'use client';

import { useCallback } from 'react';
import { useFireEvents } from '@gitroom/helpers/utils/use.fire.events';

export type MobileGoal = 'mobile_channel_added' | 'mobile_quick_post_sent';

/** Product goals: PostHog/Plausible via useFireEvents plus a GTM dataLayer event. */
export const useMobileGoal = () => {
  const fireEvents = useFireEvents();
  return useCallback(
    (goal: MobileGoal) => {
      fireEvents(goal);
      if (typeof window !== 'undefined') {
        const w = window as unknown as { dataLayer?: unknown[] };
        w.dataLayer = w.dataLayer || [];
        w.dataLayer.push({ event: goal });
      }
    },
    [fireEvents]
  );
};
