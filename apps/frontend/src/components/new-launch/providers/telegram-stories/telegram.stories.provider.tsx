'use client';

import React, { FC, useId } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { TelegramStoriesDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/telegram.stories.dto';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  TELEGRAM_STORY_ACTIVE_PERIODS,
  TELEGRAM_STORY_CAPTION_MAX,
  TELEGRAM_STORY_DEFAULT_ACTIVE_PERIOD,
  TelegramStoryFrameSetting,
} from '@gitroom/helpers/utils/telegram.stories.constants';

const fieldClassName =
  'h-[42px] rounded-[8px] border border-newTableBorder bg-newBgColorInner px-[16px] text-[14px] outline-none';

const periodHours: Record<string, number> = {
  '21600': 6,
  '43200': 12,
  '86400': 24,
  '172800': 48,
};

/** Frames stay keyed by media id, so reordering media keeps each text. */
export const setFrameSetting = (
  frames: TelegramStoryFrameSetting[],
  media: Array<{ id: string }>,
  mediaId: string,
  patch: Partial<TelegramStoryFrameSetting>
): TelegramStoryFrameSetting[] =>
  media.map((item, index) => {
    const current: TelegramStoryFrameSetting = frames.find(
      (frame) => frame.mediaId === item.id
    ) ?? { mediaId: item.id, text: index === 0 ? 'post' : 'none' };
    return item.id === mediaId
      ? { ...current, ...patch, mediaId: item.id }
      : current;
  });

export const TelegramStoriesSettings: FC = () => {
  const t = useT();
  const id = useId();
  const { register, watch, setValue } = useSettings();
  const { value } = useIntegration();
  const media = (value?.[0]?.image || []) as Array<{ id: string }>;
  const frames: TelegramStoryFrameSetting[] = watch('frames') || [];

  const update = (mediaId: string, patch: Partial<TelegramStoryFrameSetting>) =>
    setValue('frames', setFrameSetting(frames, media, mediaId, patch));

  return (
    <div className="flex flex-col gap-[16px] pt-[20px]">
      <div className="flex flex-col gap-[6px]">
        <label htmlFor={`${id}-period`} className="text-[14px]">
          {t('telegram_stories_lifetime', 'Story lifetime')}
        </label>
        <select
          id={`${id}-period`}
          className={fieldClassName}
          {...register('active_period', {
            value: TELEGRAM_STORY_DEFAULT_ACTIVE_PERIOD,
          })}
        >
          {TELEGRAM_STORY_ACTIVE_PERIODS.map((period) => (
            <option key={period} value={period}>
              {t('telegram_stories_hours', '{{hours}} hours', {
                hours: periodHours[period],
              })}
            </option>
          ))}
        </select>
      </div>

      {media.map((item, index) => {
        const number = index + 1;
        const frame: TelegramStoryFrameSetting = frames.find(
          (f) => f.mediaId === item.id
        ) ?? { text: index === 0 ? 'post' : 'none' };
        return (
          <div
            key={item.id}
            className="flex flex-col gap-[8px] rounded-[8px] border border-newTableBorder p-[12px]"
          >
            <div className="text-[14px] font-[500]">
              {t('telegram_stories_frame', 'Story {{number}}', { number })}
            </div>
            <select
              aria-label={t(
                'telegram_stories_frame_text',
                'Text on story {{number}}',
                { number }
              )}
              className={fieldClassName}
              value={frame.text}
              onChange={(e) =>
                update(item.id, {
                  text: e.target.value as TelegramStoryFrameSetting['text'],
                })
              }
            >
              <option value="post">
                {t('telegram_stories_text_post', 'Post text')}
              </option>
              <option value="none">
                {t('telegram_stories_text_none', 'No text')}
              </option>
              <option value="custom">
                {t('telegram_stories_text_custom', 'Custom text')}
              </option>
            </select>
            {frame.text === 'custom' && (
              <textarea
                aria-label={t(
                  'telegram_stories_frame_caption',
                  'Custom text for story {{number}}',
                  { number }
                )}
                className="min-h-[80px] rounded-[8px] border border-newTableBorder bg-newBgColorInner p-[10px] text-[14px] outline-none"
                maxLength={TELEGRAM_STORY_CAPTION_MAX}
                value={frame.caption || ''}
                onChange={(e) => update(item.id, { caption: e.target.value })}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default withProvider({
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: TelegramStoriesSettings,
  CustomPreviewComponent: undefined,
  dto: TelegramStoriesDto,
  maximumCharacters: TELEGRAM_STORY_CAPTION_MAX,
});
