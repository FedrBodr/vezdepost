import React, { FC } from 'react';
import { GeneralPreviewComponent } from '../../../launches/general.preview.component';
import { useIntegration } from '../../../launches/helpers/use.integration';
import { analyzePlatformContent } from '@gitroom/helpers/utils/platform.content';
import { getPlatformCapabilities } from '@gitroom/helpers/utils/platform.capabilities';
import { PlatformContentNotice } from '@gitroom/frontend/components/new-launch/platform.content.notice';

type TelegramPreviewPost = {
  content: string;
  image?: Array<{ path: string }>;
};

const telegramCapabilities = getPlatformCapabilities('telegram');

const getTelegramSplitMessages = (posts: TelegramPreviewPost[]) => {
  const message = posts
    .flatMap(
      (post) =>
        analyzePlatformContent({
          content: post.content,
          media: (post.image || []).map(() => ({ type: 'image' as const })),
          capabilities: telegramCapabilities,
        }).messages
    )
    .find((item) => item.code === 'media-text-split');

  return message ? [message] : [];
};

export const shouldShowTelegramSplitWarning = (
  posts: TelegramPreviewPost[]
): boolean => getTelegramSplitMessages(posts).length > 0;

export const TelegramPreview: FC<{ maximumCharacters?: number }> = (props) => {
  const { value } = useIntegration();
  const messages = getTelegramSplitMessages(value);

  return (
    <>
      <GeneralPreviewComponent {...props} />
      {!!messages.length && (
        <div className="mx-[15px] mb-[15px]">
          <PlatformContentNotice messages={messages} />
        </div>
      )}
    </>
  );
};
