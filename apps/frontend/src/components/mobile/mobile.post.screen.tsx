'use client';

import React, { FC } from 'react';
import Link from 'next/link';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';

/** Stage 3 replaces the placeholder with the quick post editor. */
export const MobilePostScreen: FC = () => {
  const t = useT();
  const { data } = useIntegrationList();
  const channels = data || [];

  if (channels.length === 0) {
    return (
      <div className="flex flex-col gap-[16px] pt-[32px] items-start">
        <h1 className="text-[22px] font-[600]">
          {t('mobile_first_run_title', 'Начнём с первого канала')}
        </h1>
        <p className="text-[15px] text-textItemBlur">
          {t(
            'mobile_first_run_hint',
            'Подключите Telegram, VK или другой канал — после этого можно будет постить с телефона.'
          )}
        </p>
        <Link
          href="/m/channels"
          className="h-[48px] px-[20px] inline-flex items-center rounded-[12px] bg-btnPrimary text-btnText text-[15px] font-[600]"
        >
          {t('mobile_first_run_cta', 'Подключить первый канал')}
        </Link>
      </div>
    );
  }

  return (
    <p className="pt-[24px] text-textItemBlur text-[15px]">
      {t('mobile_post_soon', 'Быстрый пост появится в следующем обновлении.')}
    </p>
  );
};
