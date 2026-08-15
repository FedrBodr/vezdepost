// @vitest-environment jsdom

import { render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const previewContext = vi.hoisted(() => ({
  value: [] as Array<{
    content: string;
    image: Array<{ id: string; path: string }>;
  }>,
}));

vi.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration',
  () => ({
    useIntegration: () => ({
      value: previewContext.value,
      integration: {
        identifier: 'pinterest',
        name: 'Pinterest account',
        picture: '/account.jpg',
      },
    }),
  })
);
vi.mock('@gitroom/react/helpers/use.media.directory', () => ({
  useMediaDirectory: () => ({ set: (path: string) => path }),
}));
vi.mock('@gitroom/react/helpers/video.or.image', () => ({
  VideoOrImage: (): null => null,
}));

import { PinterestPreview } from './pinterest.preview';

vi.stubGlobal('React', React);

const hostileEncodedContent =
  '<p>abcdefghij' +
  '&lt;img src="x" onerror="alert(1)"&gt;' +
  '&lt;span class="fixed inset-0 z-[9999] hidden" style="position:fixed" ' +
  'data-tooltip-html="&lt;strong&gt;hostile&lt;/strong&gt;" ' +
  'data-hostile="true"&gt;redress&lt;/span&gt; ' +
  '&lt;a href="javascript:alert(2)"&gt;unsafe-link&lt;/a&gt; ' +
  '&lt;a href="https://example.com"&gt;safe-link&lt;/a&gt;</p>';

const renderPreview = (content: string, maximumCharacters = 10_000) => {
  previewContext.value = [{ content, image: [] }];
  return render(<PinterestPreview maximumCharacters={maximumCharacters} />)
    .container;
};

beforeEach(() => {
  previewContext.value = [];
});

describe('PinterestPreview content safety', () => {
  it('sanitizes encoded content and tooltip/class payloads', () => {
    const container = renderPreview(hostileEncodedContent, 10);
    const redress = Array.from(container.querySelectorAll('span')).find(
      (element) => element.textContent === 'redress'
    );

    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.querySelector('[data-tooltip-html]')).toBeNull();
    expect(container.querySelector('[data-hostile]')).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(
      container.querySelector('a[href="https://example.com"]')?.textContent
    ).toBe('safe-link');
    expect(redress?.hasAttribute('class')).toBe(false);
    expect(redress?.hasAttribute('style')).toBe(false);
  });

  it('preserves exact generated mention and crop decorations', () => {
    const mentionContainer = renderPreview(
      '<p><span data-mention-id="1">@Ada</span></p>'
    );
    const mention = Array.from(mentionContainer.querySelectorAll('span')).find(
      (element) => element.textContent === '@Ada'
    );

    expect(mention?.className).toBe('font-bold font-[arial] text-[#ae8afc]');

    const cropContainer = renderPreview('abcdefghijk', 10);
    const mark = cropContainer.querySelector('mark');

    expect(mark?.className).toBe('bg-red-500');
    expect(mark?.textContent).toBe('k');
    expect(mark?.dataset.tooltipContent).toBe('This text will be cropped');
  });
});
