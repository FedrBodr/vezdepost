import React, { type ReactNode } from 'react';
import { useChannelConnectAnalytics } from './channel-connect.analytics';

type ChannelSupportLinkProps = {
  platform?: string;
  source: 'channel_picker' | 'connection_error';
  className?: string;
  children: ReactNode;
};

export const ChannelSupportLink = ({
  platform,
  source,
  className,
  children,
}: ChannelSupportLinkProps) => {
  const { requestClicked } = useChannelConnectAnalytics();
  const analyticsPlatform = platform ?? 'unspecified';
  const subject = platform
    ? `Не подключается ${platform === 'x' ? 'X' : platform} в Вездепосте`
    : 'Нужна новая платформа в Вездепосте';

  return (
    <a
      className={className}
      href={`mailto:fedrbodr@gmail.com?subject=${encodeURIComponent(subject)}`}
      onClick={() => {
        try {
          requestClicked(analyticsPlatform, source);
        } catch {
          // Analytics must never interfere with opening the user's mail client.
        }
      }}
    >
      {children}
    </a>
  );
};
