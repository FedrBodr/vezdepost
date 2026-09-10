// @vitest-environment jsdom
import { act } from '@testing-library/react';
import React from 'react';
import { hydrateRoot, Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const russianTranslations = {
  joinOver: 'Присоединяйтесь к',
  entrepreneursCount: '20 000+ предпринимателей',
  whoUse: 'которые используют',
  postizGrowSocial: 'Postiz для роста своей социальной активности',
};

const normalizedText = (element: Element) =>
  element.textContent?.replace(/\s+/g, ' ').trim();

describe('AuthSocialProof request locale hydration', () => {
  let root: Root | undefined;

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = undefined;
    }
    document.body.innerHTML = '';
    document.documentElement.lang = 'en';
    document.cookie = 'i18next=; Max-Age=0; Path=/';
    vi.restoreAllMocks();
  });

  it('renders and hydrates a first Russian request without English content', async () => {
    document.cookie = 'i18next=; Max-Age=0; Path=/';
    document.documentElement.lang = 'ru';

    const [{ default: i18next }, { AuthSocialProof }] = await Promise.all([
      import('@gitroom/react/translation/i18next'),
      import('./auth.social-proof'),
    ]);
    if (!i18next.isInitialized) {
      await new Promise<void>((resolve) => {
        const handleInitialized = () => {
          i18next.off('initialized', handleInitialized);
          resolve();
        };
        i18next.on('initialized', handleInitialized);
      });
    }

    expect(i18next.resolvedLanguage).toBe('ru');

    const component = (
      <AuthSocialProof
        initialLanguage="ru"
        initialTranslations={russianTranslations}
      />
    );
    const container = document.createElement('div');
    container.innerHTML = renderToString(component);
    document.body.appendChild(container);

    expect(normalizedText(container)).toBe(
      'Присоединяйтесь к 20 000+ предпринимателей которые используют Postiz для роста своей социальной активности'
    );

    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    await act(async () => {
      root = hydrateRoot(container, component);
    });

    expect(normalizedText(container)).toBe(
      'Присоединяйтесь к 20 000+ предпринимателей которые используют Postiz для роста своей социальной активности'
    );
    expect(
      consoleError.mock.calls.some(([message]) =>
        String(message).toLowerCase().includes('hydration')
      )
    ).toBe(false);
  });
});
