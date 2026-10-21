'use client';

import React, { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { TelegramAssistantButton } from '@gitroom/frontend/components/layout/telegram.assistant.button';
import { MaxAssistantButton } from '@gitroom/frontend/components/layout/max.assistant.button';

// Step-by-step guides on the blog; Telegram and MAX are the quickest first channels
export const onboardingGuides = [
  {
    key: 'telegram',
    label: 'Telegram',
    url: 'https://vezdepost.ru/blog/otlozhennyj-post-v-telegram/',
  },
  {
    key: 'max',
    label: 'MAX',
    url: 'https://vezdepost.ru/blog/otlozhennyj-post-v-max/',
  },
  {
    key: 'vk',
    label: 'VK',
    url: 'https://vezdepost.ru/blog/otlozhennye-posty-vk/',
  },
] as const;

const GuideLinks: FC = () => (
  <>
    {onboardingGuides.map((guide, index) => (
      <React.Fragment key={guide.key}>
        {index > 0 && ', '}
        <a
          href={guide.url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-textColor"
        >
          {guide.label}
        </a>
      </React.Fragment>
    ))}
  </>
);

export const OnboardingChannelHint: FC = () => {
  const t = useT();

  return (
    <div className="bg-newTableHeader rounded-[8px] p-[12px] text-[14px] text-customColor18 text-center">
      {t(
        'onboarding_start_hint',
        'Easiest to start with Telegram or MAX: it takes about 2 minutes.'
      )}{' '}
      {t('onboarding_guides', 'Step-by-step guides:')} <GuideLinks />
    </div>
  );
};

export const NoChannelsGuides: FC = () => {
  const t = useT();

  return (
    <div className="text-[13px] text-customColor18">
      {t('onboarding_how_to_connect', 'How to connect a channel:')}{' '}
      <GuideLinks />
    </div>
  );
};

export const OnboardingDoneStep: FC<{
  onBack: () => void;
  onFinish: () => void;
}> = ({ onBack, onFinish }) => {
  const t = useT();

  return (
    <div className="flex flex-col gap-[24px] flex-1">
      <div className="flex gap-[4px] flex-col text-center">
        <div className="text-[24px] font-semibold">
          {t('onboarding_done_title', 'Almost done')}
        </div>
        <div className="text-[14px] text-customColor18">
          {t(
            'onboarding_done_description',
            'Create a post in the calendar: pick a day, write the text and choose the channels. It will be published at the set time.'
          )}
        </div>
      </div>

      <div className="flex flex-col gap-[16px] items-center w-full max-w-[640px] mx-auto">
        <div className="bg-newTableHeader rounded-[8px] p-[16px] text-[14px] text-center w-full flex flex-col gap-[12px] items-center">
          <div>
            {t(
              'onboarding_assistant_hint',
              'You can also post straight from a messenger: send the text to our bot and it becomes a post.'
            )}
          </div>
          <div className="flex gap-[12px] flex-wrap justify-center">
            <TelegramAssistantButton />
            <MaxAssistantButton />
          </div>
        </div>
        <div className="text-[14px] text-customColor18 text-center">
          {t(
            'onboarding_help_hint',
            'Something not working? Write to us, we will help:'
          )}{' '}
          <a
            href="https://t.me/FedrBodr"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-textColor"
          >
            Telegram
          </a>
        </div>
      </div>

      <div className="flex justify-between pt-[24px] mt-auto">
        <button
          onClick={onBack}
          className="group flex items-center gap-[8px] bg-transparent border-2 border-boxFocused font-medium px-[24px] py-[12px] rounded-[12px] text-[15px] transition-all"
        >
          {t('back', 'Back')}
        </button>
        <button
          onClick={onFinish}
          className="group flex items-center gap-[12px] bg-gradient-to-r from-[#10b981] to-[#059669] hover:from-[#34d399] hover:to-[#10b981] text-white font-semibold px-[32px] py-[14px] rounded-[12px] text-[16px] transition-all shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40"
        >
          {t('get_started', 'Get Started')}
        </button>
      </div>
    </div>
  );
};
