// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.hoisted(() => ({ data: [] as any[], isLoading: false }));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration.list',
  () => ({
    useIntegrationList: () => list,
  })
);

import { MobilePostScreen } from './mobile.post.screen';

beforeEach(() => {
  cleanup();
  list.data = [];
});

describe('MobilePostScreen', () => {
  it('asks a new user to connect the first channel', () => {
    render(<MobilePostScreen />);
    const link = screen.getByRole('link', { name: 'Подключить первый канал' });
    expect(link.getAttribute('href')).toBe('/m/channels');
  });

  it('shows the editor placeholder once a channel exists', () => {
    list.data = [
      {
        id: '1',
        name: 'VK',
        identifier: 'vk',
        picture: '',
        disabled: false,
        refreshNeeded: false,
        inBetweenSteps: false,
      },
    ];
    render(<MobilePostScreen />);
    expect(
      screen.queryByRole('link', { name: 'Подключить первый канал' })
    ).toBeNull();
    expect(
      screen.getByText('Быстрый пост появится в следующем обновлении.')
    ).toBeTruthy();
  });
});
