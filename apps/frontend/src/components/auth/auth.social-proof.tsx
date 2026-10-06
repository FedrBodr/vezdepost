'use client';

import { useT } from '@gitroom/react/translation/get.transation.service.client';
import i18next from '@gitroom/react/translation/i18next';
import { fallbackLng } from '@gitroom/react/translation/i18n.config';
import React, { useSyncExternalStore } from 'react';

interface AuthSocialProofTranslations {
  joinOver: string;
  entrepreneursCount: string;
  whoUse: string;
  postizGrowSocial: string;
}

interface AuthSocialProofProps {
  initialLanguage?: string;
  initialTranslations?: AuthSocialProofTranslations;
}

const subscribeToLanguage = (onLanguageChange: () => void) => {
  i18next.on('languageChanged', onLanguageChange);
  return () => i18next.off('languageChanged', onLanguageChange);
};

export const AuthSocialProof = ({
  initialLanguage,
  initialTranslations,
}: AuthSocialProofProps = {}) => {
  const t = useT();
  const language = useSyncExternalStore(
    subscribeToLanguage,
    () => i18next.resolvedLanguage || initialLanguage || fallbackLng,
    () => initialLanguage || fallbackLng
  );
  const useInitialTranslations =
    initialTranslations && language === initialLanguage;

  return (
    <div data-testid="auth-social-proof" className="text-center">
      {useInitialTranslations
        ? initialTranslations.joinOver
        : t('billing_join_over', 'One post on')}{' '}
      <span className="text-[42px] text-[#FC69FF]">
        {useInitialTranslations
          ? initialTranslations.entrepreneursCount
          : t('billing_entrepreneurs_count', '30+ platforms')}
      </span>{' '}
      {useInitialTranslations
        ? initialTranslations.whoUse
        : t('billing_who_use', 'with')}{' '}
      <br />
      {useInitialTranslations
        ? initialTranslations.postizGrowSocial
        : t(
            'billing_postiz_grow_social',
            'Vezdepost, an open-source post scheduler'
          )}
    </div>
  );
};
