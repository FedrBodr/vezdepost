'use client';

import React, { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

/** Stage 3 fills this with the upcoming posts list. */
export const MobileQueueScreen: FC = () => {
  const t = useT();
  return (
    <p className="pt-[24px] text-textItemBlur text-[15px]">
      {t(
        'mobile_queue_soon',
        'Очередь постов появится в следующем обновлении.'
      )}
    </p>
  );
};
