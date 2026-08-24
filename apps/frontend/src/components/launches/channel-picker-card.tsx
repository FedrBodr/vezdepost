'use client';

import clsx from 'clsx';
import React, { useRef, useState } from 'react';

export type ChannelPickerCardProps = {
  identifier: string;
  name: string;
  toolTip?: string;
  canConnect?: boolean;
  isMobile: boolean;
  requestLabel: string;
  requestedLabel: string;
  onConnect?: () => void;
  onRequest: () => void;
};

export const ChannelPickerCard = ({
  identifier,
  name,
  toolTip,
  canConnect,
  isMobile,
  requestLabel,
  requestedLabel,
  onConnect,
  onRequest,
}: ChannelPickerCardProps) => {
  const unavailable = canConnect === false;
  const [requested, setRequested] = useState(false);
  const requestedRef = useRef(false);

  const request = () => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    try {
      onRequest();
    } catch {
      // Analytics must never block local request feedback.
    } finally {
      setRequested(true);
    }
  };

  return (
    <div
      data-testid={`channel-card-${identifier}`}
      onClick={unavailable ? undefined : onConnect}
      {...(toolTip && !unavailable
        ? {
            'data-tooltip-id': 'tooltip',
            'data-tooltip-content': toolTip,
          }
        : {})}
      className={clsx(
        isMobile
          ? 'flex-row h-[72px] p-[16px]'
          : unavailable
            ? 'flex-col min-h-[110px] p-[10px] justify-center'
            : 'flex-col p-[10px] h-[100px] justify-center',
        unavailable ? 'cursor-default' : 'cursor-pointer',
        'w-full text-[14px] rounded-[8px] bg-newTableHeader text-textColor relative items-center flex gap-[8px]'
      )}
    >
      <div
        data-testid={`channel-card-content-${identifier}`}
        className={clsx(
          'flex items-center gap-[10px]',
          isMobile ? 'flex-row' : 'flex-col',
          unavailable && 'opacity-50'
        )}
      >
        <div>
          {identifier === 'youtube' ? (
            <img src="/icons/platforms/youtube.svg" alt="" />
          ) : (
            <img
              className={clsx(
                'w-[32px] h-[32px]',
                identifier !== 'google_my_business' && 'rounded-full'
              )}
              src={`/icons/platforms/${identifier}.png`}
              alt=""
            />
          )}
        </div>
        <div className={clsx(isMobile ? '' : 'whitespace-pre-wrap', 'text-center')}>
          {name}
        </div>
      </div>

      {toolTip && !isMobile && !unavailable ? (
        <svg
          width="15"
          height="15"
          viewBox="0 0 26 26"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="absolute top-[10px] end-[10px]"
          aria-hidden="true"
        >
          <path
            d="M13 0C10.4288 0 7.91543 0.762437 5.77759 2.1909C3.63975 3.61935 1.97351 5.64968 0.989572 8.02512C0.0056327 10.4006 -0.251811 13.0144 0.249797 15.5362C0.751405 18.0579 1.98953 20.3743 3.80762 22.1924C5.6257 24.0105 7.94208 25.2486 10.4638 25.7502C12.9856 26.2518 15.5995 25.9944 17.9749 25.0104C20.3503 24.0265 22.3807 22.3603 23.8091 20.2224C25.2376 18.0846 26 15.5712 26 13C25.9964 9.5533 24.6256 6.24882 22.1884 3.81163C19.7512 1.37445 16.4467 0.00363977 13 0ZM13 21C12.7033 21 12.4133 20.912 12.1667 20.7472C11.92 20.5824 11.7277 20.3481 11.6142 20.074C11.5007 19.7999 11.471 19.4983 11.5288 19.2074C11.5867 18.9164 11.7296 18.6491 11.9393 18.4393C12.1491 18.2296 12.4164 18.0867 12.7074 18.0288C12.9983 17.9709 13.2999 18.0007 13.574 18.1142C13.8481 18.2277 14.0824 18.42 14.2472 18.6666C14.412 18.9133 14.5 19.2033 14.5 19.5C14.5 19.8978 14.342 20.2794 14.0607 20.5607C13.7794 20.842 13.3978 21 13 21ZM14 14.91V15C14 15.2652 13.8946 15.5196 13.7071 15.7071C13.5196 15.8946 13.2652 16 13 16C12.7348 16 12.4804 15.8946 12.2929 15.7071C12.1054 15.5196 12 15.2652 12 15V14C12 13.7348 12.1054 13.4804 12.2929 13.2929C12.4804 13.1054 12.7348 13 13 13C14.6538 13 16 11.875 16 10.5C16 9.125 14.6538 8 13 8C11.3463 8 10 9.125 10 10.5V11C10 11.2652 9.89465 11.5196 9.70711 11.7071C9.51958 11.8946 9.26522 12 9.00001 12C8.73479 12 8.48044 11.8946 8.2929 11.7071C8.10536 11.5196 8.00001 11.2652 8.00001 11V10.5C8.00001 8.01875 10.2425 6 13 6C15.7575 6 18 8.01875 18 10.5C18 12.6725 16.28 14.4913 14 14.91Z"
            fill="currentColor"
          />
        </svg>
      ) : null}

      {unavailable && !isMobile ? (
        <button
          type="button"
          disabled={requested}
          aria-label={`${requested ? requestedLabel : requestLabel} ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            request();
          }}
          className="max-w-full whitespace-normal break-words rounded-[6px] border border-tableBorder px-[8px] py-[4px] text-[11px] leading-[14px] text-textColor disabled:cursor-default"
        >
          {requested ? requestedLabel : requestLabel}
        </button>
      ) : null}
    </div>
  );
};
