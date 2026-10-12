'use client';

import React, { useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

/** Opens the MAX assistant bot with a one-time link code for this account. */
export const MaxAssistantButton = () => {
  const fetch = useFetch();
  const t = useT();
  const { maxAssistantEnabled } = useVariables();
  const [loading, setLoading] = useState(false);

  const openBot = useCallback(async () => {
    // Open synchronously so browsers keep the tab after the async request.
    const tab = window.open('', '_blank');
    setLoading(true);
    try {
      const response = await fetch('/assistant/link/max', { method: 'POST' });
      const { url } = response.ok ? await response.json() : { url: undefined };
      if (!url) {
        tab?.close();
        return;
      }
      if (tab) {
        tab.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch {
      tab?.close();
    } finally {
      setLoading(false);
    }
  }, [fetch]);

  if (!maxAssistantEnabled) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => void openBot()}
      disabled={loading}
      className="flex items-center gap-[6px] rounded-[8px] bg-[#1B6CF2] px-[12px] py-[6px] text-[13px] font-[600] text-white hover:opacity-90 disabled:opacity-60"
    >
      <span aria-hidden="true" className="font-[700]">
        M
      </span>
      {t('max_assistant_button', 'Постить из MAX')}
    </button>
  );
};
