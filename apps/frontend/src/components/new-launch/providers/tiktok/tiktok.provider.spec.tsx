import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  providerConfig: undefined as any,
}));

vi.mock(
  '@gitroom/frontend/components/new-launch/providers/high.order.provider',
  () => ({
    PostComment: { COMMENT: 'comment' },
    withProvider: vi.fn((config) => {
      testState.providerConfig = config;
      return () => null;
    }),
  })
);
vi.mock('@gitroom/frontend/components/launches/helpers/use.values', () => ({
  useSettings: () => ({
    register: () => ({}),
    watch: () => false,
  }),
}));
vi.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration',
  () => ({
    useIntegration: () => ({
      value: [{ image: [{ path: 'photo.jpg', type: 'image' }] }],
    }),
  })
);
vi.mock('@gitroom/react/form/select', () => ({ Select: (): null => null }));
vi.mock('@gitroom/react/form/checkbox', () => ({
  Checkbox: (): null => null,
}));
vi.mock('@gitroom/react/form/input', () => ({
  Input: ({ label, ...props }: any) => (
    <input aria-label={String(label)} {...props} />
  ),
}));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock(
  '@gitroom/nestjs-libraries/dtos/posts/providers-settings/tiktok.dto',
  () => ({ TikTokDto: class {} })
);
vi.mock('./tiktok.preview', () => ({ TiktokPreview: (): null => null }));

describe('TikTokSettings', () => {
  beforeAll(async () => {
    vi.stubGlobal('React', React);
    await import('./tiktok.provider');
  });

  it('accepts a photo title at the 90-character contract boundary', () => {
    const markup = renderToStaticMarkup(
      createElement(testState.providerConfig.SettingsComponent)
    );

    expect(markup).toContain('aria-label="Title"');
    expect(markup).toContain('maxLength="90"');
  });
});
