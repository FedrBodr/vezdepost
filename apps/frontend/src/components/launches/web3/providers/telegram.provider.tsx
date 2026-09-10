'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import copy from 'copy-to-clipboard';
import { Web3ProviderInterface } from '@gitroom/frontend/components/launches/web3/web3.provider.interface';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { timer } from '@gitroom/helpers/utils/timer';
import { Button } from '@gitroom/react/form/button';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import {
  buildTelegramConnectCommand,
  buildTelegramDeepLink,
  TelegramConnectionResponse,
  TelegramDestination,
} from './telegram.connection';

const POLLING_INTERVAL_MS = 2_000;
const POLLING_TIMEOUT_MS = 90_000;

export const TelegramProvider: FC<Web3ProviderInterface> = ({
  onComplete,
  nonce,
}) => {
  const { telegramBotName } = useVariables();
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const attempt = useRef(0);
  const lastUpdateId = useRef<number | undefined>(undefined);
  const [destination, setDestination] = useState<TelegramDestination>();
  const [candidateChatId, setCandidateChatId] = useState<number>();
  const [status, setStatus] =
    useState<TelegramConnectionResponse['status']>('waiting');
  const [isPolling, setIsPolling] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    return () => {
      attempt.current += 1;
    };
  }, []);

  const selectDestination = (value: TelegramDestination) => {
    attempt.current += 1;
    lastUpdateId.current = undefined;
    setCandidateChatId(undefined);
    setStatus('waiting');
    setIsPolling(false);
    setHasStarted(false);
    setDestination(value);
  };

  const verify = useCallback(
    async (knownChatId?: number) => {
      const currentAttempt = ++attempt.current;
      const deadline = Date.now() + POLLING_TIMEOUT_MS;
      let chatId = knownChatId;
      setHasStarted(true);
      setIsPolling(true);
      setStatus('waiting');

      while (attempt.current === currentAttempt) {
        const query = new URLSearchParams({ word: nonce });
        if (chatId !== undefined) {
          query.set('chatId', String(chatId));
        } else if (lastUpdateId.current !== undefined) {
          query.set('id', String(lastUpdateId.current));
        }

        let data: TelegramConnectionResponse;
        try {
          data = await (
            await fetch(`/integrations/telegram/updates?${query.toString()}`)
          ).json();
        } catch {
          data = { status: 'telegram_error' };
        }

        if (attempt.current !== currentAttempt) {
          return;
        }
        if (data.status === 'ready' && data.chatId !== undefined) {
          setStatus('ready');
          setIsPolling(false);
          onComplete(String(data.chatId), nonce);
          return;
        }
        if (
          data.status === 'bot_not_admin' ||
          data.status === 'missing_post_permission'
        ) {
          setCandidateChatId(data.candidateChatId);
          setStatus(data.status);
          setIsPolling(false);
          return;
        }
        if (data.status === 'telegram_error') {
          setStatus(data.status);
          setIsPolling(false);
          return;
        }
        if (data.lastChatId !== undefined) {
          lastUpdateId.current = data.lastChatId;
        }
        if (Date.now() >= deadline) {
          setIsPolling(false);
          return;
        }

        await timer(POLLING_INTERVAL_MS);
        chatId = undefined;
      }
    },
    [fetch, nonce, onComplete]
  );

  const copyCommand = useCallback(() => {
    copy(buildTelegramConnectCommand(nonce));
    toaster.show(
      t('telegram_connection_copied', 'Command copied'),
      'success'
    );
  }, [nonce, t, toaster]);

  if (!destination) {
    return (
      <div className="flex w-full flex-col gap-[16px] pt-[8px] text-textColor">
        <div>
          <h2 className="text-[20px] font-[600]">
            {t(
              'telegram_connection_choose_type',
              'What do you want to connect?'
            )}
          </h2>
          <p className="mt-[6px] text-[13px] text-textColor/70">
            {t(
              'telegram_connection_choose_type_hint',
              'Choose the option that matches how people use this Telegram chat.'
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => selectDestination('group')}
          className="flex min-h-[72px] items-center gap-[12px] rounded-[12px] border border-newTableBorder bg-newBgColorInner px-[16px] text-start hover:border-textColor/40"
        >
          <span aria-hidden="true" className="text-[24px]">👥</span>
          <span>
            <strong className="block text-[15px]">
              {t('telegram_connection_group', 'Group')}
            </strong>
            <span className="mt-[2px] block text-[12px] text-textColor/60">
              {t(
                'telegram_connection_group_hint',
                'A chat where members communicate'
              )}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => selectDestination('channel')}
          className="flex min-h-[72px] items-center gap-[12px] rounded-[12px] border border-newTableBorder bg-newBgColorInner px-[16px] text-start hover:border-textColor/40"
        >
          <span aria-hidden="true" className="text-[24px]">📣</span>
          <span>
            <strong className="block text-[15px]">
              {t('telegram_connection_channel', 'Channel')}
            </strong>
            <span className="mt-[2px] block text-[12px] text-textColor/60">
              {t(
                'telegram_connection_channel_hint',
                'A publication feed for subscribers'
              )}
            </span>
          </span>
        </button>
      </div>
    );
  }

  const isGroup = destination === 'group';
  const deepLink = buildTelegramDeepLink({
    botName: telegramBotName,
    nonce,
    destination,
  });
  const errorMessage =
    status === 'bot_not_admin'
      ? t(
          'telegram_connection_bot_not_admin',
          'The bot was added but is not an administrator.'
        )
      : status === 'missing_post_permission'
      ? t(
          'telegram_connection_missing_post_permission',
          'The bot cannot publish. Enable its permission to post messages.'
        )
      : status === 'telegram_error'
      ? t(
          'telegram_connection_telegram_error',
          'Telegram did not respond. Try checking again.'
        )
      : hasStarted && !isPolling
      ? t(
          'telegram_connection_timed_out',
          'We have not received confirmation yet.'
        )
      : '';

  return (
    <div className="flex w-full flex-col gap-[14px] pt-[8px] text-textColor">
      <button
        type="button"
        onClick={() => {
          attempt.current += 1;
          setDestination(undefined);
        }}
        className="w-fit text-[12px] text-textColor/70 underline"
      >
        {t('telegram_connection_back', 'Back')}
      </button>
      <div>
        <h2 className="text-[20px] font-[600]">
          {isGroup
            ? t(
                'telegram_connection_choose_group',
                'Open Telegram and choose a group'
              )
            : t(
                'telegram_connection_choose_channel',
                'Open Telegram and choose a channel'
              )}
        </h2>
        <p className="mt-[6px] text-[13px] leading-[1.5] text-textColor/70">
          {isGroup
            ? t(
                'telegram_connection_group_permission',
                'Keep the suggested administrator permission enabled so Vezdepost can publish.'
              )
            : t(
                'telegram_connection_channel_permission',
                'Allow the bot to publish messages in the channel.'
              )}
        </p>
      </div>
      <a
        href={deepLink}
        target="_blank"
        rel="noreferrer"
        onClick={() => void verify()}
        className="flex min-h-[44px] items-center justify-center rounded-[6px] bg-[#2AABEE] px-[18px] text-center text-[14px] font-[600] text-white"
      >
        {isGroup
          ? t(
              'telegram_connection_open_group',
              'Open Telegram and choose a group'
            )
          : t(
              'telegram_connection_open_channel',
              'Open Telegram and choose a channel'
            )}
      </a>

      {!isGroup && (
        <div className="rounded-[12px] border border-newTableBorder bg-newBgColorInner p-[14px]">
          <p className="text-[13px] leading-[1.5] text-textColor/70">
            {t(
              'telegram_connection_confirm_channel',
              'Copy this command and publish it once in the selected channel.'
            )}
          </p>
          <div className="mt-[10px] flex items-center gap-[8px]">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-[6px] bg-primary px-[12px] py-[10px] text-[13px]">
              {buildTelegramConnectCommand(nonce)}
            </code>
            <Button onClick={copyCommand} className="rounded-[6px] px-[14px]">
              {t('telegram_connection_copy_command', 'Copy command')}
            </Button>
          </div>
        </div>
      )}

      {isPolling && (
        <div role="status" className="text-center text-[13px] text-textColor/70">
          {t('telegram_connection_waiting', 'Waiting for Telegram…')}
        </div>
      )}

      {!!errorMessage && (
        <div
          role="alert"
          className="rounded-[10px] border border-orange-400/30 bg-orange-400/10 p-[12px] text-[13px]"
        >
          {errorMessage}
        </div>
      )}

      {!isPolling && !!errorMessage && (
        <Button
          secondary={true}
          onClick={() => void verify(candidateChatId)}
          className="w-full rounded-[6px]"
        >
          {t('telegram_connection_check_again', 'Check again')}
        </Button>
      )}

      <details className="rounded-[10px] border border-newTableBorder px-[14px] py-[10px] text-[13px]">
        <summary className="cursor-pointer font-[500]">
          {t('telegram_connection_manual_help', 'Add the bot manually')}
        </summary>
        <ol className="mt-[10px] list-decimal space-y-[6px] ps-[18px] text-textColor/70">
          <li>
            {t(
              'telegram_connection_manual_add',
              'Add the bot shown below to the selected chat.'
            )}
            <code className="ms-[4px]">@{telegramBotName.replace(/^@/, '')}</code>
          </li>
          <li>
            {isGroup
              ? t(
                  'telegram_connection_manual_group_admin',
                  'Make the bot an administrator.'
                )
              : t(
                  'telegram_connection_manual_channel_admin',
                  'Make the bot an administrator and allow it to post messages.'
                )}
          </li>
          <li>
            {t(
              'telegram_connection_manual_command',
              'Send the command shown below in that chat.'
            )}
            <code className="ms-[4px]">{buildTelegramConnectCommand(nonce)}</code>
          </li>
        </ol>
      </details>
    </div>
  );
};
