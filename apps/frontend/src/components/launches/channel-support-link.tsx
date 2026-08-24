import React, { type ReactNode } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
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
  const t = useT();
  const { requestClicked } = useChannelConnectAnalytics();
  const analyticsPlatform = platform ?? 'unspecified';
  const displayPlatform = platform === 'x' ? 'X' : platform;
  const subject = platform
    ? t('provider_connection_help_email_subject', {
        defaultValue: "Can't connect {{platform}} in Vezdepost",
        platform: displayPlatform,
      })
    : t(
        'request_new_platform_email_subject',
        'Request a new platform in Vezdepost'
      );

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
