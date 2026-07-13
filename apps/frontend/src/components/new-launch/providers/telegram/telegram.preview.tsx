import { FC } from 'react';
import { GeneralPreviewComponent } from '../../../launches/general.preview.component';
import { useIntegration } from '../../../launches/helpers/use.integration';
import { shouldSendTelegramTextSeparately } from '../../../../../../../libraries/helpers/src/utils/telegram.constraints';
import { stripHtmlValidation } from '../../../../../../../libraries/helpers/src/utils/strip.html.validation';

type TelegramPreviewPost = {
  content: string;
  image?: Array<{ path: string }>;
};

export const shouldShowTelegramSplitWarning = (
  posts: TelegramPreviewPost[]
): boolean =>
  posts.some((post) =>
    shouldSendTelegramTextSeparately(
      stripHtmlValidation('normal', post.content, true).length,
      post.image?.length ?? 0
    )
  );

export const TelegramPreview: FC<{ maximumCharacters?: number }> = (props) => {
  const { value } = useIntegration();
  const showWarning = shouldShowTelegramSplitWarning(value);

  return (
    <>
      <GeneralPreviewComponent {...props} />
      {showWarning && (
        <div className="mx-[15px] mb-[15px] rounded-md border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200">
          Telegram ограничивает подпись к медиа 1024 символами. Медиа и текст
          будут опубликованы двумя отдельными сообщениями.
        </div>
      )}
    </>
  );
};
