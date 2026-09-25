'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { Web3ProviderInterface } from '@gitroom/frontend/components/launches/web3/web3.provider.interface';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { timer } from '@gitroom/helpers/utils/timer';
import { Button } from '@gitroom/react/form/button';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  buildTelegramStoriesStartLink,
  TelegramStoriesConnectionResponse,
} from './telegram.stories.connection';

const POLLING_INTERVAL_MS = 2_000;
const POLLING_TIMEOUT_MS = 120_000;

type Status = TelegramStoriesConnectionResponse['status'];

const STOPPING: Status[] = [
  'missing_stories_right',
  'connection_disabled',
  'telegram_error',
];

export const TelegramStoriesProvider: FC<Web3ProviderInterface> = ({
  onComplete,
  nonce,
}) => {
  const { telegramBotName } = useVariables();
  const fetch = useFetch();
  const t = useT();
  const attempt = useRef(0);
  const [status, setStatus] = useState<Status>();
  const [isPolling, setIsPolling] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const botName = telegramBotName.replace(/^@/, '');

  useEffect(
    () => () => {
      attempt.current += 1;
    },
    []
  );

  const verify = useCallback(async () => {
    const currentAttempt = ++attempt.current;
    const deadline = Date.now() + POLLING_TIMEOUT_MS;
    setHasStarted(true);
    setIsPolling(true);
    setStatus('waiting_start');

    while (attempt.current === currentAttempt) {
      let data: TelegramStoriesConnectionResponse;
      try {
        data = await (
          await fetch(
            `/integrations/telegram-stories/updates?word=${encodeURIComponent(
              nonce
            )}`
          )
        ).json();
      } catch {
        data = { status: 'telegram_error' };
      }

      if (attempt.current !== currentAttempt) {
        return;
      }
      setStatus(data.status);
      if (data.status === 'ready') {
        setIsPolling(false);
        onComplete(nonce, nonce);
        return;
      }
      if (STOPPING.includes(data.status) || Date.now() >= deadline) {
        setIsPolling(false);
        return;
      }

      await timer(POLLING_INTERVAL_MS);
    }
  }, [fetch, nonce, onComplete]);

  const errorMessage =
    status === 'missing_stories_right'
      ? t(
          'telegram_stories_connection_missing_right',
          'The bot is connected, but "Manage stories" is off. Turn it on and check again.'
        )
      : status === 'connection_disabled'
      ? t(
          'telegram_stories_connection_disabled',
          'The bot is disabled in Telegram Business. Connect it again.'
        )
      : status === 'telegram_error'
      ? t(
          'telegram_stories_connection_telegram_error',
          'Telegram did not respond. Try again.'
        )
      : hasStarted && !isPolling
      ? t(
          'telegram_stories_connection_timed_out',
          'We have not received confirmation yet.'
        )
      : '';

  return (
    <div className="flex w-full flex-col gap-[14px] pt-[8px] text-textColor">
      <div>
        <h2 className="text-[20px] font-[600]">
          {t('telegram_stories_connection_title', 'Telegram Stories')}
        </h2>
        <p className="mt-[6px] text-[13px] leading-[1.5] text-textColor/70">
          {t(
            'telegram_stories_connection_premium_required',
            'Requires Telegram Premium with Telegram Business.'
          )}
        </p>
      </div>

      <ol className="list-decimal space-y-[10px] ps-[18px] text-[13px] leading-[1.5]">
        <li>
          <a
            href={buildTelegramStoriesStartLink(telegramBotName, nonce)}
            target="_blank"
            rel="noreferrer"
            onClick={() => void verify()}
            className="flex min-h-[44px] items-center justify-center rounded-[6px] bg-[#2AABEE] px-[18px] text-center text-[14px] font-[600] text-white"
          >
            {t(
              'telegram_stories_connection_open_bot',
              'Open the bot in Telegram'
            )}
          </a>
          <span className="mt-[6px] block text-textColor/70">
            {t(
              'telegram_stories_connection_press_start',
              'Press Start in the chat with the bot.'
            )}
          </span>
        </li>
        <li className="text-textColor/70">
          {t(
            'telegram_stories_connection_business_steps',
            'In Telegram open Settings → Telegram Business → Chatbots, add @{{bot}} and enable "Manage stories".',
            { bot: botName }
          )}
        </li>
      </ol>

      {status === 'waiting_business' && (
        <p className="rounded-[10px] border border-newTableBorder bg-newBgColorInner p-[12px] text-[13px] text-textColor/70">
          {t(
            'telegram_stories_connection_resend_hint',
            'If the bot was already added, switch "Manage stories" off and on so Telegram resends the connection.'
          )}
        </p>
      )}

      {isPolling && (
        <div
          role="status"
          className="text-center text-[13px] text-textColor/70"
        >
          {t('telegram_stories_connection_waiting', 'Waiting for Telegram…')}
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
          onClick={() => void verify()}
          className="w-full rounded-[6px]"
        >
          {t('telegram_stories_connection_check_again', 'Check again')}
        </Button>
      )}
    </div>
  );
};
