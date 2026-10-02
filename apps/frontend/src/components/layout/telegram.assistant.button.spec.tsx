// @vitest-environment jsdom
import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramAssistantButton } from './telegram.assistant.button';

const mocks = vi.hoisted(() => ({ fetcher: vi.fn() }));
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mocks.fetcher,
}));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

describe('TelegramAssistantButton', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('opens the bot deep link in a tab opened on click', async () => {
    const tab = { location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as any);
    mocks.fetcher.mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://t.me/vezde_post_bot?start=code' }),
    });

    render(<TelegramAssistantButton />);
    fireEvent.click(
      screen.getByRole('button', { name: /Постить из Telegram/ })
    );

    expect(open).toHaveBeenCalledWith('', '_blank');
    await waitFor(() =>
      expect(tab.location.href).toBe('https://t.me/vezde_post_bot?start=code')
    );
    expect(mocks.fetcher).toHaveBeenCalledWith('/telegram-assistant/link', {
      method: 'POST',
    });
  });

  it('closes the blank tab when the link cannot be created', async () => {
    const tab = { location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    mocks.fetcher.mockRejectedValue(new Error('offline'));

    render(<TelegramAssistantButton />);
    fireEvent.click(
      screen.getByRole('button', { name: /Постить из Telegram/ })
    );

    await waitFor(() => expect(tab.close).toHaveBeenCalled());
  });

  it('closes the blank tab on an error response', async () => {
    const tab = { location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    mocks.fetcher.mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Forbidden' }),
    });

    render(<TelegramAssistantButton />);
    fireEvent.click(
      screen.getByRole('button', { name: /Постить из Telegram/ })
    );

    await waitFor(() => expect(tab.close).toHaveBeenCalled());
    expect(tab.location.href).toBe('');
  });
});
