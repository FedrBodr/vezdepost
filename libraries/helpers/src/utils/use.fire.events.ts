import { usePlausible } from 'next-plausible';
import { useCallback } from 'react';
import { usePostHog } from 'posthog-js/react';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

export const useFireEvents = () => {
  const plausible = usePlausible();
  const posthog = usePostHog();
  const user = useUser();

  return useCallback(
    (name: string, props?: Record<string, unknown>) => {
      if (user) {
        posthog.identify(user.id, { email: user.email, name: user.name });
      }

      posthog.capture(name, props);
      plausible(name, { props });
    },
    [user]
  );
};
