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
  states: string[];
  channels: QueueItem['integration'][];
};

export const groupQueue = (posts: HistoryItem[]): QueueGroup[] => {
  const groups = new Map<string, QueueGroup>();
  for (const post of posts) {
    const state = post.state || 'QUEUE';
    const existing = groups.get(post.group);
    if (existing) {
      existing.channels.push(post.integration);
      existing.states.push(state);
      existing.releaseURL = existing.releaseURL || post.releaseURL || '';
    } else {
      groups.set(post.group, {
        group: post.group,
        firstId: post.id,
        content: post.content,
        publishDate: post.publishDate,
        releaseURL: post.releaseURL || '',
        states: [state],
        channels: [post.integration],
      });
    }
  }
  return [...groups.values()];
};

type FeedStatus = 'scheduled' | 'publishing' | 'error' | 'published';

/** Status of a past group; a failure in any channel wins. */
export const pastStatus = (group: QueueGroup): FeedStatus =>
  group.states.includes('ERROR')
    ? 'error'
    : group.states.includes('QUEUE')
    ? 'publishing'
    : 'published';

const statusLabels: Record<
  FeedStatus,
  { key: string; fallback: string; className: string }
> = {
  scheduled: {
    key: 'mobile_feed_scheduled',
    fallback: 'Запланирован',
    className: 'text-textItemBlur',
  },
  publishing: {
    key: 'mobile_feed_publishing',
    fallback: 'Публикуется',
    className: 'text-amber-400',
  },
  error: {
    key: 'mobile_feed_error',
    fallback: 'Ошибка',
    className: 'text-red-400',
  },
  published: {
    key: 'mobile_feed_published',
    fallback: 'Опубликован',
    className: 'text-green-400',
  },
};

const FeedRow: FC<{
  group: QueueGroup;
  status: FeedStatus;
  onDelete: (group: QueueGroup) => void;
}> = ({ group, status, onDelete }) => {
  const t = useT();
  const label = statusLabels[status];
  const href =
    status === 'published' && group.releaseURL
      ? group.releaseURL
      : `/p/${group.firstId}?share=true`;
  const deletable = status === 'scheduled' || status === 'error';
  return (
    <li className="flex flex-col gap-[8px] rounded-[12px] bg-newBgColorInner p-[12px]">
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
            <span className={label.className}>
              {t(label.key, label.fallback)}
            </span>
            {' · '}
            {dayjs(group.publishDate).format('DD.MM HH:mm')}
          </div>
        </div>
      </div>
      <div className="text-[14px]">{excerpt(group.content)}</div>
      <div className="flex gap-[8px]">
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="flex-1 flex items-center justify-center h-[36px] rounded-[10px] bg-btnSimple text-btnText text-[13px] font-[600]"
        >
          {t('mobile_queue_open', 'Открыть')}
        </a>
        {deletable && (
          <button
            type="button"
            onClick={() => onDelete(group)}
            className="flex-1 h-[36px] rounded-[10px] bg-btnSimple text-amber-400 text-[13px] font-[600]"
          >
            {t('mobile_queue_delete', 'Удалить')}
          </button>
        )}
      </div>
    </li>
  );
};

/**
 * One feed for every post: upcoming ones first (soonest on top), then sent,
 * failed and overdue ones, newest first.
 */
export const MobileQueueScreen: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const { data, isLoading, mutate } = useMobileQueue();
  const history = useMobileHistory();
  const upcoming = useMemo(() => groupQueue(data?.posts || []), [data]);
  // A slot can pass between the two fetches; the past list wins then.
  const past = useMemo(() => groupQueue(history.posts), [history.posts]);
  const upcomingOnly = useMemo(() => {
    const seen = new Set(past.map((group) => group.group));
    return upcoming.filter((group) => !seen.has(group.group));
  }, [upcoming, past]);

  const remove = useCallback(
    async (group: QueueGroup) => {
      const names = group.channels.map((c) => c.name).join(', ');
      const yes = await deleteDialog(
        `${t('mobile_feed_delete_confirm', 'Удалить этот пост?')} ${t(
          'mobile_queue_delete_channels',
          'Каналы: '
        )}${names}`,
        t('mobile_queue_delete_yes', 'Удалить')
      );
      if (!yes) {
        return;
      }
      await fetch(`/posts/${group.group}`, { method: 'DELETE' });
      mutate();
      history.mutate();
    },
    [fetch, mutate, history.mutate, t]
  );

  const empty =
    !isLoading &&
    !history.isLoading &&
    upcomingOnly.length === 0 &&
    past.length === 0;

  return (
    <div className="flex flex-col gap-[16px] pt-[16px]">
      <h1 className="text-[22px] font-[600]">
        {t('mobile_feed_title', 'Посты')}
      </h1>
      {empty ? (
        <p className="text-textItemBlur text-[15px]">
          {t('mobile_feed_empty', 'Постов пока нет')}
        </p>
      ) : (
        <ul className="flex flex-col gap-[8px]">
          {upcomingOnly.map((group) => (
            <FeedRow
              key={group.group}
              group={group}
              status="scheduled"
              onDelete={remove}
            />
          ))}
          {past.map((group) => (
            <FeedRow
              key={group.group}
              group={group}
              status={pastStatus(group)}
              onDelete={remove}
            />
          ))}
        </ul>
      )}
      {history.hasMore && (
        <button
          type="button"
          onClick={history.loadMore}
          className="h-[40px] rounded-[10px] bg-btnSimple text-btnText text-[14px] font-[600]"
        >
          {t('mobile_history_more', 'Показать ещё')}
        </button>
      )}
    </div>
  );
};
