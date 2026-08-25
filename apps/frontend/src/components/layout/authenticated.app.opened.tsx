'use client';

import { FC, useEffect, useRef } from 'react';
import { usePostHog } from 'posthog-js/react';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

export const AuthenticatedAppOpened: FC = () => {
  const user = useUser();
  const posthog = usePostHog();
  const capturedUserId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!user?.id || capturedUserId.current === user.id) {
      return;
    }
    capturedUserId.current = user.id;
    try {
      posthog.identify(user.id, { email: user.email, name: user.name });
      posthog.capture('authenticated_app_opened');
    } catch {
      // Analytics must never interrupt the authenticated application.
    }
  }, [posthog, user?.email, user?.id, user?.name]);

  return null;
};
