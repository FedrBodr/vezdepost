import React, { FC } from 'react';
import { GeneralPreviewComponent } from '../../../launches/general.preview.component';
import { useIntegration } from '../../../launches/helpers/use.integration';
import { analyzePlatformContentV2 } from '@gitroom/helpers/utils/platform.content.analysis';
import { resolvePlatformCapabilityV2 } from '@gitroom/helpers/utils/platform.capability.resolver';
import { PlatformContentNotice } from '@gitroom/frontend/components/new-launch/platform.content.notice';

type TelegramPreviewPost = {
  content: string;
  image?: Array<{ path: string }>;
};

const getTelegramSplitMessages = (posts: TelegramPreviewPost[]) => {
  const message = posts
    .flatMap((post) => {
      const media = (post.image || []).map(() => ({ type: 'image' as const }));
      const capability = resolvePlatformCapabilityV2({
        identifier: 'telegram',
        settings: {},
        media,
      });
      return analyzePlatformContentV2({
        canonicalHtml: post.content,
        settings: {},
        media,
        capability,
      }).diagnostics;
    })
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
          <PlatformContentNotice diagnostics={messages} />
        </div>
      )}
    </>
  );
};
