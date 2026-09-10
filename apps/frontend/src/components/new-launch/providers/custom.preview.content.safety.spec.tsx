// @vitest-environment jsdom

import { render } from '@testing-library/react';
import React, { type ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const previewContext = vi.hoisted(() => ({
  identifier: 'youtube',
  name: 'Safe account',
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
        name: previewContext.name,
        picture: '/account.jpg',
      },
    }),
  })
);
vi.mock('@gitroom/frontend/components/new-launch/store', () => ({
  useLaunchStore: (selector: (state: { current: string }) => unknown) =>
    selector({ current: 'integration' }),
}));
vi.mock('@gitroom/react/helpers/use.media.directory', () => ({
  useMediaDirectory: () => ({ set: (path: string) => path }),
}));
vi.mock('@gitroom/react/helpers/video.or.image', () => ({
  VideoOrImage: (): null => null,
}));
vi.mock('@gitroom/frontend/components/third-parties/slider.component', () => ({
  SliderComponent: ({ list }: { list: React.ReactNode }) => <>{list}</>,
}));
vi.mock('react-hook-form', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-hook-form')>()),
  useFormContext: (): null => null,
  useWatch: (): undefined => undefined,
}));

import { FacebookPreview } from './facebook/facebook.preview';
import { InstagramPreview } from './instagram/instagram.preview';
import { TiktokPreview } from './tiktok/tiktok.preview';
import { YoutubePreview } from './youtube/youtube.preview';

vi.stubGlobal('React', React);

const previews = [
  ['youtube', YoutubePreview],
  ['tiktok', TiktokPreview],
  ['facebook', FacebookPreview],
  ['instagram', InstagramPreview],
] as const satisfies ReadonlyArray<
  readonly [string, ComponentType<{ maximumCharacters?: number }>]
>;

beforeEach(() => {
  previewContext.identifier = 'youtube';
  previewContext.name = 'Safe account';
  previewContext.value = [];
});

describe('custom preview content safety', () => {
  it.each(previews)(
    'keeps entity-encoded executable tags inert in the %s preview',
    (identifier, Preview) => {
      previewContext.identifier = identifier;
      previewContext.value = [
        {
          content:
            '<p>Safe &lt;img data-preview-xss="true" src=x ' +
            'onerror="alert(1)"&gt; text</p>',
          image: [],
        },
      ];

      const { container } = render(<Preview maximumCharacters={10_000} />);

      expect(container.querySelector('[data-preview-xss]')).toBeNull();
      expect(container.querySelector('[onerror]')).toBeNull();
    }
  );

  it('keeps the Instagram account name outside the HTML sink', () => {
    previewContext.identifier = 'instagram';
    previewContext.name =
      '<img data-account-xss="true" src=x onerror="alert(1)">';
    previewContext.value = [{ content: '<p>Safe caption</p>', image: [] }];

    const { container } = render(
      <InstagramPreview maximumCharacters={10_000} />
    );

    expect(container.querySelector('[data-account-xss]')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.textContent).toContain(previewContext.name);
  });
});
