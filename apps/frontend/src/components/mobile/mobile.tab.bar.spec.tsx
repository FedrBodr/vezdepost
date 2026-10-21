// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pathname = vi.hoisted(() => ({ value: '/m' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.value }));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

import { MobileTabBar } from './mobile.tab.bar';

beforeEach(() => {
  cleanup();
  pathname.value = '/m';
});

describe('MobileTabBar', () => {
  it('renders the three tabs with their links', () => {
    render(<MobileTabBar />);
    expect(
      screen.getByRole('link', { name: 'Пост' }).getAttribute('href')
    ).toBe('/m');
    expect(
      screen.getByRole('link', { name: 'Посты' }).getAttribute('href')
    ).toBe('/m/queue');
    expect(
      screen.getByRole('link', { name: 'Каналы' }).getAttribute('href')
    ).toBe('/m/channels');
  });

  it('marks only the current tab as active', () => {
    pathname.value = '/m/channels';
    render(<MobileTabBar />);
    expect(
      screen.getByRole('link', { name: 'Каналы' }).getAttribute('aria-current')
    ).toBe('page');
    expect(
      screen.getByRole('link', { name: 'Пост' }).getAttribute('aria-current')
    ).toBeNull();
  });
});
