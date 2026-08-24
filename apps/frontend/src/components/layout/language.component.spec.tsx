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
import { languages } from '@gitroom/react/translation/i18n.config';
import { ModalManager } from './new-modal';
import {
  ChangeLanguageComponent,
  LanguageComponent,
} from './language.component';

const source = readFileSync(
  'apps/frontend/src/components/layout/language.component.tsx',
  'utf8'
);
const globalStyles = readFileSync('apps/frontend/src/app/global.scss', 'utf8');

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
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Change Language' })
      ).toBeNull()
    );
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

  it('uses theme focus rings that remain visible despite the global outline reset', () => {
    const { container } = render(
      <ModalManager>
        <LanguageComponent />
        <ChangeLanguageComponent />
      </ModalManager>
    );
    const trigger = screen.getByRole('button', { name: 'Change Language' });
    const options = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[data-language]')
    );

    expect(globalStyles).toMatch(
      /body\s+\*\s*{[^}]*outline:\s*none\s*!important;/
    );
    expect(options).toHaveLength(languages.length);

    for (const button of [trigger, ...options]) {
      expect(button.className).toContain('focus-visible:ring-2');
      expect(button.className).toContain('focus-visible:ring-textColor');
      expect(button.className).toContain('focus-visible:ring-offset-2');
      expect(button.className).toContain(
        'focus-visible:ring-offset-newBgColorInner'
      );
      expect(button.className).not.toContain('focus-visible:outline');
      expect(button.className).toContain('disabled:opacity-60');
    }

    const selected = options.find(
      (button) => button.getAttribute('aria-pressed') === 'true'
    );
    expect(selected?.className).toContain('border-textColor');
  });

  it('persists Arabic, updates root locale state, and closes the dialog', async () => {
    render(
      <ModalManager>
        <LanguageComponent />
      </ModalManager>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Change Language' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Change Language',
    });
    const arabic = dialog.querySelector<HTMLButtonElement>(
      'button[data-language="ar"]'
    );
    expect(arabic).not.toBeNull();
    fireEvent.click(arabic!);

    await waitFor(() => expect(i18next.resolvedLanguage).toBe('ar'));
    expect(document.cookie).toContain('i18next=ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Change Language' })
      ).toBeNull()
    );
  });
});
