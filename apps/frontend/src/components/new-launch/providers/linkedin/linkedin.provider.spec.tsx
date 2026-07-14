import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  providerConfig: undefined as any,
  register: vi.fn(() => ({})),
  watch: vi.fn(() => false),
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
vi.mock('@gitroom/react/form/checkbox', () => ({
  Checkbox: (): null => null,
}));
vi.mock('@gitroom/react/form/input', () => ({ Input: (): null => null }));
vi.mock(
  '@gitroom/react/translation/get.transation.service.client',
  () => ({ useT: () => (_key: string, fallback: string) => fallback })
);
vi.mock(
  '@gitroom/frontend/components/launches/helpers/use.values',
  () => ({
    useSettings: () => ({
      register: testState.register,
      watch: testState.watch,
      formState: {},
      control: {},
    }),
  })
);
vi.mock(
  '@gitroom/nestjs-libraries/dtos/posts/providers-settings/linkedin.dto',
  () => ({ LinkedinDto: class {} })
);
vi.mock(
  '@gitroom/frontend/components/new-launch/providers/linkedin/linkedin.preview',
  () => ({ LinkedinPreview: (): null => null })
);

describe('LinkedInSettings', () => {
  beforeAll(async () => {
    vi.stubGlobal('React', React);
    await import('./linkedin.provider');
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enables image carousel mode by default', () => {
    renderToStaticMarkup(
      createElement(testState.providerConfig.SettingsComponent)
    );

    expect(testState.register).toHaveBeenCalledWith(
      'post_as_images_carousel',
      { value: true }
    );
  });
});
