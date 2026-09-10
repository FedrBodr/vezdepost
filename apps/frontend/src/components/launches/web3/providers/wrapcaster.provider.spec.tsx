// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18next from '@gitroom/react/translation/i18next';
import { WrapcasterProvider } from './wrapcaster.provider';

vi.mock(
  '@gitroom/frontend/components/auth/providers/farcaster.provider',
  () => ({
    ButtonCaster: ({ login }: { login: (code: string) => void }) => (
      <button type="button" onClick={() => login('signer-code')}>
        Connect Farcaster
      </button>
    ),
  })
);
vi.mock('@gitroom/frontend/components/layout/loading', () => ({
  LoadingComponent: () => <div>Connecting…</div>,
}));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

describe('WrapcasterProvider connection guide', () => {
  afterEach(cleanup);

  it('explains approval and secret safety before sign-in', () => {
    render(
      <WrapcasterProvider onComplete={vi.fn()} nonce="client||state_123" />
    );
    expect(screen.getByText(/select Connect Farcaster/i)).not.toBeNull();
    expect(screen.getByText(/approve the signer/i)).not.toBeNull();
    expect(
      screen.getByText(/never enter your password or recovery phrase/i)
    ).not.toBeNull();
  });

  it('forwards the signer code and original state then shows loading', () => {
    const onComplete = vi.fn();
    render(
      <WrapcasterProvider onComplete={onComplete} nonce="client||state_123" />
    );
    fireEvent.click(screen.getByRole('button', { name: /connect farcaster/i }));
    expect(onComplete).toHaveBeenCalledWith('signer-code', 'state_123');
    expect(screen.getByText('Connecting…')).not.toBeNull();
  });

  it('ships the connection guide in English and Russian', async () => {
    const keys = [
      'farcaster_connection_intro',
      'farcaster_connection_select',
      'farcaster_connection_approve',
      'farcaster_connection_secret_warning',
    ];

    for (const language of ['en', 'ru']) {
      await i18next.changeLanguage(language);
      keys.forEach((key) => expect(i18next.exists(key), key).toBe(true));
    }
  });
});
