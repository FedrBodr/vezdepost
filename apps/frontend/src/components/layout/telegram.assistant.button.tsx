'use client';

import React, { useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

/** Opens @vezde_post_bot with a one-time link code for this account. */
export const TelegramAssistantButton = () => {
  const fetch = useFetch();
  const t = useT();
  const [loading, setLoading] = useState(false);

  const openBot = useCallback(async () => {
    // Open synchronously so browsers keep the tab after the async request.
    const tab = window.open('', '_blank');
    setLoading(true);
    try {
      const response = await fetch('/telegram-assistant/link', {
        method: 'POST',
      });
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

  return (
    <button
      type="button"
      onClick={() => void openBot()}
      disabled={loading}
      className="flex items-center gap-[6px] rounded-[8px] bg-[#2AABEE] px-[12px] py-[6px] text-[13px] font-[600] text-white hover:opacity-90 disabled:opacity-60"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M21.9 4.3 18.7 19.4c-.2 1.1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.3-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6.2 13.1l-4.8-1.5c-1-.3-1.1-1 .2-1.5L20.5 2.9c.9-.3 1.7.2 1.4 1.4z" />
      </svg>
      {t('telegram_assistant_button', 'Постить из Telegram')}
    </button>
  );
};
