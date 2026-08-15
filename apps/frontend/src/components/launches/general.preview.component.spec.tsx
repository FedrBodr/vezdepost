// @vitest-environment jsdom

import { render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlatformCapabilities } from '@gitroom/helpers/utils/platform.capabilities';

const previewContext = vi.hoisted(() => ({
  current: 'integration',
  identifier: 'max',
  maximumCharacters: 10,
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
        identifier: previewContext.identifier,
        name: 'MAX',
        display: '@account',
        picture: '/account.jpg',
        capabilities: {
          ...getPlatformCapabilities(previewContext.identifier),
          text: { max: previewContext.maximumCharacters },
        },
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
vi.mock('@gitroom/react/helpers/safe.image', () => ({
  default: (): null => null,
}));
vi.mock('@gitroom/frontend/components/new-launch/store', () => ({
  useLaunchStore: (selector: (state: { current: string }) => unknown) =>
    selector({ current: previewContext.current }),
}));

import { GeneralPreviewComponent } from './general.preview.component';

vi.stubGlobal('React', React);

const renderPreview = (content: string) => {
  previewContext.value = [{ content, image: [] }];
  const { container } = render(<GeneralPreviewComponent />);
  return container.querySelector<HTMLElement>('.preview')!;
};

beforeEach(() => {
  previewContext.current = 'integration';
  previewContext.identifier = 'max';
  previewContext.maximumCharacters = 10;
  previewContext.value = [];
});

describe('GeneralPreviewComponent content safety', () => {
  it('sanitizes hostile attributes and URL protocols after normalization', () => {
    previewContext.maximumCharacters = 1_000;
    const preview = renderPreview(
      '<p onclick="alert(1)" style="color:red">Hello ' +
        '<span data-mention-id="1" onclick="alert(2)" style="color:red">@Ada</span> ' +
        '<a href="javascript:alert(3)" onclick="alert(4)" style="color:red">unsafe</a> ' +
        '<a href="https://example.com">safe</a></p>'
    );

    expect(preview.querySelector('[onclick]')).toBeNull();
    expect(preview.querySelector('[style]')).toBeNull();
    expect(preview.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(preview.querySelectorAll('a')[1]?.getAttribute('href')).toBe(
      'https://example.com'
    );
    expect(preview.querySelector('.font-bold')?.textContent).toBe('@Ada');
  });

  it('preserves safe Telegram bold markup after normalization', () => {
    previewContext.identifier = 'telegram';
    previewContext.maximumCharacters = 100;

    const preview = renderPreview('<p><strong>safe bold</strong></p>');

    expect(preview.querySelector('b')?.textContent).toBe('safe bold');
  });
});

describe('GeneralPreviewComponent visible-length cropping', () => {
  it('does not crop formatted HTML at the visible-character boundary', () => {
    const preview = renderPreview(`<p><strong>${'x'.repeat(10)}</strong></p>`);

    expect(preview.textContent).toBe('x'.repeat(10));
    expect(preview.querySelector('strong')?.textContent).toBe('x'.repeat(10));
    expect(preview.querySelector('mark')).toBeNull();
  });

  it('renders a valid plain-text crop marker for formatted over-limit HTML', () => {
    const preview = renderPreview(`<p><strong>${'x'.repeat(11)}</strong></p>`);

    expect(preview.textContent).toBe('x'.repeat(11));
    expect(preview.innerHTML).toContain('<mark');
    expect(preview.querySelector('mark')?.textContent).toBe('x');
    expect(preview.querySelector('mark')?.dataset.tooltipContent).toBe(
      'This text will be cropped'
    );
  });
});
