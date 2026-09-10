// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import copy from 'copy-to-clipboard';
import { MaxProvider } from './max.provider';

const mocks = vi.hoisted(() => ({ fetcher: vi.fn(), show: vi.fn() }));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mocks.fetcher,
}));
vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ maxBotName: '@vezdepost_bot' }),
}));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mocks.show }),
}));
vi.mock('@gitroom/react/form/button', () => ({
  Button: ({ children, onClick, disabled, type }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));
vi.mock('copy-to-clipboard', () => ({ default: vi.fn(() => true) }));

const response = (body: unknown) => ({ json: vi.fn().mockResolvedValue(body) });

describe('MaxProvider connection guide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetcher.mockImplementation(() => new Promise<Response>(() => undefined));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('starts with group and channel choices', () => {
    render(<MaxProvider onComplete={vi.fn()} nonce="nonce_123" />);
    expect(screen.getByRole('button', { name: /group/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /channel/i })).not.toBeNull();
  });

  it('shows the bot, permissions, and command before polling', () => {
    render(<MaxProvider onComplete={vi.fn()} nonce="nonce_123" />);
    fireEvent.click(screen.getByRole('button', { name: /group/i }));
    expect(screen.getByRole('link', { name: /open the vezdepost bot/i }).getAttribute('href')).toBe('https://max.ru/vezdepost_bot');
    expect(screen.getByText(/read all messages and write messages/i)).not.toBeNull();
    expect(screen.getAllByText('/connect nonce_123').length).toBeGreaterThan(0);
    expect(mocks.fetcher).not.toHaveBeenCalled();
  });

  it('copies the exact command', () => {
    render(<MaxProvider onComplete={vi.fn()} nonce="nonce_123" />);
    fireEvent.click(screen.getByRole('button', { name: /channel/i }));
    fireEvent.click(screen.getByRole('button', { name: /copy command/i }));
    expect(copy).toHaveBeenCalledWith('/connect nonce_123');
  });

  it('completes a verified connection', async () => {
    mocks.fetcher.mockResolvedValueOnce(response({ status: 'ready', chatId: 321 }));
    const onComplete = vi.fn();
    render(<MaxProvider onComplete={onComplete} nonce="nonce_123" />);
    fireEvent.click(screen.getByRole('button', { name: /group/i }));
    fireEvent.click(screen.getByRole('button', { name: /check connection/i }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('321', 'nonce_123'));
  });

  it('rechecks a discovered chat after fixing administrator status', async () => {
    mocks.fetcher
      .mockResolvedValueOnce(response({ status: 'bot_not_admin', candidateChatId: 321 }))
      .mockResolvedValueOnce(response({ status: 'ready', chatId: 321 }));
    const onComplete = vi.fn();
    render(<MaxProvider onComplete={onComplete} nonce="nonce_123" />);
    fireEvent.click(screen.getByRole('button', { name: /group/i }));
    fireEvent.click(screen.getByRole('button', { name: /check connection/i }));
    expect(await screen.findByText('The bot is not an administrator yet.')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /check again/i }));
    await waitFor(() => {
      expect(mocks.fetcher).toHaveBeenLastCalledWith(expect.stringContaining('chatId=321'));
      expect(onComplete).toHaveBeenCalledWith('321', 'nonce_123');
    });
  });

  it('explains missing MAX permissions', async () => {
    mocks.fetcher.mockResolvedValueOnce(response({ status: 'missing_permissions', candidateChatId: 321 }));
    render(<MaxProvider onComplete={vi.fn()} nonce="nonce_123" />);
    fireEvent.click(screen.getByRole('button', { name: /channel/i }));
    fireEvent.click(screen.getByRole('button', { name: /check connection/i }));
    expect(await screen.findByText('Enable permission to read all messages and write messages.')).not.toBeNull();
  });

  it('ignores a response after unmount', async () => {
    let resolveRequest!: (value: ReturnType<typeof response>) => void;
    mocks.fetcher.mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve; }));
    const onComplete = vi.fn();
    const view = render(<MaxProvider onComplete={onComplete} nonce="nonce_123" />);
    fireEvent.click(screen.getByRole('button', { name: /group/i }));
    fireEvent.click(screen.getByRole('button', { name: /check connection/i }));
    view.unmount();
    await act(async () => {
      resolveRequest(response({ status: 'ready', chatId: 321 }));
      await Promise.resolve();
    });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('times out after ninety seconds and offers retry', async () => {
    vi.useFakeTimers();
    mocks.fetcher.mockResolvedValue(response({ status: 'waiting' }));
    render(<MaxProvider onComplete={vi.fn()} nonce="nonce_123" />);
    fireEvent.click(screen.getByRole('button', { name: /group/i }));
    fireEvent.click(screen.getByRole('button', { name: /check connection/i }));
    await act(async () => { await vi.advanceTimersByTimeAsync(92_000); });
    expect(screen.getByText('We have not received confirmation from MAX yet.')).not.toBeNull();
    expect(screen.getByRole('button', { name: /check again/i })).not.toBeNull();
  });
});
