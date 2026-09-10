// @vitest-environment jsdom

import 'reflect-metadata';
import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFormContext } from 'react-hook-form';
import { resolvePlatformCapabilityV2 } from '@gitroom/helpers/utils/platform.capability.resolver';

const { providerState } = vi.hoisted(() => ({
  providerState: {
    date: undefined,
    tab: 0,
    global: [] as any[],
    dummy: false,
    internal: [] as any[],
    integrations: [],
    current: 'global',
    selectedIntegrations: [
      {
        integration: {
          id: 'pinterest-account',
          identifier: 'pinterest',
          name: 'Pinterest',
          picture: '/pinterest.png',
          editor: 'normal',
          additionalSettings: '[]',
        },
        settings: {},
      },
    ] as any[],
    setHide: vi.fn(),
    setCurrent: vi.fn(),
    setComments: vi.fn(),
    setTotalChars: vi.fn(),
    setPostComment: vi.fn(),
    setEditor: vi.fn(),
    setChars: vi.fn(),
    setSelectedIntegrationSettings: vi.fn(),
  },
}));

vi.mock('@gitroom/frontend/components/new-launch/store', () => ({
  useLaunchStore: (selector: (state: typeof providerState) => unknown) =>
    selector(providerState),
}));
vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));
vi.mock('swr', () => ({
  default: (): {
    data: { internalPlugs: unknown[] };
    isLoading: boolean;
  } => ({ data: { internalPlugs: [] }, isLoading: false }),
}));
vi.mock(
  '@gitroom/frontend/components/launches/general.preview.component',
  () => ({ GeneralPreviewComponent: (): null => null })
);
vi.mock('@gitroom/frontend/components/launches/internal.channels', () => ({
  InternalChannels: (): null => null,
}));
vi.mock('@gitroom/react/helpers/safe.image', () => ({
  default: (): null => null,
}));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@hookform/resolvers/class-validator', () => ({
  classValidatorResolver: () => async (values: unknown) => ({
    values,
    errors: {},
  }),
}));

import { PostComment, withProvider } from './high.order.provider';

const Settings = () => {
  const { register } = useFormContext();
  return <input aria-label="Board" {...register('board')} />;
};

afterEach(() => {
  cleanup();
  providerState.setSelectedIntegrationSettings.mockClear();
  document.querySelector('#social-settings')?.remove();
});

describe('withProvider live settings', () => {
  it('synchronizes current form values for V2 editor resolution', async () => {
    const settingsHost = document.createElement('div');
    settingsHost.id = 'social-settings';
    document.body.appendChild(settingsHost);
    const Provider = withProvider({
      postComment: PostComment.COMMENT,
      minimumCharacters: [],
      SettingsComponent: Settings,
      maximumCharacters: 500,
    });

    render(<Provider id="pinterest-account" />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Board' }), {
      target: { value: 'board-1' },
    });

    await waitFor(() =>
      expect(providerState.setSelectedIntegrationSettings).toHaveBeenCalledWith(
        'pinterest-account',
        expect.objectContaining({ board: 'board-1' })
      )
    );
  });

  it('passes the active TikTok media variant limit to its custom preview', () => {
    providerState.current = 'tiktok-account';
    providerState.selectedIntegrations = [
      {
        integration: {
          id: 'tiktok-account',
          identifier: 'tiktok',
          name: 'TikTok',
          picture: '/tiktok.png',
          editor: 'normal',
          additionalSettings: '[]',
          capabilitiesV2: resolvePlatformCapabilityV2({
            identifier: 'tiktok',
            settings: {},
            media: [],
          }),
        },
        settings: { title: 'Photo title' },
      },
    ];
    providerState.global = [
      {
        id: 'post-1',
        content: 'Photo description',
        media: [{ path: 'photo.jpg', type: 'image' }],
      },
    ];
    const Preview = ({ maximumCharacters }: { maximumCharacters?: number }) => (
      <div data-testid="preview-maximum">{maximumCharacters}</div>
    );
    const Provider = withProvider({
      postComment: PostComment.POST,
      minimumCharacters: [],
      SettingsComponent: null,
      CustomPreviewComponent: Preview,
      maximumCharacters: 2_200,
    });

    const view = render(<Provider id="tiktok-account" />);
    expect(screen.getByTestId('preview-maximum').textContent).toBe('4000');

    providerState.global = [
      {
        id: 'post-1',
        content: 'Video caption',
        media: [{ path: 'clip.mp4', type: 'video' }],
      },
    ];
    view.rerender(<Provider id="tiktok-account" />);

    expect(screen.getByTestId('preview-maximum').textContent).toBe('2200');
  });
});
