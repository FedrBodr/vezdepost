'use client';

import React, { FC, useCallback } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useMobileAddProvider } from '@gitroom/frontend/components/mobile/use.mobile.add.provider';
import { TelegramAssistantButton } from '@gitroom/frontend/components/layout/telegram.assistant.button';
import { MaxAssistantButton } from '@gitroom/frontend/components/layout/max.assistant.button';

type Channel = {
  id: string;
  name: string;
  identifier: string;
  picture: string;
  disabled: boolean;
  refreshNeeded: boolean;
  inBetweenSteps: boolean;
};

const statusOf = (channel: Channel) =>
  channel.refreshNeeded || channel.inBetweenSteps
    ? 'reconnect'
    : channel.disabled
      ? 'disabled'
      : 'active';

export const MobileChannelsScreen: FC = () => {
  const t = useT();
  const { data, mutate, isLoading } = useIntegrationList();
  const refresh = useCallback(() => {
    mutate();
  }, [mutate]);
  const addChannel = useMobileAddProvider(refresh);
  const channels: Channel[] = data || [];

  const statusLabel = {
    active: {
      text: t('mobile_channel_active', 'Активен'),
      className: 'text-green-400',
    },
    reconnect: {
      text: t('mobile_channel_reconnect', 'Нужно переподключить'),
      className: 'text-amber-400',
    },
    disabled: {
      text: t('mobile_channel_disabled', 'Отключён'),
      className: 'text-textItemBlur',
    },
  };

  return (
    <div className="flex flex-col gap-[16px] pt-[16px]">
      <h1 className="text-[22px] font-[600]">
        {t('mobile_channels_title', 'Каналы')}
      </h1>

      {isLoading ? (
        <p className="text-textItemBlur text-[15px]">
          {t('mobile_loading', 'Загружаем…')}
        </p>
      ) : channels.length === 0 ? (
        <p className="text-textItemBlur text-[15px]">
          {t('mobile_channels_empty', 'Пока нет каналов')}
        </p>
      ) : (
        <ul className="flex flex-col gap-[8px]">
          {channels.map((channel) => {
            const status = statusLabel[statusOf(channel)];
            return (
              <li
                key={channel.id}
                className="flex items-center gap-[12px] rounded-[12px] bg-newBgColorInner px-[12px] py-[10px]"
              >
                <img
                  src={channel.picture}
                  alt=""
                  className="w-[40px] h-[40px] rounded-full object-cover bg-newBgLineColor"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-[600] truncate">
                    {channel.name}
                  </div>
                  <div className="text-[12px] text-textItemBlur">
                    {channel.identifier}
                  </div>
                </div>
                <div
                  className={clsx('text-[12px] font-[600]', status.className)}
                >
                  {status.text}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={addChannel}
        className="h-[48px] rounded-[12px] bg-btnPrimary text-btnText text-[15px] font-[600]"
      >
        {t('mobile_add_channel', 'Добавить канал')}
      </button>

      <section className="mt-[16px] flex flex-col gap-[8px] rounded-[12px] bg-newBgColorInner p-[16px]">
        <h2 className="text-[16px] font-[600]">
          {t('mobile_assistant_title', 'Ассистент в мессенджере')}
        </h2>
        <p className="text-[13px] text-textItemBlur">
          {t(
            'mobile_assistant_hint',
            'Отправьте боту фото и текст — он опубликует их в выбранные каналы.'
          )}
        </p>
        <div className="flex flex-wrap gap-[8px]">
          <TelegramAssistantButton />
          <MaxAssistantButton />
        </div>
      </section>
    </div>
  );
};
