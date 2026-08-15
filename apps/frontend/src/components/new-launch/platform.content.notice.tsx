import React from 'react';
import type { PlatformContentMessage } from '@gitroom/helpers/utils/platform.content';

export const PlatformContentNotice = ({
  messages,
  onCustomize,
}: {
  messages: PlatformContentMessage[];
  onCustomize?: (targetIntegrationId: string) => void;
}) => {
  const occurrences = new Map<string, number>();
  const keyedMessages = messages.map((message) => {
    const identity = JSON.stringify([
      message.targetIntegrationId || message.platform || 'current',
      message.severity,
      message.code,
      message.text,
    ]);
    const occurrence = occurrences.get(identity) || 0;
    occurrences.set(identity, occurrence + 1);
    return { key: `${identity}-${occurrence}`, message };
  });

  return (
    <div className="flex flex-col gap-2">
      {keyedMessages.map(({ key, message }) => (
        <div
          key={key}
          role={message.severity === 'error' ? 'alert' : 'status'}
          className={
            message.severity === 'error'
              ? 'rounded-md border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-200'
              : message.severity === 'warning'
              ? 'rounded-md border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200'
              : 'rounded-md border border-blue-400/40 bg-blue-400/10 p-3 text-sm text-blue-200'
          }
        >
          {message.text}
          {message.platform &&
            message.targetIntegrationId &&
            message.severity === 'warning' &&
            onCustomize && (
              <button
                type="button"
                className="ms-2 underline"
                onClick={() => onCustomize(message.targetIntegrationId!)}
              >
                Customize for {message.platform}
              </button>
            )}
        </div>
      ))}
    </div>
  );
};
