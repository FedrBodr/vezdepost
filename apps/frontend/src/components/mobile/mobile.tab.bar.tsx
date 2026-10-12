'use client';

import React, { FC } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const tabs = [
  { key: 'mobile_tab_post', fallback: 'Пост', href: '/m', exact: true },
  {
    key: 'mobile_tab_queue',
    fallback: 'Очередь',
    href: '/m/queue',
    exact: false,
  },
  {
    key: 'mobile_tab_channels',
    fallback: 'Каналы',
    href: '/m/channels',
    exact: false,
  },
];

/** Bottom navigation for the mobile shell. */
export const MobileTabBar: FC = () => {
  const pathname = usePathname();
  const t = useT();
  return (
    <nav
      aria-label="mobile"
      className="fixed bottom-0 inset-x-0 flex border-t border-newBorder bg-newBgColorInner pb-[env(safe-area-inset-bottom)]"
    >
      {tabs.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={clsx(
              'flex-1 flex items-center justify-center h-[56px] text-[14px] font-[600]',
              active ? 'text-newTextColor' : 'text-textItemBlur'
            )}
          >
            {t(tab.key, tab.fallback)}
          </Link>
        );
      })}
    </nav>
  );
};
