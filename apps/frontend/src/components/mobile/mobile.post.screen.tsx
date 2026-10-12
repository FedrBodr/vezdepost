'use client';

import React, {
  ChangeEvent,
  FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useMobileUpload } from '@gitroom/frontend/components/mobile/use.mobile.upload';
import { useMobileGoal } from '@gitroom/frontend/components/mobile/use.mobile.goal';
import { decodeSharePayload } from '@gitroom/frontend/components/mobile/share.payload';
import {
  draftProblem,
  emptyDraft,
  localDateTimeToIso,
  QuickPostDraft,
  QuickPostMedia,
  toQuickPostBody,
} from '@gitroom/frontend/components/mobile/quick.post.request';

const CHANNELS_KEY = 'vz-mobile-channels';

type Channel = {
  id: string;
  name: string;
  identifier: string;
  picture: string;
  disabled: boolean;
  refreshNeeded: boolean;
  inBetweenSteps: boolean;
};

type Result = {
  published: { id: string; name: string }[];
  failed: { id: string; name: string; error: string }[];
};

const isActive = (channel: Channel) =>
  !channel.disabled && !channel.refreshNeeded && !channel.inBetweenSteps;

const readStoredChannels = (): string[] => {
  try {
    const raw = localStorage.getItem(CHANNELS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id) => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
};

const storeChannels = (ids: string[]) => {
  try {
    localStorage.setItem(CHANNELS_KEY, JSON.stringify(ids));
  } catch {
    // Private mode may block storage; the selection just will not persist.
  }
};

const isVideo = (path: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(path);

export const MobilePostScreen: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const upload = useMobileUpload();
  const goal = useMobileGoal();
  const searchParams = useSearchParams();
  const { data, isLoading } = useIntegrationList();
  const channels: Channel[] = data || [];

  const [draft, setDraft] = useState<QuickPostDraft>(() => emptyDraft());
  const [dateValue, setDateValue] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const initialised = useRef(false);

  // One-time init: shared payload and remembered channels.
  useEffect(() => {
    if (initialised.current) {
      return;
    }
    initialised.current = true;
    const shared = decodeSharePayload(searchParams.get('shared'));
    const stored = readStoredChannels();
    setDraft((current) => ({
      ...current,
      text: shared?.text || current.text,
      media: shared?.media || current.media,
      selected: stored,
    }));
    if (shared && typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('shared');
      window.history.replaceState(null, '', url.toString());
    }
  }, [searchParams]);

  // Drop remembered ids that no longer exist or are inactive once channels load.
  const activeIds = useMemo(
    () => new Set(channels.filter(isActive).map((c) => c.id)),
    [channels]
  );
  useEffect(() => {
    if (!channels.length) {
      return;
    }
    setDraft((current) => {
      const selected = current.selected.filter((id) => activeIds.has(id));
      return selected.length === current.selected.length
        ? current
        : { ...current, selected };
    });
  }, [channels.length, activeIds]);

  const toggleChannel = useCallback((id: string) => {
    setDraft((current) => {
      const selected = current.selected.includes(id)
        ? current.selected.filter((x) => x !== id)
        : [...current.selected, id];
      storeChannels(selected);
      return { ...current, selected };
    });
  }, []);

  const setSchedule = useCallback(
    (type: 'now' | 'queue' | 'date') => {
      setDraft((current) => ({
        ...current,
        schedule:
          type === 'date'
            ? {
                type: 'date',
                date: dateValue ? localDateTimeToIso(dateValue) : '',
              }
            : { type },
      }));
    },
    [dateValue]
  );

  const onDateChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setDateValue(value);
    setDraft((current) => ({
      ...current,
      schedule: { type: 'date', date: value ? localDateTimeToIso(value) : '' },
    }));
  }, []);

  const onFiles = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      for (const file of files) {
        setUploading((n) => n + 1);
        try {
          const media = await upload(file);
          setDraft((current) => ({
            ...current,
            media: [...current.media, media],
          }));
        } catch (error) {
          setUploadErrors((list) => [
            ...list,
            `${file.name}: ${(error as Error).message}`,
          ]);
        } finally {
          setUploading((n) => n - 1);
        }
      }
    },
    [upload]
  );

  const removeMedia = useCallback((id: string) => {
    setDraft((current) => ({
      ...current,
      media: current.media.filter((m) => m.id !== id),
    }));
  }, []);

  const problem = draftProblem(draft);
  const canSend = !problem && !sending && uploading === 0;

  const send = useCallback(async () => {
    if (!canSend) {
      return;
    }
    setSending(true);
    setServerError(null);
    setResult(null);
    try {
      const response = await fetch('/posts/quick', {
        method: 'POST',
        body: JSON.stringify(toQuickPostBody(draft)),
      });
      if (response.status === 400) {
        const body = await response.json().catch(() => ({}));
        setServerError(
          typeof body?.message === 'string'
            ? body.message
            : t('mobile_send_failed', 'Не удалось отправить, попробуйте ещё раз')
        );
        return;
      }
      if (!response.ok) {
        setServerError(
          t('mobile_send_failed', 'Не удалось отправить, попробуйте ещё раз')
        );
        return;
      }
      const outcome = (await response.json()) as Result;
      setResult(outcome);
      goal('mobile_quick_post_sent');
      if (outcome.failed.length === 0) {
        setDraft((current) => ({ ...emptyDraft(), selected: current.selected }));
        setDateValue('');
        setUploadErrors([]);
      }
    } catch {
      setServerError(
        t('mobile_send_failed', 'Не удалось отправить, попробуйте ещё раз')
      );
    } finally {
      setSending(false);
    }
  }, [canSend, draft, fetch, goal, t]);

  if (isLoading) {
    return null;
  }

  if (channels.length === 0) {
    return (
      <div className="flex flex-col gap-[16px] pt-[32px] items-start">
        <h1 className="text-[22px] font-[600]">
          {t('mobile_first_run_title', 'Начнём с первого канала')}
        </h1>
        <p className="text-[15px] text-textItemBlur">
          {t(
            'mobile_first_run_hint',
            'Подключите Telegram, VK или другой канал — после этого можно будет постить с телефона.'
          )}
        </p>
        <Link
          href="/m/channels"
          className="h-[48px] px-[20px] inline-flex items-center rounded-[12px] bg-btnPrimary text-btnText text-[15px] font-[600]"
        >
          {t('mobile_first_run_cta', 'Подключить первый канал')}
        </Link>
      </div>
    );
  }

  const scheduleButton = (type: 'now' | 'queue' | 'date', label: string) => (
    <button
      type="button"
      onClick={() => setSchedule(type)}
      aria-pressed={draft.schedule.type === type}
      className={clsx(
        'flex-1 h-[40px] rounded-[10px] text-[14px] font-[600]',
        draft.schedule.type === type
          ? 'bg-boxFocused text-textItemFocused'
          : 'bg-newBgColorInner text-textItemBlur'
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-[16px] pt-[16px]">
      <textarea
        value={draft.text}
        onChange={(event) =>
          setDraft((current) => ({ ...current, text: event.target.value }))
        }
        placeholder={t('mobile_text_placeholder', 'Текст поста')}
        rows={5}
        className="w-full rounded-[12px] bg-newBgColorInner p-[12px] text-[16px] text-newTextColor outline-none"
      />

      <div className="flex gap-[8px] overflow-x-auto">
        {draft.media.map((item: QuickPostMedia) => (
          <div key={item.id} className="relative w-[72px] h-[72px] shrink-0">
            {isVideo(item.path) ? (
              <div className="w-full h-full rounded-[10px] bg-newBgLineColor flex items-center justify-center text-[24px]">
                🎬
              </div>
            ) : (
              <img
                src={item.path}
                alt=""
                className="w-full h-full rounded-[10px] object-cover"
              />
            )}
            <button
              type="button"
              aria-label={t('mobile_remove_media', 'Убрать')}
              onClick={() => removeMedia(item.id)}
              className="absolute -top-[6px] -end-[6px] w-[22px] h-[22px] rounded-full bg-newBgColor text-newTextColor text-[14px] leading-[22px] text-center"
            >
              ×
            </button>
          </div>
        ))}
        <label className="w-[72px] h-[72px] shrink-0 rounded-[10px] border border-dashed border-newBorder flex items-center justify-center text-[28px] text-textItemBlur cursor-pointer">
          <span aria-hidden="true">{uploading ? '…' : '+'}</span>
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={onFiles}
            className="sr-only"
            aria-label={t('mobile_add_media', 'Добавить фото или видео')}
          />
        </label>
      </div>
      {uploadErrors.map((message) => (
        <div key={message} className="text-[13px] text-amber-400">
          {message}
        </div>
      ))}

      <div className="flex gap-[8px] overflow-x-auto">
        {channels.map((channel) => {
          const active = isActive(channel);
          const selected = draft.selected.includes(channel.id);
          return (
            <button
              key={channel.id}
              type="button"
              disabled={!active}
              aria-pressed={selected}
              onClick={() => toggleChannel(channel.id)}
              title={
                active
                  ? undefined
                  : t('mobile_channel_reconnect', 'Нужно переподключить')
              }
              className={clsx(
                'flex items-center gap-[6px] shrink-0 h-[40px] ps-[6px] pe-[12px] rounded-full text-[14px] font-[600]',
                selected
                  ? 'bg-boxFocused text-textItemFocused'
                  : 'bg-newBgColorInner text-textItemBlur',
                !active && 'opacity-40'
              )}
            >
              <img
                src={channel.picture}
                alt=""
                className="w-[28px] h-[28px] rounded-full object-cover"
              />
              {channel.name}
            </button>
          );
        })}
      </div>

      <div className="flex gap-[8px]">
        {scheduleButton('now', t('mobile_schedule_now', 'Сейчас'))}
        {scheduleButton('queue', t('mobile_schedule_queue', 'В очередь'))}
        {scheduleButton('date', t('mobile_schedule_date', 'Дата'))}
      </div>
      {draft.schedule.type === 'date' && (
        <input
          type="datetime-local"
          value={dateValue}
          onChange={onDateChange}
          aria-label={t('mobile_schedule_date', 'Дата')}
          className="h-[44px] rounded-[10px] bg-newBgColorInner px-[12px] text-newTextColor"
        />
      )}

      <button
        type="button"
        onClick={() => void send()}
        disabled={!canSend}
        className="h-[52px] rounded-[12px] bg-btnPrimary text-btnText text-[16px] font-[600] disabled:opacity-50"
      >
        {sending
          ? t('mobile_sending', 'Отправляем…')
          : t('mobile_publish', 'Опубликовать')}
      </button>
      {problem && !result && (
        <div className="text-[13px] text-textItemBlur">{problem}</div>
      )}
      {serverError && (
        <div className="text-[14px] text-amber-400">{serverError}</div>
      )}
      {result && (
        <div className="flex flex-col gap-[4px] text-[14px]">
          {result.published.length > 0 && (
            <div>
              {`${t('mobile_result_published', '✅ Ушло: ')}${result.published
                .map((p) => p.name)
                .join(', ')}`}
            </div>
          )}
          {result.failed.map((f) => (
            <div key={f.id} className="text-amber-400">
              {`⚠️ ${f.name}: ${f.error}`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
