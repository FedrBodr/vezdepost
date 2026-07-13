import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const integration = vi.hoisted(() => ({
  value: [] as Array<{
    content: string;
    image: Array<{ path: string }>;
  }>,
}));

vi.mock('../../../launches/general.preview.component', () => ({
  GeneralPreviewComponent: () => null,
}));
vi.mock('../../../launches/helpers/use.integration', () => ({
  useIntegration: () => integration,
}));

import {
  shouldShowTelegramSplitWarning,
  TelegramPreview,
} from './telegram.preview';

const post = (content: string, image: Array<{ path: string }> = []) => ({
  content,
  image,
});

describe('shouldShowTelegramSplitWarning', () => {
  it('is hidden for text-only posts', () => {
    expect(shouldShowTelegramSplitWarning([post('x'.repeat(1545))])).toBe(
      false
    );
  });

  it('is hidden at the caption boundary', () => {
    expect(
      shouldShowTelegramSplitWarning([
        post('x'.repeat(1024), [{ path: 'photo.jpg' }]),
      ])
    ).toBe(false);
  });

  it('is visible above the boundary when media exists', () => {
    expect(
      shouldShowTelegramSplitWarning([
        post('<p>' + 'x'.repeat(1025) + '</p>', [{ path: 'photo.jpg' }]),
      ])
    ).toBe(true);
  });

  it('does not count bold ASCII characters as surrogate-pair glyphs', () => {
    expect(
      shouldShowTelegramSplitWarning([
        post(`<p><strong>${'x'.repeat(600)}</strong></p>`, [
          { path: 'photo.jpg' },
        ]),
      ])
    ).toBe(false);
  });

  it('counts a link label instead of its URL', () => {
    expect(
      shouldShowTelegramSplitWarning([
        post(
          `<a href="https://example.com/${'x'.repeat(1100)}">short label</a>`,
          [{ path: 'photo.jpg' }]
        ),
      ])
    ).toBe(false);
  });

  it('uses decoded entity length at the caption boundary', () => {
    expect(
      shouldShowTelegramSplitWarning([
        post('&amp;'.repeat(1024), [{ path: 'photo.jpg' }]),
      ])
    ).toBe(false);
    expect(
      shouldShowTelegramSplitWarning([
        post('&amp;'.repeat(1025), [{ path: 'photo.jpg' }]),
      ])
    ).toBe(true);
  });

  it('is visible when only a later entry exceeds the limit with media', () => {
    expect(
      shouldShowTelegramSplitWarning([
        post('short', [{ path: 'first.jpg' }]),
        post('x'.repeat(1025), [{ path: 'second.jpg' }]),
      ])
    ).toBe(true);
  });
});

describe('TelegramPreview', () => {
  beforeEach(() => {
    integration.value = [];
  });

  it('renders the approved warning when media text will be split', () => {
    integration.value = [post('x'.repeat(1025), [{ path: 'photo.jpg' }])];

    const markup = renderToStaticMarkup(createElement(TelegramPreview));

    expect(markup).toContain(
      'Telegram ограничивает подпись к медиа 1024 символами.'
    );
    expect(markup).toContain(
      'Медиа и текст будут опубликованы двумя отдельными сообщениями.'
    );
  });
});
