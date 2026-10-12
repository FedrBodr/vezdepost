// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const search = vi.hoisted(() => ({ params: new URLSearchParams() }));
const show = vi.hoisted(() => vi.fn());
const fireEvents = vi.hoisted(() => vi.fn());
const goal = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useSearchParams: () => search.params,
}));
vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show }),
}));
vi.mock('@gitroom/helpers/utils/use.fire.events', () => ({
  useFireEvents: () => fireEvents,
}));
vi.mock('@gitroom/frontend/components/mobile/use.mobile.goal', () => ({
  useMobileGoal: () => goal,
}));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

import { MobileQueryNotice } from './mobile.query.notice';

beforeEach(() => {
  cleanup();
  show.mockClear();
  fireEvents.mockClear();
  goal.mockClear();
  search.params = new URLSearchParams();
  window.history.replaceState(null, '', '/m');
});

describe('MobileQueryNotice', () => {
  it('shows a connection error message from the OAuth return', () => {
    search.params = new URLSearchParams({ msg: 'Could not add provider' });
    window.history.replaceState(null, '', '/m?msg=Could%20not%20add%20provider');
    render(<MobileQueryNotice />);
    expect(show).toHaveBeenCalledWith('Could not add provider', 'warning');
    expect(fireEvents).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });

  it('confirms a new channel and records both goals', () => {
    search.params = new URLSearchParams({ added: 'vk', msg: 'Channel Updated' });
    window.history.replaceState(null, '', '/m?added=vk&msg=Channel%20Updated');
    render(<MobileQueryNotice />);
    expect(show).toHaveBeenCalledWith('Канал подключён', 'success');
    expect(fireEvents).toHaveBeenCalledWith('channel_added');
    expect(goal).toHaveBeenCalledWith('mobile_channel_added');
    expect(window.location.search).toBe('');
  });

  it('does nothing without query parameters', () => {
    render(<MobileQueryNotice />);
    expect(show).not.toHaveBeenCalled();
  });
});
