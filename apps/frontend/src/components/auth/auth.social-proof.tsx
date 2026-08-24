'use client';

import { useT } from '@gitroom/react/translation/get.transation.service.client';
import React from 'react';

export const AuthSocialProof = () => {
  const t = useT();
  return (
    <div data-testid="auth-social-proof" className="text-center">
      {t('billing_join_over', 'Join Over')}{' '}
      <span className="text-[42px] text-[#FC69FF]">
        {t('billing_entrepreneurs_count', '20,000+ Entrepreneurs')}
      </span>{' '}
      {t('billing_who_use', 'who use')} <br />
      {t('billing_postiz_grow_social', 'Postiz To Grow Their Social Presence')}
    </div>
  );
};
