'use client';

import React, { FC, useCallback, useMemo } from 'react';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import {
  QueueItem,
  useMobileQueue,
} from '@gitroom/frontend/components/mobile/use.mobile.queue';
import {
  HistoryItem,
  useMobileHistory,
} from '@gitroom/frontend/components/mobile/use.mobile.history';

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

/**
 * One row per post group: a desktop post spans several channels under one
 * group, and DELETE /posts/:group removes all of them, so the row must show
 * every channel it would affect.
 */
type QueueGroup = {
  group: string;
  firstId: string;
  content: string;
  publishDate: string;
  releaseURL: string;
  channels: QueueItem['integration'][];
};

export const groupQueue = (posts: HistoryItem[]): QueueGroup[] => {
  const groups = new Map<string, QueueGroup>();
  for (const post of posts) {
    const existing = groups.get(post.group);
    if (existing) {
      existing.channels.push(post.integration);
    } else {
      groups.set(post.group, {
        group: post.group,
        firstId: post.id,
        content: post.content,
        publishDate: post.publishDate,
        releaseURL: post.releaseURL || '',
        channels: [post.integration],
      });
    }
  }
  return [...groups.values()];
};

const GroupHeader: FC<{ group: QueueGroup }> = ({ group }) => (
  <div className="flex items-center gap-[10px]">
    <div className="flex -space-x-[8px]">
      {group.channels.map((channel) => (
        <img
          key={channel.id}
          src={channel.picture}
          alt=""
          className="w-[32px] h-[32px] rounded-full object-cover border-2 border-newBgColorInner"
        />
      ))}
    </div>
    <div className="flex-1 min-w-0">
      <div className="text-[14px] font-[600] truncate">
        {group.channels.map((c) => c.name).join(', ')}
      </div>
      <div className="text-[12px] text-textItemBlur">
        {dayjs(group.publishDate).format('DD.MM HH:mm')}
      </div>
    </div>
  </div>
);

/** Published posts, newest first; a row links to the live publication. */
const MobileHistory: FC = () => {
  const t = useT();
  const { posts, hasMore, isLoading, loadMore } = useMobileHistory();
  const groups = useMemo(() => groupQueue(posts), [posts]);

  return (
    <div className="flex flex-col gap-[12px]">
      <h2 className="text-[18px] font-[600]">
        {t('mobile_history_title', 'Опубликованные')}
      </h2>
      {!isLoading && groups.length === 0 ? (
        <p className="text-textItemBlur text-[15px]">
          {t('mobile_history_empty', 'Опубликованных постов пока нет')}
        </p>
      ) : (
        <ul className="flex flex-col gap-[8px]">
          {groups.map((group) => (
            <li
              key={group.group}
              className="flex flex-col gap-[8px] rounded-[12px] bg-newBgColorInner p-[12px]"
            >
              <GroupHeader group={group} />
              <div className="text-[14px]">{excerpt(group.content)}</div>
              <a
                href={group.releaseURL || `/p/${group.firstId}?share=true`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center h-[36px] rounded-[10px] bg-btnSimple text-btnText text-[13px] font-[600]"
              >
                {t('mobile_history_open', 'Открыть публикацию')}
              </a>
            </li>
          ))}
        </ul>
      )}
      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          className="h-[40px] rounded-[10px] bg-btnSimple text-btnText text-[14px] font-[600]"
        >
          {t('mobile_history_more', 'Показать ещё')}
        </button>
      )}
    </div>
  );
};

export const MobileQueueScreen: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const { data, isLoading, mutate } = useMobileQueue();
  const groups = useMemo(() => groupQueue(data?.posts || []), [data]);

  const open = useCallback((group: QueueGroup) => {
    window.open(`/p/${group.firstId}?share=true`, '_blank');
  }, []);

  const remove = useCallback(
    async (group: QueueGroup) => {
      const names = group.channels.map((c) => c.name).join(', ');
      const yes = await deleteDialog(
        `${t(
          'mobile_queue_delete_confirm',
          'Удалить этот пост из очереди?'
        )} ${t('mobile_queue_delete_channels', 'Каналы: ')}${names}`,
        t('mobile_queue_delete_yes', 'Удалить')
      );
      if (!yes) {
        return;
      }
      await fetch(`/posts/${group.group}`, { method: 'DELETE' });
      mutate();
    },
    [fetch, mutate, t]
  );

  return (
    <div className="flex flex-col gap-[16px] pt-[16px]">
      <h1 className="text-[22px] font-[600]">
        {t('mobile_queue_title', 'Очередь')}
      </h1>
      {!isLoading && groups.length === 0 ? (
        <p className="text-textItemBlur text-[15px]">
          {t('mobile_queue_empty', 'В очереди пока пусто')}
        </p>
      ) : (
        <ul className="flex flex-col gap-[8px]">
          {groups.map((group) => (
            <li
              key={group.group}
              className="flex flex-col gap-[8px] rounded-[12px] bg-newBgColorInner p-[12px]"
            >
              <GroupHeader group={group} />
              <div className="text-[14px]">{excerpt(group.content)}</div>
              <div className="flex gap-[8px]">
                <button
                  type="button"
                  onClick={() => open(group)}
                  className="flex-1 h-[36px] rounded-[10px] bg-btnSimple text-btnText text-[13px] font-[600]"
                >
                  {t('mobile_queue_open', 'Открыть')}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(group)}
                  className="flex-1 h-[36px] rounded-[10px] bg-btnSimple text-amber-400 text-[13px] font-[600]"
                >
                  {t('mobile_queue_delete', 'Удалить')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <MobileHistory />
    </div>
  );
};
