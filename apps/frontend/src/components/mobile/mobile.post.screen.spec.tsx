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

const list = vi.hoisted(() => ({ data: [] as any[], isLoading: false }));
const fetchMock = vi.hoisted(() => vi.fn());
const upload = vi.hoisted(() => vi.fn());
const goal = vi.hoisted(() => vi.fn());
const search = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration.list',
  () => ({
    useIntegrationList: () => list,
  })
);
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));
vi.mock('@gitroom/frontend/components/mobile/use.mobile.upload', () => ({
  useMobileUpload: () => upload,
}));
vi.mock('@gitroom/frontend/components/mobile/use.mobile.goal', () => ({
  useMobileGoal: () => goal,
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => search.params,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { MobilePostScreen } from './mobile.post.screen';
import { encodeSharePayload } from './share.payload';

const channel = (overrides: Record<string, unknown>) => ({
  id: 'vk-1',
  name: 'Мой VK',
  identifier: 'vk',
  picture: '/vk.jpg',
  disabled: false,
  refreshNeeded: false,
  inBetweenSteps: false,
  ...overrides,
});

const okResponse = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

beforeEach(() => {
  cleanup();
  localStorage.clear();
  list.data = [
    channel({}),
    channel({ id: 'tg-1', name: 'Канал', identifier: 'telegram' }),
  ];
  list.isLoading = false;
  fetchMock.mockReset();
  upload.mockReset();
  goal.mockReset();
  search.params = new URLSearchParams();
  window.history.replaceState(null, '', '/m');
});

describe('MobilePostScreen', () => {
  it('asks a new user to connect the first channel', () => {
    list.data = [];
    render(<MobilePostScreen />);
    expect(
      screen
        .getByRole('link', { name: 'Подключить первый канал' })
        .getAttribute('href')
    ).toBe('/m/channels');
  });

  it('does not show the first-run call to action while channels load', () => {
    list.isLoading = true;
    render(<MobilePostScreen />);
    expect(
      screen.queryByRole('link', { name: 'Подключить первый канал' })
    ).toBeNull();
  });

  it('disables publish until the post is valid', () => {
    render(<MobilePostScreen />);
    const publish = screen.getByRole('button', {
      name: 'Опубликовать',
    }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    expect(screen.getByText('Добавьте текст или фото')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Привет' },
    });
    expect(screen.getByText('Выберите хотя бы один канал')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Мой VK' }));
    expect(publish.disabled).toBe(false);
  });

  it('sends the draft to /posts/quick and reports success', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ published: [{ id: 'vk-1', name: 'Мой VK' }], failed: [] })
    );
    render(<MobilePostScreen />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Привет' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Мой VK' }));
    fireEvent.click(screen.getByRole('button', { name: 'В очередь' }));
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));

    await waitFor(() =>
      expect(screen.getByText('✅ Ушло: Мой VK')).toBeTruthy()
    );
    expect(fetchMock).toHaveBeenCalledWith('/posts/quick', {
      method: 'POST',
      body: JSON.stringify({
        text: 'Привет',
        media: [],
        integrationIds: ['vk-1'],
        schedule: { type: 'queue' },
      }),
    });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      ''
    );
    expect(goal).toHaveBeenCalledWith('mobile_quick_post_sent');
  });

  it('keeps failed channels on screen and clears only on full success', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        published: [{ id: 'vk-1', name: 'Мой VK' }],
        failed: [{ id: 'tg-1', name: 'Канал', error: 'слишком длинный текст' }],
      })
    );
    render(<MobilePostScreen />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Привет' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Мой VK' }));
    fireEvent.click(screen.getByRole('button', { name: 'Канал' }));
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));

    await waitFor(() =>
      expect(screen.getByText('⚠️ Канал: слишком длинный текст')).toBeTruthy()
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'Привет'
    );
    expect(goal).toHaveBeenCalledWith('mobile_quick_post_sent');
  });

  it('shows the server message on 400', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ message: 'Дата публикации уже прошла' }, 400)
    );
    render(<MobilePostScreen />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Привет' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Мой VK' }));
    fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
    await waitFor(() =>
      expect(screen.getByText('Дата публикации уже прошла')).toBeTruthy()
    );
  });

  it('prefills from a shared payload', () => {
    search.params = new URLSearchParams({
      shared: encodeSharePayload({
        text: 'Из галереи',
        media: [{ id: 'm1', path: '/a.jpg' }],
      }),
    });
    render(<MobilePostScreen />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      'Из галереи'
    );
    expect(document.querySelector('img[src="/a.jpg"]')).toBeTruthy();
  });

  it('uploads a picked file and shows the upload error inline', async () => {
    upload.mockRejectedValueOnce(new Error('Фото больше 10 МБ'));
    render(<MobilePostScreen />);
    const input = screen.getByLabelText(
      'Добавить фото или видео'
    ) as HTMLInputElement;
    const file = new File(['x'], 'big.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(screen.getByText('big.jpg: Фото больше 10 МБ')).toBeTruthy()
    );
  });

  it('remembers selected channels between visits', () => {
    localStorage.setItem('vz-mobile-channels', JSON.stringify(['tg-1', 'gone']));
    render(<MobilePostScreen />);
    expect(
      screen.getByRole('button', { name: 'Канал' }).getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Мой VK' }).getAttribute('aria-pressed')
    ).toBe('false');
  });
});
