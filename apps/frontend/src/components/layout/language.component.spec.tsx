// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { readFileSync } from 'node:fs';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18next from '@gitroom/react/translation/i18next';
import { ModalManager } from './new-modal';
import {
  ChangeLanguageComponent,
  LanguageComponent,
} from './language.component';

const source = readFileSync(
  'apps/frontend/src/components/layout/language.component.tsx',
  'utf8'
);

afterEach(cleanup);

describe('language selector', () => {
  beforeEach(async () => {
    document.cookie = 'i18next=; Max-Age=0; Path=/';
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    await act(async () => {
      await i18next.changeLanguage('en');
    });
  });

  it('opens a viewport-safe named dialog from a native 44px trigger', async () => {
    render(
      <ModalManager>
        <LanguageComponent />
      </ModalManager>
    );
    const trigger = screen.getByRole('button', { name: 'Change Language' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.className).toContain('h-[44px]');
    expect(trigger.className).toContain('w-[44px]');

    fireEvent.click(trigger);
    await screen.findByRole('dialog', {
      name: 'Change Language',
    });
    expect(source).toContain("size: 'min(600px, calc(100vw - 24px))'");
    expect(screen.getByRole('button', { name: 'Close' })).not.toBeNull();
  });

  it('renders native responsive options with selected state', () => {
    const { container } = render(
      <ModalManager>
        <ChangeLanguageComponent />
      </ModalManager>
    );
    const english = container.querySelector<HTMLButtonElement>(
      'button[data-language="en"]'
    );
    const grid = container.querySelector('[data-language-grid]');

    expect(english).not.toBeNull();
    expect(english?.getAttribute('type')).toBe('button');
    expect(english?.getAttribute('aria-pressed')).toBe('true');
    expect(grid?.className).toContain('grid-cols-2');
    expect(grid?.className).toContain('sm:grid-cols-4');
  });

  it('persists Arabic and updates i18next, lang, and RTL direction', async () => {
    const { container } = render(
      <ModalManager>
        <ChangeLanguageComponent />
      </ModalManager>
    );
    const arabic = container.querySelector<HTMLButtonElement>(
      'button[data-language="ar"]'
    );
    expect(arabic).not.toBeNull();
    fireEvent.click(arabic!);

    await waitFor(() => expect(i18next.resolvedLanguage).toBe('ar'));
    expect(document.cookie).toContain('i18next=ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });
});
