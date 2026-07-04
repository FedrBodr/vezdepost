'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { Web3ProviderInterface } from '@gitroom/frontend/components/launches/web3/web3.provider.interface';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { timer } from '@gitroom/helpers/utils/timer';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { Input } from '@gitroom/react/form/input';
import { Button } from '@gitroom/react/form/button';
import copy from 'copy-to-clipboard';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const MaxProvider: FC<Web3ProviderInterface> = (props) => {
  const { onComplete, nonce } = props;
  const { maxBotName } = useVariables();
  const fetch = useFetch();
  const word = useRef(makeId(4));
  const stop = useRef(false);
  const [step, setStep] = useState(false);
  const toaster = useToaster();
  const t = useT();

  async function* load() {
    let id = '';
    while (true) {
      const data = await (
        await fetch(
          `/integrations/max/updates?word=${word.current}${
            id ? `&id=${id}` : ''
          }`
        )
      ).json();
      if (data.lastChatId) {
        id = data.lastChatId;
      }
      yield data;
    }
  }

  const loadAll = async () => {
    stop.current = false;
    setStep(true);
    const generator = load();
    for await (const data of generator) {
      if (stop.current) {
        return;
      }
      if (data.chatId) {
        onComplete(data.chatId, nonce);
        return;
      }
      await timer(2000);
    }
  };

  const copyText = useCallback(() => {
    copy(`/connect ${word.current}`);
    toaster.show('Copied to clipboard', 'success');
  }, []);

  useEffect(() => {
    return () => {
      stop.current = true;
    };
  }, []);

  return (
    <>
      <div className="justify-center items-center flex flex-col pt-[16px]">
        <div>
          {t('please_add', 'Please add')} <strong>@{maxBotName}</strong>{' '}
          {t(
            'to_your_max_group_channel_and_click_here',
            'to your MAX group / channel and click here:'
          )}
        </div>
        {!step ? (
          <div className="w-full mt-[16px]" onClick={loadAll}>
            <div className="cursor-pointer bg-[#8A2BE2] h-[44px] rounded-[4px] flex justify-center items-center text-white gap-[4px]">
              <div>{t('connect_max', 'Connect MAX')}</div>
            </div>
          </div>
        ) : (
          <div className="w-full text-center" onClick={copyText}>
            {t(
              'please_add_the_following_command_in_your_chat',
              'Please add the following command in your chat:'
            )}
            <div className="mt-[16px] flex">
              <div className="flex-1">
                <Input
                  label=""
                  value={`/connect ${word.current}`}
                  name=""
                  disableForm={true}
                />
              </div>
              <Button>{t('copy', 'Copy')}</Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
