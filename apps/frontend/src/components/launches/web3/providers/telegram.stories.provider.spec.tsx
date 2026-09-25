// @vitest-environment jsdom
import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramStoriesProvider } from './telegram.stories.provider';
import { buildTelegramStoriesStartLink } from './telegram.stories.connection';
import { isStoriesProviderVisible } from '../../use.telegram.stories.availability';

const mocks = vi.hoisted(() => ({ fetcher: vi.fn() }));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mocks.fetcher,
}));
vi.mock('@gitroom/helpers/utils/timer', () => ({
  timer: () => Promise.resolve(),
}));
vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ telegramBotName: '@vezdepost_bot' }),
}));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@gitroom/react/form/button', () => ({
  Button: ({
    children,
    onClick,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

const response = (body: unknown) => ({
  json: vi.fn().mockResolvedValue(body),
});

describe('Telegram Stories connection wizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it('builds a private start link', () => {
    expect(buildTelegramStoriesStartLink('@vezdepost_bot', 'abc')).toBe(
      'https://t.me/vezdepost_bot?start=abc'
    );
  });

  it('completes with the nonce when the connection is ready', async () => {
    const onComplete = vi.fn();
    mocks.fetcher
      .mockResolvedValueOnce(response({ status: 'waiting_business' }))
      .mockResolvedValueOnce(response({ status: 'ready' }));

    render(<TelegramStoriesProvider nonce="abc" onComplete={onComplete} />);
    fireEvent.click(
      screen.getByRole('link', { name: 'Open the bot in Telegram' })
    );

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('abc', 'abc'));
    expect(mocks.fetcher).toHaveBeenCalledWith(
      '/integrations/telegram-stories/updates?word=abc'
    );
  });

  it('stops and explains a missing stories right', async () => {
    const onComplete = vi.fn();
    mocks.fetcher.mockResolvedValue(
      response({ status: 'missing_stories_right' })
    );

    render(<TelegramStoriesProvider nonce="abc" onComplete={onComplete} />);
    fireEvent.click(
      screen.getByRole('link', { name: 'Open the bot in Telegram' })
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Manage stories'
    );
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('explains how to resend the connection while waiting for Telegram Business', async () => {
    let calls = 0;
    mocks.fetcher.mockImplementation(() => {
      calls += 1;
      return calls === 1
        ? Promise.resolve(response({ status: 'waiting_business' }))
        : new Promise(() => undefined);
    });

    render(<TelegramStoriesProvider nonce="abc" onComplete={vi.fn()} />);
    fireEvent.click(
      screen.getByRole('link', { name: 'Open the bot in Telegram' })
    );

    expect(
      await screen.findByText(/switch "Manage stories" off and on/)
    ).not.toBeNull();
  });
});

describe('isStoriesProviderVisible', () => {
  it('hides Telegram Stories unless the organization has access', () => {
    expect(isStoriesProviderVisible('telegram-stories', undefined)).toBe(false);
    expect(isStoriesProviderVisible('telegram-stories', false)).toBe(false);
    expect(isStoriesProviderVisible('telegram-stories', true)).toBe(true);
    expect(isStoriesProviderVisible('telegram', false)).toBe(true);
  });
});
