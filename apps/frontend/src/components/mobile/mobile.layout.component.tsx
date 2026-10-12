'use client';

import React, { FC, ReactNode } from 'react';
import { ContextWrapper } from '@gitroom/frontend/components/layout/user.context';
import { MantineWrapper } from '@gitroom/react/helpers/mantine.wrapper';
import { Toaster } from '@gitroom/react/toaster/toaster';
import { ContinueProvider } from '@gitroom/frontend/components/layout/continue.provider';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';
import { MobileTabBar } from '@gitroom/frontend/components/mobile/mobile.tab.bar';
import { DesktopVersionLink } from '@gitroom/frontend/components/mobile/desktop.version.link';
import { useMobileUser } from '@gitroom/frontend/components/mobile/use.mobile.user';
import { MobileQueryNotice } from '@gitroom/frontend/components/mobile/mobile.query.notice';
import { AuthenticatedAppOpened } from '@gitroom/frontend/components/layout/authenticated.app.opened';
import { useUserTimezoneSync } from '@gitroom/frontend/components/layout/use.personal.streak';

/** Phone shell: top bar, scrolling content, bottom tabs. Desktop stays untouched. */
export const MobileLayoutComponent: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { data: user, mutate } = useMobileUser();
  // Same side effects as the desktop layout: timezone sync drives "В очередь"
  // and date scheduling; the app-opened event feeds product analytics.
  useUserTimezoneSync(user?.timezoneName, mutate);
  if (!user) {
    return null;
  }
  return (
    <ContextWrapper user={user}>
      <AuthenticatedAppOpened />
      <MantineWrapper>
        <Toaster />
        <MobileQueryNotice />
        <ContinueProvider />
        <div className="min-h-screen bg-newBgColor text-newTextColor flex flex-col pt-[env(safe-area-inset-top)]">
          <header className="flex items-center justify-between px-[16px] h-[56px]">
            <div className="scale-50 origin-left -ms-[10px]">
              <Logo />
            </div>
            <DesktopVersionLink />
          </header>
          <main className="flex-1 px-[16px] pb-[80px]">{children}</main>
          <MobileTabBar />
        </div>
      </MantineWrapper>
    </ContextWrapper>
  );
};
