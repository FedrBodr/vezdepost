// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import copy from 'copy-to-clipboard';
import { TelegramProvider } from './telegram.provider';

const mocks = vi.hoisted(() => ({
  fetcher: vi.fn(),
  show: vi.fn(),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mocks.fetcher,
}));

vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ telegramBotName: 'vezdepost_bot' }),
}));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mocks.show }),
}));

vi.mock('@gitroom/react/form/button', () => ({
  Button: ({
    children,
    secondary: _secondary,
    loading: _loading,
    innerClassName: _innerClassName,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    secondary?: boolean;
    loading?: boolean;
    innerClassName?: string;
  }) => <button {...props}>{children}</button>,
}));

vi.mock('copy-to-clipboard', () => ({
  default: vi.fn(() => true),
}));

const response = (body: unknown) => ({
  json: vi.fn().mockResolvedValue(body),
});

describe('TelegramProvider connection guide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetcher.mockImplementation(
      () => new Promise<Response>(() => undefined)
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('starts with group and channel choices', () => {
    render(<TelegramProvider onComplete={vi.fn()} nonce="nonce_123" />);

    expect(screen.getByRole('button', { name: /group/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /channel/i })).not.toBeNull();
  });

  it('opens the group deep link and never shows a command', () => {
    render(<TelegramProvider onComplete={vi.fn()} nonce="nonce_123" />);

    fireEvent.click(screen.getByRole('button', { name: /group/i }));

    expect(
      screen
        .getByRole('link', { name: /open telegram and choose a group/i })
        .getAttribute('href')
    ).toBe(
      'https://t.me/vezdepost_bot?startgroup=nonce_123&admin=manage_chat'
    );
    expect(screen.queryByRole('button', { name: /copy command/i })).toBeNull();
    expect(
      screen.queryByText(
        'Copy this command and publish it once in the selected channel.'
      )
    ).toBeNull();
  });

  it('shows and copies the exact command after choosing a channel', () => {
    render(<TelegramProvider onComplete={vi.fn()} nonce="nonce_123" />);

    fireEvent.click(screen.getByRole('button', { name: /channel/i }));

    expect(screen.getAllByText('/connect nonce_123')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /copy command/i }));
    expect(copy).toHaveBeenCalledWith('/connect nonce_123');
    expect(mocks.show).toHaveBeenCalledWith('Command copied', 'success');
  });

  it('completes only a verified ready response', async () => {
    const onComplete = vi.fn();
    mocks.fetcher.mockResolvedValueOnce(
      response({ status: 'ready', chatId: -1001 })
    );
    render(<TelegramProvider onComplete={onComplete} nonce="nonce_123" />);

    fireEvent.click(screen.getByRole('button', { name: /group/i }));
    fireEvent.click(
      screen.getByRole('link', { name: /open telegram and choose a group/i })
    );

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith('-1001', 'nonce_123');
    });
  });

  it('rechecks a candidate chat without requiring another command', async () => {
    const onComplete = vi.fn();
    mocks.fetcher
      .mockResolvedValueOnce(
        response({ status: 'bot_not_admin', candidateChatId: -1001 })
      )
      .mockResolvedValueOnce(response({ status: 'ready', chatId: -1001 }));
    render(<TelegramProvider onComplete={onComplete} nonce="nonce_123" />);

    fireEvent.click(screen.getByRole('button', { name: /group/i }));
    fireEvent.click(
      screen.getByRole('link', { name: /open telegram and choose a group/i })
    );

    expect(
      await screen.findByText('The bot was added but is not an administrator.')
    ).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /check again/i }));

    await waitFor(() => {
      expect(mocks.fetcher).toHaveBeenLastCalledWith(
        expect.stringContaining('chatId=-1001')
      );
      expect(onComplete).toHaveBeenCalledWith('-1001', 'nonce_123');
    });
  });

  it('explains a missing channel posting permission', async () => {
    mocks.fetcher.mockResolvedValueOnce(
      response({
        status: 'missing_post_permission',
        candidateChatId: -1001,
      })
    );
    render(<TelegramProvider onComplete={vi.fn()} nonce="nonce_123" />);

    fireEvent.click(screen.getByRole('button', { name: /channel/i }));
    fireEvent.click(
      screen.getByRole('link', { name: /open telegram and choose a channel/i })
    );

    expect(
      await screen.findByText(
        'The bot cannot publish. Enable its permission to post messages.'
      )
    ).not.toBeNull();
  });

  it('turns a Telegram request failure into a retry state', async () => {
    mocks.fetcher.mockRejectedValueOnce(new Error('network failed'));
    render(<TelegramProvider onComplete={vi.fn()} nonce="nonce_123" />);

    fireEvent.click(screen.getByRole('button', { name: /group/i }));
    fireEvent.click(
      screen.getByRole('link', { name: /open telegram and choose a group/i })
    );

    expect(
      await screen.findByText('Telegram did not respond. Try checking again.')
    ).not.toBeNull();
    expect(screen.getByRole('button', { name: /check again/i })).not.toBeNull();
  });

  it('ignores a ready response after unmount', async () => {
    let resolveRequest!: (value: ReturnType<typeof response>) => void;
    mocks.fetcher.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );
    const onComplete = vi.fn();
    const view = render(
      <TelegramProvider onComplete={onComplete} nonce="nonce_123" />
    );
    fireEvent.click(screen.getByRole('button', { name: /group/i }));
    fireEvent.click(
      screen.getByRole('link', { name: /open telegram and choose a group/i })
    );

    view.unmount();
    await act(async () => {
      resolveRequest(response({ status: 'ready', chatId: -1001 }));
      await Promise.resolve();
    });

    expect(onComplete).not.toHaveBeenCalled();
  });

  it('stops waiting after ninety seconds and offers a retry', async () => {
    vi.useFakeTimers();
    mocks.fetcher.mockResolvedValue(response({ status: 'waiting' }));
    render(<TelegramProvider onComplete={vi.fn()} nonce="nonce_123" />);

    fireEvent.click(screen.getByRole('button', { name: /group/i }));
    fireEvent.click(
      screen.getByRole('link', { name: /open telegram and choose a group/i })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(92_000);
    });

    expect(
      screen.getByText('We have not received confirmation yet.')
    ).not.toBeNull();
    expect(screen.getByRole('button', { name: /check again/i })).not.toBeNull();
  });
});
