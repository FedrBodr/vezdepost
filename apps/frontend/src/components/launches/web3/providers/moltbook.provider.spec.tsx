// @vitest-environment jsdom
import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MoltbookProvider } from './moltbook.provider';

const mocks = vi.hoisted(() => ({ fetcher: vi.fn(), show: vi.fn() }));
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mocks.fetcher,
}));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: mocks.show }),
}));
vi.mock('@gitroom/react/form/input', () => ({
  Input: ({
    value,
    onChange,
    placeholder,
    name,
  }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      aria-label={name}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
    />
  ),
}));
vi.mock('@gitroom/react/form/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

const response = (body: unknown, ok = true) => ({
  ok,
  json: vi.fn().mockResolvedValue(body),
});
const fillAndRegister = () => {
  fireEvent.change(screen.getByLabelText('agentName'), {
    target: { value: 'MyAgent' },
  });
  fireEvent.click(screen.getByRole('button', { name: /create agent/i }));
};

describe('MoltbookProvider claim guide', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('explains registration and owner verification before creating an agent', () => {
    render(<MoltbookProvider onComplete={vi.fn()} nonce="nonce_123" />);
    expect(screen.getByText(/creates a Moltbook agent/i)).not.toBeNull();
    expect(screen.getByText(/owner must claim/i)).not.toBeNull();
  });

  it('opens a validated claim URL and posts the secret in the status body', async () => {
    mocks.fetcher
      .mockResolvedValueOnce(
        response({
          apiKey: 'secret-key',
          claimUrl: 'https://www.moltbook.com/claim/token',
        })
      )
      .mockResolvedValueOnce(response({ claimed: true }));
    const onComplete = vi.fn();
    render(<MoltbookProvider onComplete={onComplete} nonce="nonce_123" />);
    fillAndRegister();
    expect(
      await screen.findByRole('link', { name: /open claim page/i })
    ).not.toBeNull();
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith('secret-key', 'nonce_123')
    );
    expect(mocks.fetcher).toHaveBeenNthCalledWith(
      2,
      '/integrations/moltbook/status',
      {
        method: 'POST',
        body: JSON.stringify({ apiKey: 'secret-key' }),
      }
    );
    expect(document.body.textContent).not.toContain('secret-key');
  });

  it('rejects an untrusted claim URL without exposing upstream details', async () => {
    mocks.fetcher.mockResolvedValueOnce(
      response({
        apiKey: 'secret-key',
        claimUrl: 'https://evil.test/claim/token',
      })
    );
    render(<MoltbookProvider onComplete={vi.fn()} nonce="nonce_123" />);
    fillAndRegister();
    expect(
      await screen.findByText(
        'Moltbook returned an invalid claim link. Try again.'
      )
    ).not.toBeNull();
    expect(mocks.fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses a safe registration error', async () => {
    mocks.fetcher.mockResolvedValueOnce(
      response({ error: 'upstream secret details' }, false)
    );
    render(<MoltbookProvider onComplete={vi.fn()} nonce="nonce_123" />);
    fillAndRegister();
    expect(
      await screen.findByText('Could not create the Moltbook agent. Try again.')
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain('upstream secret details');
  });

  it('times out after two minutes and can check again', async () => {
    vi.useFakeTimers();
    mocks.fetcher
      .mockResolvedValueOnce(
        response({
          apiKey: 'secret-key',
          claimUrl: 'https://www.moltbook.com/claim/token',
        })
      )
      .mockResolvedValue(response({ claimed: false }));
    render(<MoltbookProvider onComplete={vi.fn()} nonce="nonce_123" />);
    fillAndRegister();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(123_000);
    });
    expect(
      screen.getByText('We have not received the claim confirmation yet.')
    ).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /check again/i }));
    expect(mocks.fetcher).toHaveBeenLastCalledWith(
      '/integrations/moltbook/status',
      expect.any(Object)
    );
  });

  it('ignores claim success after unmount', async () => {
    let resolveStatus!: (value: ReturnType<typeof response>) => void;
    mocks.fetcher
      .mockResolvedValueOnce(
        response({
          apiKey: 'secret-key',
          claimUrl: 'https://www.moltbook.com/claim/token',
        })
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveStatus = resolve;
        })
      );
    const onComplete = vi.fn();
    const view = render(
      <MoltbookProvider onComplete={onComplete} nonce="nonce_123" />
    );
    fillAndRegister();
    await screen.findByRole('link', { name: /open claim page/i });
    view.unmount();
    await act(async () => {
      resolveStatus(response({ claimed: true }));
      await Promise.resolve();
    });
    expect(onComplete).not.toHaveBeenCalled();
  });
});
