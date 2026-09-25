// @vitest-environment jsdom
import 'reflect-metadata';
import React, { FC, PropsWithChildren } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormProvider, useForm } from 'react-hook-form';
import { IntegrationContext } from '@gitroom/frontend/components/launches/helpers/use.integration';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (_key: string, fallback: string, vars?: Record<string, unknown>): string =>
      fallback.replace(/{{(\w+)}}/g, (_, name) => String(vars?.[name] ?? '')),
}));
vi.mock(
  '@gitroom/frontend/components/new-launch/providers/high.order.provider',
  () => ({
    PostComment: { ALL: 0, POST: 1, COMMENT: 2 },
    withProvider: () => (): null => null,
  })
);

import {
  setFrameSetting,
  TelegramStoriesSettings,
} from './telegram.stories.provider';

const media = [{ id: 'a' }, { id: 'b' }];

describe('setFrameSetting', () => {
  it('writes a frame keyed by media id with defaults for the others', () => {
    expect(
      setFrameSetting([], media, 'b', { text: 'custom', caption: 'Hi' })
    ).toEqual([
      { mediaId: 'a', text: 'post' },
      { mediaId: 'b', text: 'custom', caption: 'Hi' },
    ]);
  });

  it('drops frames of removed media and keeps edited ones', () => {
    const frames = [
      { mediaId: 'gone', text: 'none' as const },
      { mediaId: 'a', text: 'none' as const },
    ];

    expect(setFrameSetting(frames, media, 'b', { text: 'none' })).toEqual([
      { mediaId: 'a', text: 'none' },
      { mediaId: 'b', text: 'none' },
    ]);
  });
});

const Wrapper: FC<PropsWithChildren> = ({ children }) => {
  const form = useForm();
  return (
    <IntegrationContext.Provider
      value={
        {
          integration: undefined,
          allIntegrations: [],
          date: undefined,
          value: [
            {
              content: '',
              image: [
                { id: 'a', path: 'https://cdn/a.jpg' },
                { id: 'b', path: 'https://cdn/b.mp4' },
              ],
            },
          ],
        } as any
      }
    >
      <FormProvider {...form}>{children}</FormProvider>
    </IntegrationContext.Provider>
  );
};

describe('TelegramStoriesSettings', () => {
  afterEach(() => cleanup());

  it('shows lifetime and one text row per attached media', () => {
    render(<TelegramStoriesSettings />, { wrapper: Wrapper });

    expect(
      (screen.getByLabelText('Story lifetime') as HTMLSelectElement).value
    ).toBe('86400');
    expect(screen.getByText('Story 1')).not.toBeNull();
    expect(screen.getByText('Story 2')).not.toBeNull();
    expect(
      (screen.getByLabelText('Text on story 1') as HTMLSelectElement).value
    ).toBe('post');
    expect(
      (screen.getByLabelText('Text on story 2') as HTMLSelectElement).value
    ).toBe('none');
  });

  it('shows a text field for custom text', () => {
    render(<TelegramStoriesSettings />, { wrapper: Wrapper });

    fireEvent.change(screen.getByLabelText('Text on story 2'), {
      target: { value: 'custom' },
    });

    expect(screen.getByLabelText('Custom text for story 2')).not.toBeNull();
  });
});
