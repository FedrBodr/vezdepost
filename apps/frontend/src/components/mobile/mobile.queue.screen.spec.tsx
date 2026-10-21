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
  mutate: vi.fn(),
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
  history.mutate.mockClear();
  fetchMock.mockReset();
  confirm.mockReset();
  window.open = vi.fn();
});

describe('MobileQueueScreen', () => {
  it('shows the empty state', () => {
    queue.data = { posts: [] };
    render(<MobileQueueScreen />);
    expect(screen.getByText('Постов пока нет')).toBeTruthy();
  });

  it('lists upcoming posts with channel, date and stripped text', () => {
    render(<MobileQueueScreen />);
    expect(screen.getByText('Мой VK')).toBeTruthy();
    expect(screen.getByText('Привет мир')).toBeTruthy();
    expect(screen.getByText('Запланирован')).toBeTruthy();
    expect(screen.getByText(/20\.10 \d\d:\d\d/)).toBeTruthy();
  });

  it('links an upcoming post to its preview', () => {
    render(<MobileQueueScreen />);
    const link = screen.getByRole('link', { name: 'Открыть' });
    expect(link.getAttribute('href')).toBe('/p/p1?share=true');
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
    expect(history.mutate).toHaveBeenCalledTimes(1);
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

  describe('past posts in the same feed', () => {
    const published = {
      ...item,
      id: 'h1',
      group: 'hg1',
      content: '<p>Вышел в свет</p>',
      publishDate: '2026-10-11T18:08:00.000Z',
      releaseURL: 'https://vk.com/wall-1_1',
      state: 'PUBLISHED',
    };

    it('has no separate block heading', () => {
      history.posts = [published];
      render(<MobileQueueScreen />);
      expect(screen.getAllByRole('heading')).toHaveLength(1);
      expect(screen.getByRole('heading').textContent).toBe('Посты');
    });

    it('lists upcoming posts above past ones', () => {
      history.posts = [published];
      render(<MobileQueueScreen />);
      const rows = screen.getAllByRole('listitem');
      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toContain('Привет мир');
      expect(rows[1].textContent).toContain('Вышел в свет');
    });

    it('links a published post to the publication, without a delete button', () => {
      queue.data = { posts: [] };
      history.posts = [published];
      render(<MobileQueueScreen />);
      expect(screen.getByText('Опубликован')).toBeTruthy();
      const link = screen.getByRole('link', { name: 'Открыть' });
      expect(link.getAttribute('href')).toBe('https://vk.com/wall-1_1');
      expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
    });

    it('falls back to the preview when the publication has no URL', () => {
      queue.data = { posts: [] };
      history.posts = [{ ...published, releaseURL: '' }];
      render(<MobileQueueScreen />);
      const link = screen.getByRole('link', { name: 'Открыть' });
      expect(link.getAttribute('href')).toBe('/p/h1?share=true');
    });

    it('marks a group as failed when any channel failed and lets it be deleted', () => {
      queue.data = { posts: [] };
      history.posts = [
        published,
        {
          ...published,
          id: 'h2',
          releaseURL: '',
          state: 'ERROR',
          integration: { ...item.integration, id: 'tg-1', name: 'Канал' },
        },
      ];
      render(<MobileQueueScreen />);
      expect(screen.getByText('Мой VK, Канал')).toBeTruthy();
      expect(screen.getByText('Ошибка')).toBeTruthy();
      expect(screen.getAllByRole('button', { name: 'Удалить' })).toHaveLength(1);
    });

    it('shows an overdue queued post as publishing', () => {
      queue.data = { posts: [] };
      history.posts = [{ ...published, releaseURL: '', state: 'QUEUE' }];
      render(<MobileQueueScreen />);
      expect(screen.getByText('Публикуется')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
    });

    it('shows a post whose slot just passed only once, as past', () => {
      history.posts = [{ ...published, id: 'p1', group: 'g1' }];
      render(<MobileQueueScreen />);
      expect(screen.getAllByRole('listitem')).toHaveLength(1);
      expect(screen.getByText('Опубликован')).toBeTruthy();
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
