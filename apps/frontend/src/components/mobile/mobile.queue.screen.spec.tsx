// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queue = vi.hoisted(() => ({
  data: undefined as any,
  isLoading: false,
  mutate: vi.fn(),
}));
const history = vi.hoisted(() => ({
  posts: [] as any[],
  hasMore: false,
  isLoading: false,
  loadMore: vi.fn(),
}));
const fetchMock = vi.hoisted(() => vi.fn());
const confirm = vi.hoisted(() => vi.fn());

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@gitroom/frontend/components/mobile/use.mobile.queue', () => ({
  useMobileQueue: () => queue,
}));
vi.mock('@gitroom/frontend/components/mobile/use.mobile.history', () => ({
  useMobileHistory: () => history,
}));
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));
vi.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: confirm,
}));

import { MobileQueueScreen } from './mobile.queue.screen';

const item = {
  id: 'p1',
  group: 'g1',
  content: '<p>Привет <b>мир</b></p>',
  publishDate: '2026-10-20T08:30:00.000Z',
  integration: {
    id: 'vk-1',
    name: 'Мой VK',
    picture: '/vk.jpg',
    providerIdentifier: 'vk',
  },
};

beforeEach(() => {
  cleanup();
  queue.data = { posts: [item] };
  queue.isLoading = false;
  queue.mutate.mockClear();
  history.posts = [];
  history.hasMore = false;
  history.isLoading = false;
  history.loadMore.mockClear();
  fetchMock.mockReset();
  confirm.mockReset();
  window.open = vi.fn();
});

describe('MobileQueueScreen', () => {
  it('shows the empty state', () => {
    queue.data = { posts: [] };
    render(<MobileQueueScreen />);
    expect(screen.getByText('В очереди пока пусто')).toBeTruthy();
  });

  it('lists upcoming posts with channel, date and stripped text', () => {
    render(<MobileQueueScreen />);
    expect(screen.getByText('Мой VK')).toBeTruthy();
    expect(screen.getByText('Привет мир')).toBeTruthy();
    expect(screen.getByText(/20\.10 \d\d:\d\d/)).toBeTruthy();
  });

  it('opens the preview in a new tab', () => {
    render(<MobileQueueScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    expect(window.open).toHaveBeenCalledWith('/p/p1?share=true', '_blank');
  });

  it('asks before deleting and deletes the group when confirmed', async () => {
    confirm.mockResolvedValueOnce(true);
    fetchMock.mockResolvedValueOnce({ ok: true } as Response);
    render(<MobileQueueScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/posts/g1', { method: 'DELETE' })
    );
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(queue.mutate).toHaveBeenCalledTimes(1);
  });

  it('shows a multi-channel group as one row and names every channel before deleting', async () => {
    queue.data = {
      posts: [
        item,
        {
          ...item,
          id: 'p2',
          integration: {
            ...item.integration,
            id: 'tg-1',
            name: 'Канал',
            picture: '/tg.jpg',
          },
        },
      ],
    };
    confirm.mockResolvedValueOnce(true);
    fetchMock.mockResolvedValueOnce({ ok: true } as Response);
    render(<MobileQueueScreen />);
    expect(screen.getAllByRole('button', { name: 'Удалить' })).toHaveLength(1);
    expect(screen.getByText('Мой VK, Канал')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0][0]).toContain('Мой VK, Канал');
    expect(fetchMock).toHaveBeenCalledWith('/posts/g1', { method: 'DELETE' });
  });

  it('does nothing when deletion is declined', async () => {
    confirm.mockResolvedValueOnce(false);
    render(<MobileQueueScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('published history', () => {
    const published = {
      ...item,
      id: 'h1',
      group: 'hg1',
      content: '<p>Вышел в свет</p>',
      publishDate: '2026-10-11T18:08:00.000Z',
      releaseURL: 'https://vk.com/wall-1_1',
    };

    it('shows the history empty state under the queue', () => {
      render(<MobileQueueScreen />);
      expect(screen.getByText('Опубликованные')).toBeTruthy();
      expect(screen.getByText('Опубликованных постов пока нет')).toBeTruthy();
    });

    it('lists published posts with a link to the publication and no delete button', () => {
      history.posts = [published];
      render(<MobileQueueScreen />);
      expect(screen.getByText('Вышел в свет')).toBeTruthy();
      const link = screen.getByRole('link', { name: 'Открыть публикацию' });
      expect(link.getAttribute('href')).toBe('https://vk.com/wall-1_1');
      expect(screen.getAllByRole('button', { name: 'Удалить' })).toHaveLength(1);
    });

    it('falls back to the preview when the publication has no URL', () => {
      history.posts = [{ ...published, releaseURL: '' }];
      render(<MobileQueueScreen />);
      const link = screen.getByRole('link', { name: 'Открыть публикацию' });
      expect(link.getAttribute('href')).toBe('/p/h1?share=true');
    });

    it('collapses a multi-channel publication into one row', () => {
      history.posts = [
        published,
        {
          ...published,
          id: 'h2',
          integration: { ...item.integration, id: 'tg-1', name: 'Канал' },
        },
      ];
      render(<MobileQueueScreen />);
      expect(screen.getByText('Мой VK, Канал')).toBeTruthy();
      expect(
        screen.getAllByRole('link', { name: 'Открыть публикацию' })
      ).toHaveLength(1);
    });

    it('loads more only while the server reports more pages', () => {
      history.posts = [published];
      history.hasMore = true;
      render(<MobileQueueScreen />);
      fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));
      expect(history.loadMore).toHaveBeenCalledTimes(1);
      cleanup();
      history.hasMore = false;
      render(<MobileQueueScreen />);
      expect(screen.queryByRole('button', { name: 'Показать ещё' })).toBeNull();
    });
  });
});
