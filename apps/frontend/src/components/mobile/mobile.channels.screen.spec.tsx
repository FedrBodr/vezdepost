// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.hoisted(() => ({ data: [] as any[], mutate: vi.fn() }));
const addProvider = vi.hoisted(() => vi.fn());

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration.list',
  () => ({
    useIntegrationList: () => list,
  })
);
vi.mock('@gitroom/frontend/components/launches/add.provider.component', () => ({
  useAddProvider: () => addProvider,
}));
vi.mock('@gitroom/frontend/components/layout/telegram.assistant.button', () => ({
  TelegramAssistantButton: () => (
    <button type="button">Постить из Telegram</button>
  ),
}));

import { MobileChannelsScreen } from './mobile.channels.screen';

const channel = (overrides: Record<string, unknown>) => ({
  id: '1',
  name: 'Канал',
  identifier: 'vk',
  picture: '/a.jpg',
  disabled: false,
  refreshNeeded: false,
  inBetweenSteps: false,
  ...overrides,
});

beforeEach(() => {
  cleanup();
  list.data = [];
  addProvider.mockClear();
});

describe('MobileChannelsScreen', () => {
  it('shows the empty state and opens the add-channel flow', () => {
    render(<MobileChannelsScreen />);
    expect(screen.getByText('Пока нет каналов')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить канал' }));
    expect(addProvider).toHaveBeenCalledTimes(1);
  });

  it('lists channels with their status and flags channels that need reconnection', () => {
    list.data = [
      channel({ id: '1', name: 'Мой VK' }),
      channel({ id: '2', name: 'Канал', identifier: 'telegram', refreshNeeded: true }),
      channel({ id: '3', name: 'Старый', identifier: 'x', disabled: true }),
    ];
    render(<MobileChannelsScreen />);
    expect(screen.getByText('Мой VK')).toBeTruthy();
    expect(screen.getAllByText('Активен')).toHaveLength(1);
    expect(screen.getByText('Нужно переподключить')).toBeTruthy();
    expect(screen.getByText('Отключён')).toBeTruthy();
    expect(screen.queryByText('Пока нет каналов')).toBeNull();
  });

  it('offers the Telegram assistant link', () => {
    render(<MobileChannelsScreen />);
    expect(
      screen.getByRole('button', { name: 'Постить из Telegram' })
    ).toBeTruthy();
  });
});
