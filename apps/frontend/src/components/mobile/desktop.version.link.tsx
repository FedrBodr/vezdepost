'use client';

import React, { FC } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { setCookie } from '@gitroom/frontend/components/layout/layout.context';
import { DESKTOP_COOKIE } from '@gitroom/frontend/components/mobile/mobile.detect';

/** Full-page link (not next/link) so the proxy sees the fresh cookie. */
export const DesktopVersionLink: FC<{ className?: string }> = ({
  className,
}) => {
  const t = useT();
  return (
    <a
      href="/launches"
      onClick={() => setCookie(DESKTOP_COOKIE, '1', 365)}
      className={clsx('text-[13px] underline text-textItemBlur', className)}
    >
      {t('mobile_full_version', 'Полная версия')}
    </a>
  );
};
