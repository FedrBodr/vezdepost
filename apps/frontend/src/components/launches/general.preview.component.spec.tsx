// @vitest-environment jsdom

import { render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlatformCapabilities } from '@gitroom/helpers/utils/platform.capabilities';

const previewContext = vi.hoisted(() => ({
  current: 'integration',
  identifier: 'max',
  maximumCharacters: 10,
  stripRawUrls: false,
  hasCapabilities: true,
  editor: 'html' as 'none' | 'normal' | 'markdown' | 'html',
  value: [] as Array<{
    content: string;
    image: Array<{ id: string; path: string }>;
  }>,
}));

vi.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration',
  () => ({
    useIntegration: () => {
      const capabilities = getPlatformCapabilities(previewContext.identifier);
      return {
        value: previewContext.value,
        integration: {
          identifier: previewContext.identifier,
          editor: previewContext.editor,
          stripLinks: previewContext.stripRawUrls,
          name: 'MAX',
          display: '@account',
          picture: '/account.jpg',
          ...(previewContext.hasCapabilities
            ? {
                capabilities: {
                  ...capabilities,
                  text: { max: previewContext.maximumCharacters },
                  delivery: {
                    ...capabilities.delivery,
                    stripRawUrls: previewContext.stripRawUrls,
                  },
                },
              }
            : {}),
        },
      };
    },
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

const renderPreview = (content: string, maximumCharacters?: number) => {
  previewContext.value = [{ content, image: [] }];
  const { container } = render(
    <GeneralPreviewComponent maximumCharacters={maximumCharacters} />
  );
  return container.querySelector<HTMLElement>('.preview')!;
};

beforeEach(() => {
  previewContext.current = 'integration';
  previewContext.identifier = 'max';
  previewContext.maximumCharacters = 10;
  previewContext.stripRawUrls = false;
  previewContext.hasCapabilities = true;
  previewContext.editor = 'html';
  previewContext.value = [];
});

describe('GeneralPreviewComponent content safety', () => {
  it('uses an active profile safely when serialized capabilities are missing', () => {
    previewContext.identifier = 'telegram';
    previewContext.hasCapabilities = false;
    previewContext.editor = 'none';

    const preview = renderPreview('<p><strong>safe bold</strong></p>', 5);

    expect(preview.querySelector('b')?.textContent).toBe('safe bold');
    expect(preview.querySelector('mark')).toBeNull();
  });

  it('uses the supplied legacy maximum and sanitizes when capabilities are missing', () => {
    previewContext.identifier = 'legacy-html';
    previewContext.hasCapabilities = false;
    previewContext.editor = 'html';

    const preview = renderPreview(
      '<p onclick="alert(1)"><strong>abcdefghijk</strong></p>',
      10
    );

    expect(preview.textContent).toBe('abcdefghijk');
    expect(preview.querySelector('mark')?.textContent).toBe('k');
    expect(preview.querySelector('[onclick]')).toBeNull();
  });

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

  it('removes source layout classes while preserving normalized safe links', () => {
    previewContext.maximumCharacters = 1_000;
    const preview = renderPreview(
      '<p><a href="https://example.com" class="fixed inset-0 z-[9999] hidden" ' +
        'style="position:fixed" data-tooltip-html="hostile" ' +
        'data-hostile="true">safe link</a></p>'
    );
    const link = preview.querySelector('a');

    expect(preview.querySelector('[data-tooltip-html]')).toBeNull();
    expect(preview.querySelector('[data-hostile]')).toBeNull();
    expect(preview.querySelector('[style]')).toBeNull();
    expect(link?.textContent).toBe('safe link');
    expect(link?.href).toBe('https://example.com/');
    expect(link?.hasAttribute('class')).toBe(false);
  });

  it('preserves safe Telegram bold markup after normalization', () => {
    previewContext.identifier = 'telegram';
    previewContext.maximumCharacters = 100;

    const preview = renderPreview('<p><strong>safe bold</strong></p>');

    expect(preview.querySelector('b')?.textContent).toBe('safe bold');
  });

  it.each([
    ['telegram', 'b'],
    ['max', 'strong'],
  ])(
    'renders %s escaped markup as inert visible text beside real formatting',
    (identifier, realFormattingTag) => {
      previewContext.identifier = identifier;
      previewContext.maximumCharacters = 1_000;

      const preview = renderPreview(
        '<p><strong>real</strong> &lt;b&gt;literal&lt;/b&gt; ' +
          '&lt;script&gt;alert&lt;/script&gt; &amp; &copy;</p>'
      );

      expect(preview.textContent).toBe(
        'real <b>literal</b> <script>alert</script> & ©'
      );
      expect(preview.querySelector(realFormattingTag)?.textContent).toBe(
        'real'
      );
      expect(preview.querySelectorAll(realFormattingTag)).toHaveLength(1);
      expect(preview.querySelector('script')).toBeNull();
    }
  );

  it.each(['telegram', 'max'])(
    'renders %s mention labels with special characters exactly once',
    (identifier) => {
      previewContext.identifier = identifier;
      previewContext.maximumCharacters = 1_000;

      const preview = renderPreview(
        '<p>Hello <span data-mention-id="1">@AT&amp;T &lt;B&gt;</span></p>'
      );

      expect(preview.textContent).toBe('Hello @AT&T <B>');
      expect(preview.querySelector('.font-bold')?.textContent).toBe(
        '@AT&T <B>'
      );
      expect(preview.querySelector('b')).toBeNull();
    }
  );
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

  it('crops only the eleventh ASCII character for X at a limit of ten', () => {
    previewContext.identifier = 'x';

    const preview = renderPreview('abcdefghijk');

    expect(preview.textContent).toBe('abcdefghijk');
    expect(preview.querySelector('mark')?.textContent).toBe('k');
    expect(preview.innerHTML).toMatch(/^abcdefghij<mark/);
  });

  it('uses effective stripped content in the non-cropped preview while preserving mentions', () => {
    previewContext.identifier = 'x';
    previewContext.maximumCharacters = 100;
    previewContext.stripRawUrls = true;

    const preview = renderPreview(
      '<p>Hello <span data-mention-id="ada">@Ada</span> https://example.com/path</p>'
    );

    expect(preview.textContent).toBe('Hello @Ada');
    expect(preview.querySelector('.font-bold')?.textContent).toBe('@Ada');
    expect(preview.innerHTML).not.toContain('https://');
  });

  it('uses effective stripped content before rendering the crop marker', () => {
    previewContext.identifier = 'x';
    previewContext.maximumCharacters = 10;
    previewContext.stripRawUrls = true;

    const preview = renderPreview('abcdefghijk https://example.com/path');

    expect(preview.textContent).toBe('abcdefghijk');
    expect(preview.querySelector('mark')?.textContent).toBe('k');
    expect(preview.innerHTML).not.toContain('https://');
  });

  it('preserves mention decoration when effective content is cropped', () => {
    previewContext.identifier = 'x';
    previewContext.maximumCharacters = 10;
    previewContext.stripRawUrls = true;

    const preview = renderPreview(
      '<p>abcdefghij<span data-mention-id="ada">@Ada</span> https://example.com/path</p>'
    );

    expect(preview.textContent).toBe('abcdefghij@Ada');
    expect(preview.querySelector('mark .font-bold')?.textContent).toBe('@Ada');
    expect(preview.querySelector('mark')?.textContent).toBe('@Ada');
    expect(preview.innerHTML).not.toContain('https://');
  });

  it.each(['telegram', 'max'])(
    'crops %s mention labels with special characters exactly once',
    (identifier) => {
      previewContext.identifier = identifier;
      previewContext.maximumCharacters = 6;

      const preview = renderPreview(
        '<p>Hello <span data-mention-id="1">@AT&amp;T &lt;B&gt;</span></p>'
      );

      expect(preview.textContent).toBe('Hello @AT&T <B>');
      expect(preview.querySelector('mark .font-bold')?.textContent).toBe(
        '@AT&T <B>'
      );
      expect(preview.querySelector('mark')?.textContent).toBe('@AT&T <B>');
      expect(preview.querySelector('b')).toBeNull();
    }
  );
});
