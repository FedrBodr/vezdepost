'use client';

import React, { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { setCookie } from '@gitroom/frontend/components/layout/layout.context';
import { DESKTOP_COOKIE } from '@gitroom/frontend/components/mobile/mobile.detect';

/** Desktop top bar link into the phone shell; hidden until the route is enabled. */
export const MobileVersionLink: FC<{ enabled?: boolean }> = ({ enabled }) => {
  const t = useT();
  if (!enabled) {
    return null;
  }
  return (
    <a
      href="/m"
      onClick={() => setCookie(DESKTOP_COOKIE, '', -1)}
      className="text-[13px] hover:text-newTextColor"
    >
      {t('mobile_version_link', 'Мобильная версия')}
    </a>
  );
};
