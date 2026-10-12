'use client';

import React, { FC, useCallback } from 'react';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import {
  QueueItem,
  useMobileQueue,
} from '@gitroom/frontend/components/mobile/use.mobile.queue';

const stripHtml = (html: string) =>
  html
    .replace(/<\/p>\s*<p>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

const excerpt = (html: string) => {
  const text = stripHtml(html);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
};

export const MobileQueueScreen: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const { data, isLoading, mutate } = useMobileQueue();
  const posts: QueueItem[] = data?.posts || [];

  const open = useCallback((post: QueueItem) => {
    window.open(`/p/${post.id}?share=true`, '_blank');
  }, []);

  const remove = useCallback(
    async (post: QueueItem) => {
      const yes = await deleteDialog(
        t('mobile_queue_delete_confirm', 'Удалить этот пост из очереди?'),
        t('mobile_queue_delete_yes', 'Удалить')
      );
      if (!yes) {
        return;
      }
      await fetch(`/posts/${post.group}`, { method: 'DELETE' });
      mutate();
    },
    [fetch, mutate, t]
  );

  return (
    <div className="flex flex-col gap-[16px] pt-[16px]">
      <h1 className="text-[22px] font-[600]">
        {t('mobile_queue_title', 'Очередь')}
      </h1>
      {!isLoading && posts.length === 0 ? (
        <p className="text-textItemBlur text-[15px]">
          {t('mobile_queue_empty', 'В очереди пока пусто')}
        </p>
      ) : (
        <ul className="flex flex-col gap-[8px]">
          {posts.map((post) => (
            <li
              key={post.id}
              className="flex flex-col gap-[8px] rounded-[12px] bg-newBgColorInner p-[12px]"
            >
              <div className="flex items-center gap-[10px]">
                <img
                  src={post.integration.picture}
                  alt=""
                  className="w-[32px] h-[32px] rounded-full object-cover"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-[600] truncate">
                    {post.integration.name}
                  </div>
                  <div className="text-[12px] text-textItemBlur">
                    {dayjs(post.publishDate).format('DD.MM HH:mm')}
                  </div>
                </div>
              </div>
              <div className="text-[14px]">{excerpt(post.content)}</div>
              <div className="flex gap-[8px]">
                <button
                  type="button"
                  onClick={() => open(post)}
                  className="flex-1 h-[36px] rounded-[10px] bg-btnSimple text-btnText text-[13px] font-[600]"
                >
                  {t('mobile_queue_open', 'Открыть')}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(post)}
                  className="flex-1 h-[36px] rounded-[10px] bg-btnSimple text-amber-400 text-[13px] font-[600]"
                >
                  {t('mobile_queue_delete', 'Удалить')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
