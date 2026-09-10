'use client';

import '@neynar/react/dist/style.css';
import React, { FC, useCallback, useState } from 'react';
import { Web3ProviderInterface } from '@gitroom/frontend/components/launches/web3/web3.provider.interface';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { ButtonCaster } from '@gitroom/frontend/components/auth/providers/farcaster.provider';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const WrapcasterProvider: FC<Web3ProviderInterface> = ({
  nonce,
  onComplete,
}) => {
  const t = useT();
  const [, state] = nonce.split('||');
  const [connecting, setConnecting] = useState(false);

  const auth = useCallback(
    (code: string) => {
      setConnecting(true);
      return onComplete(code, state);
    },
    [onComplete, state]
  );

  return (
    <div className="flex items-center justify-center">
      {connecting ? (
        <div className="-mt-[90px] flex items-center justify-center">
          <LoadingComponent width={100} height={100} />
        </div>
      ) : (
        <div className="flex w-[500px] max-w-full flex-col gap-4 py-5">
          <p className="font-medium">
            {t('farcaster_connection_intro', 'Connect Farcaster in two steps:')}
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              {t(
                'farcaster_connection_select',
                'Select Connect Farcaster below.'
              )}
            </li>
            <li>
              {t(
                'farcaster_connection_approve',
                'Approve the signer in your Farcaster app or QR flow.'
              )}
            </li>
          </ol>
          <p className="rounded-md bg-newBgColorInner p-3 text-sm">
            {t(
              'farcaster_connection_secret_warning',
              'Never enter your password or recovery phrase in Vezdepost.'
            )}
          </p>
          <ButtonCaster login={auth} />
        </div>
      )}
    </div>
  );
};
