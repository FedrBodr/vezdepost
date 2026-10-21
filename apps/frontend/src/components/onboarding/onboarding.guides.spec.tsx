// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@gitroom/frontend/components/layout/telegram.assistant.button', () => ({
  TelegramAssistantButton: () => <button type="button">Telegram bot</button>,
}));
vi.mock('@gitroom/frontend/components/layout/max.assistant.button', () => ({
  MaxAssistantButton: (): null => null,
}));

import {
  OnboardingChannelHint,
  OnboardingDoneStep,
} from './onboarding.guides';

describe('onboarding guides', () => {
  afterEach(cleanup);

  it('links the Telegram, MAX and VK guides on the blog', () => {
    render(<OnboardingChannelHint />);

    expect(screen.getByRole('link', { name: 'Telegram' }).getAttribute('href')).toBe(
      'https://vezdepost.ru/blog/otlozhennyj-post-v-telegram/'
    );
    expect(screen.getByRole('link', { name: 'MAX' }).getAttribute('href')).toBe(
      'https://vezdepost.ru/blog/otlozhennyj-post-v-max/'
    );
    expect(screen.getByRole('link', { name: 'VK' }).getAttribute('href')).toBe(
      'https://vezdepost.ru/blog/otlozhennye-posty-vk/'
    );
  });

  it('offers the messenger bot and finishes onboarding', () => {
    const onFinish = vi.fn();
    const onBack = vi.fn();
    render(<OnboardingDoneStep onBack={onBack} onFinish={onFinish} />);

    expect(screen.getByRole('button', { name: 'Telegram bot' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Get Started' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
