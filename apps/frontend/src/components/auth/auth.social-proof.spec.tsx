// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import i18next from '@gitroom/react/translation/i18next';
import { AuthSocialProof } from './auth.social-proof';

describe('AuthSocialProof', () => {
  beforeEach(async () => {
    await act(async () => {
      await i18next.changeLanguage('en');
    });
  });

  it('reacts to language changes using existing social-proof keys', async () => {
    render(<AuthSocialProof />);
    expect(
      screen
        .getByTestId('auth-social-proof')
        .textContent?.replace(/\s+/g, ' ')
        .trim()
    ).toBe(
      'Join Over 20,000+ Entrepreneurs who use Postiz To Grow Their Social Presence'
    );

    await act(async () => {
      await i18next.changeLanguage('ru');
    });
    expect(
      screen
        .getByTestId('auth-social-proof')
        .textContent?.replace(/\s+/g, ' ')
        .trim()
    ).toBe(
      'Присоединяйтесь к 20 000+ предпринимателей которые используют Postiz для роста своей социальной активности'
    );
  });
});
