'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { Web3ProviderInterface } from '@gitroom/frontend/components/launches/web3/web3.provider.interface';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { timer } from '@gitroom/helpers/utils/timer';
import { Button } from '@gitroom/react/form/button';
import copy from 'copy-to-clipboard';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  buildMaxBotUrl,
  buildMaxConnectCommand,
  MaxConnectionResponse,
} from './max.connection';

type MaxDestination = 'group' | 'channel';

export const MaxProvider: FC<Web3ProviderInterface> = ({
  onComplete,
  nonce,
}) => {
  const { maxBotName } = useVariables();
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const attempt = useRef(0);
  const lastMarker = useRef<number | undefined>(undefined);
  const [destination, setDestination] = useState<MaxDestination>();
  const [candidateChatId, setCandidateChatId] = useState<number>();
  const [status, setStatus] = useState<MaxConnectionResponse['status']>();
  const [isPolling, setIsPolling] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(
    () => () => {
      attempt.current += 1;
    },
    []
  );

  const verify = useCallback(
    async (knownChatId?: number) => {
      const currentAttempt = ++attempt.current;
      const deadline = Date.now() + 90_000;
      setHasStarted(true);
      setIsPolling(true);
      setStatus('waiting');

      while (Date.now() < deadline && attempt.current === currentAttempt) {
        try {
          const params = new URLSearchParams({ word: nonce });
          if (lastMarker.current !== undefined) {
            params.set('id', String(lastMarker.current));
          }
          if (knownChatId !== undefined) {
            params.set('chatId', String(knownChatId));
          }
          const data = (await (
            await fetch(`/integrations/max/updates?${params}`)
          ).json()) as MaxConnectionResponse;

          if (attempt.current !== currentAttempt) return;
          if (data.status === 'ready' && data.chatId !== undefined) {
            setStatus('ready');
            setIsPolling(false);
            onComplete(String(data.chatId), nonce);
            return;
          }
          if (
            data.status === 'bot_not_admin' ||
            data.status === 'missing_permissions'
          ) {
            setCandidateChatId(data.candidateChatId);
            setStatus(data.status);
            setIsPolling(false);
            return;
          }
          if (data.status === 'max_error') {
            setStatus('max_error');
            setIsPolling(false);
            return;
          }
          if (data.lastChatId !== undefined) {
            lastMarker.current = data.lastChatId;
          }
        } catch {
          if (attempt.current !== currentAttempt) return;
          setStatus('max_error');
          setIsPolling(false);
          return;
        }
        await timer(2000);
      }

      if (attempt.current === currentAttempt) {
        setStatus('waiting');
        setIsPolling(false);
      }
    },
    [fetch, nonce, onComplete]
  );

  const copyCommand = useCallback(() => {
    copy(buildMaxConnectCommand(nonce));
    toaster.show(t('max_connection_copied', 'Command copied'), 'success');
  }, [nonce, t, toaster]);

  if (!destination) {
    return (
      <div className="flex flex-col gap-[12px] pt-[16px]">
        <div className="text-center font-semibold">
          {t('max_connection_choose_type', 'What do you want to connect?')}
        </div>
        <button
          type="button"
          onClick={() => setDestination('group')}
          className="rounded-[8px] border border-tableBorder p-[14px] text-start"
        >
          <strong>{t('max_connection_group', 'Group')}</strong>
        </button>
        <button
          type="button"
          onClick={() => setDestination('channel')}
          className="rounded-[8px] border border-tableBorder p-[14px] text-start"
        >
          <strong>{t('max_connection_channel', 'Channel')}</strong>
        </button>
      </div>
    );
  }

  const errorCopy =
    status === 'bot_not_admin'
      ? t(
          'max_connection_bot_not_admin',
          'The bot is not an administrator yet.'
        )
      : status === 'missing_permissions'
      ? t(
          'max_connection_missing_permissions',
          'Enable permission to read all messages and write messages.'
        )
      : status === 'max_error'
      ? t('max_connection_error', 'MAX did not respond. Try checking again.')
      : hasStarted && !isPolling && status === 'waiting'
      ? t(
          'max_connection_timed_out',
          'We have not received confirmation from MAX yet.'
        )
      : undefined;

  return (
    <div className="flex flex-col gap-[14px] pt-[12px] text-[14px]">
      <button
        type="button"
        onClick={() => {
          attempt.current += 1;
          setDestination(undefined);
          setIsPolling(false);
          setHasStarted(false);
          setStatus(undefined);
          setCandidateChatId(undefined);
        }}
        className="self-start text-textColor/70"
      >
        ← {t('max_connection_back', 'Back')}
      </button>

      <ol className="list-decimal space-y-[10px] ps-[20px]">
        <li>
          <a
            href={buildMaxBotUrl(maxBotName)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {t('max_connection_open_bot', 'Open the Vezdepost bot')}
          </a>{' '}
          (@{maxBotName.replace(/^@/, '')}).
        </li>
        <li>
          {destination === 'group'
            ? t(
                'max_connection_add_group',
                'Add the bot to the group and make it an administrator.'
              )
            : t(
                'max_connection_add_channel',
                'Add the bot to the channel and make it an administrator.'
              )}
        </li>
        <li>
          {t(
            'max_connection_admin_permissions',
            'Enable permission to read all messages and write messages.'
          )}
        </li>
        <li>
          {t(
            'max_connection_send_command',
            'Publish this command in the selected group or channel:'
          )}
        </li>
      </ol>

      <div className="flex items-center gap-[8px] rounded-[8px] border border-tableBorder p-[10px]">
        <code className="min-w-0 flex-1 break-all">
          {buildMaxConnectCommand(nonce)}
        </code>
        <Button type="button" onClick={copyCommand}>
          {t('max_connection_copy_command', 'Copy command')}
        </Button>
      </div>

      {!hasStarted ? (
        <Button type="button" onClick={() => verify()}>
          {t('max_connection_check', 'I added the bot — check connection')}
        </Button>
      ) : null}

      {isPolling ? (
        <div role="status" className="text-center text-textColor/70">
          {t('max_connection_waiting', 'Waiting for MAX…')}
        </div>
      ) : null}

      {errorCopy ? (
        <div className="rounded-[8px] border border-tableBorder p-[12px]">
          <p>{errorCopy}</p>
          <Button
            type="button"
            className="mt-[10px]"
            onClick={() => verify(candidateChatId)}
          >
            {t('max_connection_check_again', 'Check again')}
          </Button>
        </div>
      ) : null}
    </div>
  );
};
