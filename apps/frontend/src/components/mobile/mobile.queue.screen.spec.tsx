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
const fetchMock = vi.hoisted(() => vi.fn());
const confirm = vi.hoisted(() => vi.fn());

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@gitroom/frontend/components/mobile/use.mobile.queue', () => ({
  useMobileQueue: () => queue,
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

  it('does nothing when deletion is declined', async () => {
    confirm.mockResolvedValueOnce(false);
    render(<MobileQueueScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
