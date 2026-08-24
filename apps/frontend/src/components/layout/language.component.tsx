'use client';

import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  fallbackLng,
  getLanguageDirection,
  languages,
} from '@gitroom/react/translation/i18n.config';
import { persistLanguageCookie } from '@gitroom/react/translation/language.cookie';
import i18next from 'i18next';
import ReactCountryFlag from 'react-country-flag';
import { Text } from '@mantine/core';
import React, { useCallback } from 'react';
import countries from 'i18n-iso-countries';
import countriesEn from 'i18n-iso-countries/langs/en.json';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import clsx from 'clsx';

countries.registerLocale(countriesEn);

const getCountryCodeForFlag = (languageCode: string) => {
  // For multi-region languages, here are some common defaults
  if (languageCode === 'en') return 'GB';
  if (languageCode === 'es') return 'ES';
  if (languageCode === 'ar') return 'SA';
  if (languageCode === 'zh') return 'CN';
  if (languageCode === 'he') return 'IL';
  if (languageCode === 'ja') return 'JP';
  if (languageCode === 'ko') return 'KR';
  if (languageCode === 'vi') return 'VN';

  // Check if language code itself is a valid country code
  try {
    const countryName = countries.getName(languageCode.toUpperCase(), 'en');
    if (countryName) {
      return languageCode.toUpperCase();
    }
  } catch (e) {
    // Not a valid country code, continue to next approach
  }

  // Try to extract region code if language code has a region component (e.g., en-US)
  const parts = languageCode.split('-');
  if (parts.length > 1) {
    const regionCode = parts[1].toUpperCase();
    try {
      const countryName = countries.getName(regionCode, 'en');
      if (countryName) {
        return regionCode;
      }
    } catch (e) {
      // Not a valid country code, continue to next approach
    }
  }

  // For most language codes that match their primary country
  // Examples: fr->FR, it->IT, de->DE, etc.
  return languageCode.toUpperCase();
};

export const ChangeLanguageComponent = () => {
  const currentLanguage = i18next.resolvedLanguage || fallbackLng;
  const availableLanguages = languages;
  const modals = useModals();

  const handleLanguageChange = async (language: string) => {
    persistLanguageCookie(language);
    await i18next.changeLanguage(language);
    document.documentElement.lang = language;
    document.documentElement.dir = getLanguageDirection(language);
    modals.closeCurrent();
  };

  // Function to get language name in its native script
  const getLanguageName = useCallback((code: string) => {
    try {
      // Use browser's Intl API to get language name in native script
      const displayNames = new Intl.DisplayNames([code], {
        type: 'language',
      });
      return displayNames.of(code);
    } catch (error) {
      // Fallback to language code if the API isn't supported or language is not found
      return code;
    }
  }, []);

  return (
    <div className="relative">
      <div data-language-grid className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {availableLanguages.map((language) => {
          const languageName = getLanguageName(language) || language;
          return (
            <button
              type="button"
              data-language={language}
              aria-label={languageName}
              aria-pressed={language === currentLanguage}
              className={clsx(
                'min-h-[88px] flex items-center justify-center flex-col rounded-[8px] bg-newTableHeader hover:bg-newTableBorder p-[12px] cursor-pointer gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-textColor',
                language === currentLanguage
                  ? 'border border-textColor'
                  : 'border border-transparent'
              )}
              key={language}
              onClick={() => void handleLanguageChange(language)}
            >
              <span aria-hidden="true">
                <ReactCountryFlag
                  countryCode={getCountryCodeForFlag(language)}
                  svg
                  style={{ width: '1.5em', height: '1.5em' }}
                />
              </span>
              <Text weight={language === currentLanguage ? 'bold' : 'normal'}>
                {languageName}
              </Text>
            </button>
          );
        })}
      </div>
    </div>
  );
};
export const LanguageComponent = () => {
  const modal = useModals();
  const currentLanguage = i18next.resolvedLanguage || fallbackLng;
  const t = useT();
  const openModal = () => {
    modal.openModal({
      title: t('change_language', 'Change Language'),
      closeButtonAriaLabel: t('close', 'Close'),
      withCloseButton: true,
      size: 'min(600px, calc(100vw - 24px))',
      children: <ChangeLanguageComponent />,
    });
  };
  return (
    <button
      type="button"
      onClick={openModal}
      aria-label={t('change_language', 'Change Language')}
      aria-haspopup="dialog"
      className="rounded-full overflow-hidden h-[44px] w-[44px] relative cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-textColor"
    >
      <span aria-hidden="true">
        <ReactCountryFlag
          countryCode={getCountryCodeForFlag(currentLanguage)}
          svg
          style={{
            width: '22px',
            height: '22px',
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            objectFit: 'cover',
          }}
        />
      </span>
    </button>
  );
};
