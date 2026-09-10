'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { Web3ProviderInterface } from '@gitroom/frontend/components/launches/web3/web3.provider.interface';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { timer } from '@gitroom/helpers/utils/timer';
import { Input } from '@gitroom/react/form/input';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { isAllowedMoltbookClaimUrl } from './moltbook.connection';

type MoltbookStep = 'init' | 'registering' | 'waiting' | 'timeout' | 'error';

export const MoltbookProvider: FC<Web3ProviderInterface> = ({
  onComplete,
  nonce,
}) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const attempt = useRef(0);
  const apiKey = useRef('');
  const [step, setStep] = useState<MoltbookStep>('init');
  const [agentName, setAgentName] = useState('');
  const [agentDescription, setAgentDescription] = useState('');
  const [claimUrl, setClaimUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(
    () => () => {
      attempt.current += 1;
      apiKey.current = '';
    },
    []
  );

  const pollForClaim = useCallback(async () => {
    const key = apiKey.current;
    if (!key) return;
    const currentAttempt = ++attempt.current;
    const deadline = Date.now() + 120_000;
    setStep('waiting');

    while (Date.now() < deadline && attempt.current === currentAttempt) {
      try {
        const response = await fetch('/integrations/moltbook/status', {
          method: 'POST',
          body: JSON.stringify({ apiKey: key }),
        });
        const data = await response.json();
        if (attempt.current !== currentAttempt) return;
        if (data.claimed === true) {
          onComplete(key, nonce);
          return;
        }
      } catch {
        if (attempt.current !== currentAttempt) return;
      }
      await timer(3000);
    }

    if (attempt.current === currentAttempt) {
      setStep('timeout');
    }
  }, [fetch, nonce, onComplete]);

  const register = useCallback(async () => {
    if (!agentName.trim()) {
      toaster.show(
        t('moltbook_enter_agent_name', 'Enter an agent name.'),
        'warning'
      );
      return;
    }

    attempt.current += 1;
    setStep('registering');
    setError('');
    try {
      const response = await fetch('/integrations/moltbook/register', {
        method: 'POST',
        body: JSON.stringify({
          name: agentName.trim(),
          description:
            agentDescription.trim() || 'Vezdepost social media scheduler',
        }),
      });
      const data = await response.json();
      if (
        !response.ok ||
        typeof data.apiKey !== 'string' ||
        typeof data.claimUrl !== 'string'
      ) {
        throw new Error('registration failed');
      }
      if (!isAllowedMoltbookClaimUrl(data.claimUrl)) {
        apiKey.current = '';
        setError(
          t(
            'moltbook_invalid_claim_url',
            'Moltbook returned an invalid claim link. Try again.'
          )
        );
        setStep('error');
        return;
      }

      apiKey.current = data.apiKey;
      setClaimUrl(data.claimUrl);
      setStep('waiting');
      void pollForClaim();
    } catch {
      apiKey.current = '';
      setError(
        t(
          'moltbook_registration_error',
          'Could not create the Moltbook agent. Try again.'
        )
      );
      setStep('error');
    }
  }, [agentDescription, agentName, fetch, pollForClaim, t, toaster]);

  return (
    <div className="flex flex-col gap-[14px] pt-[16px]">
      {(step === 'init' || step === 'registering' || step === 'error') && (
        <>
          <div className="rounded-[8px] border border-tableBorder p-[12px] text-[14px]">
            <p>
              {t(
                'moltbook_connection_creates_agent',
                'Vezdepost creates a Moltbook agent for scheduled publishing.'
              )}
            </p>
            <p className="mt-[6px] text-textColor/70">
              {t(
                'moltbook_connection_owner_claim',
                'After creation, the human owner must claim it on Moltbook.'
              )}
            </p>
          </div>
          <Input
            label={t('agent_name', 'Agent Name')}
            value={agentName}
            name="agentName"
            disableForm={true}
            onChange={(event) => setAgentName(event.target.value)}
            placeholder="MyVezdepostAgent"
          />
          <Input
            label={t('description_optional', 'Description (optional)')}
            value={agentDescription}
            name="agentDescription"
            disableForm={true}
            onChange={(event) => setAgentDescription(event.target.value)}
            placeholder="Social media scheduler"
          />
          {step === 'error' ? (
            <p className="text-red-500" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            type="button"
            onClick={register}
            disabled={step === 'registering'}
          >
            {step === 'registering'
              ? t('moltbook_registering_agent', 'Creating agent…')
              : t('moltbook_create_agent', 'Create agent')}
          </Button>
        </>
      )}

      {(step === 'waiting' || step === 'timeout') && (
        <>
          <div className="text-[14px]">
            <p>
              {t(
                'moltbook_open_claim_explanation',
                'Open the claim page and follow Moltbook’s ownership instructions.'
              )}
            </p>
            <p className="mt-[6px] text-textColor/70">
              {t(
                'moltbook_keep_page_open',
                'Keep this window open; Vezdepost checks the result automatically.'
              )}
            </p>
          </div>
          <a
            href={claimUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-[8px] bg-accent px-[14px] py-[12px] text-center text-white"
          >
            {t('open_claim_page', 'Open claim page')}
          </a>
          {step === 'waiting' ? (
            <div role="status" className="text-center text-textColor/70">
              {t('waiting_for_claim', 'Waiting for claim confirmation…')}
            </div>
          ) : (
            <div className="rounded-[8px] border border-tableBorder p-[12px]">
              <p>
                {t(
                  'moltbook_claim_timed_out',
                  'We have not received the claim confirmation yet.'
                )}
              </p>
              <Button
                type="button"
                className="mt-[10px]"
                onClick={pollForClaim}
              >
                {t('moltbook_check_again', 'Check again')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
