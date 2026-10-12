'use client';

import { FC, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useFireEvents } from '@gitroom/helpers/utils/use.fire.events';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useMobileGoal } from '@gitroom/frontend/components/mobile/use.mobile.goal';

/**
 * The OAuth return lands on /m?added=<provider>&msg=... (or just ?msg=<error>).
 * Desktop shows these in launches.component; the phone shell shows them here.
 */
export const MobileQueryNotice: FC = () => {
  const searchParams = useSearchParams();
  const toaster = useToaster();
  const fireEvents = useFireEvents();
  const goal = useMobileGoal();
  const t = useT();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) {
      return;
    }
    const added = searchParams.get('added');
    const msg = searchParams.get('msg');
    if (!added && !msg) {
      return;
    }
    handled.current = true;
    if (added) {
      toaster.show(t('mobile_channel_added', 'Канал подключён'), 'success');
      fireEvents('channel_added');
      goal('mobile_channel_added');
    } else if (msg) {
      toaster.show(msg, 'warning');
    }
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('added');
      url.searchParams.delete('msg');
      url.searchParams.delete('continue');
      window.history.replaceState(null, '', url.toString());
    }
  }, [searchParams, toaster, fireEvents, goal, t]);

  return null;
};
