'use client';

import React, { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

/** Replaced in Task 4 with the first-run state and editor placeholder. */
export const MobilePostScreen: FC = () => {
  const t = useT();
  return (
    <p className="pt-[24px] text-textItemBlur text-[15px]">
      {t('mobile_post_soon', 'Быстрый пост появится в следующем обновлении.')}
    </p>
  );
};
