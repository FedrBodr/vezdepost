'use client';

import React, { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

/** Replaced in Task 3 with the channels list. */
export const MobileChannelsScreen: FC = () => {
  const t = useT();
  return (
    <h1 className="pt-[16px] text-[22px] font-[600]">
      {t('mobile_channels_title', 'Каналы')}
    </h1>
  );
};
