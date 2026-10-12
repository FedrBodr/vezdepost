'use client';

import React, { useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { AddProviderComponent } from '@gitroom/frontend/components/launches/add.provider.component';

/**
 * Phone variant of useAddProvider: the picker opens full screen in its
 * compact list layout. `isMobile` is deliberately NOT set, since in this
 * codebase it means the React Native WebView (postiz:// deep links).
 */
export const useMobileAddProvider = (update?: () => void) => {
  const modal = useModals();
  const fetch = useFetch();
  return useCallback(async () => {
    const data = await (await fetch('/integrations')).json();
    modal.openModal({
      title: '',
      withCloseButton: true,
      removeLayout: true,
      fullScreen: true,
      children: (
        <div className="h-full bg-newBgColor p-[16px] overflow-y-auto">
          <AddProviderComponent
            invite={false}
            update={update}
            compact
            {...data}
          />
        </div>
      ),
    });
  }, [fetch, modal, update]);
};
