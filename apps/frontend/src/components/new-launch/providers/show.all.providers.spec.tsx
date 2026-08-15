// @vitest-environment jsdom

import 'reflect-metadata';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPlatformCapabilities } from '@gitroom/helpers/utils/platform.capabilities';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';

const { emptyProvider } = vi.hoisted(() => ({
  emptyProvider: () => ({ default: (): null => null }),
}));

vi.mock('./devto/devto.provider', emptyProvider);
vi.mock('./x/x.provider', emptyProvider);
vi.mock('./linkedin/linkedin.provider', emptyProvider);
vi.mock('./reddit/reddit.provider', emptyProvider);
vi.mock('./medium/medium.provider', emptyProvider);
vi.mock('./hashnode/hashnode.provider', emptyProvider);
vi.mock('./facebook/facebook.provider', emptyProvider);
vi.mock('./instagram/instagram.collaborators', emptyProvider);
vi.mock('./youtube/youtube.provider', emptyProvider);
vi.mock('./tiktok/tiktok.provider', emptyProvider);
vi.mock('./pinterest/pinterest.provider', emptyProvider);
vi.mock('./dribbble/dribbble.provider', emptyProvider);
vi.mock('./threads/threads.provider', emptyProvider);
vi.mock('./discord/discord.provider', emptyProvider);
vi.mock('./slack/slack.provider', emptyProvider);
vi.mock('./kick/kick.provider', emptyProvider);
vi.mock('./twitch/twitch.provider', emptyProvider);
vi.mock('./mastodon/mastodon.provider', emptyProvider);
vi.mock('./bluesky/bluesky.provider', emptyProvider);
vi.mock('./lemmy/lemmy.provider', emptyProvider);
vi.mock('./warpcast/warpcast.provider', emptyProvider);
vi.mock('./telegram/telegram.provider', emptyProvider);
vi.mock('./max/max.provider', emptyProvider);
vi.mock('./nostr/nostr.provider', emptyProvider);
vi.mock('./vk/vk.provider', emptyProvider);
vi.mock('./wordpress/wordpress.provider', emptyProvider);
vi.mock('./listmonk/listmonk.provider', emptyProvider);
vi.mock('./gmb/gmb.provider', emptyProvider);
vi.mock('./moltbook/moltbook.provider', emptyProvider);
vi.mock('./skool/skool.provider', emptyProvider);
vi.mock('./whop/whop.provider', emptyProvider);
vi.mock('./mewe/mewe.provider', emptyProvider);
vi.mock('./tumblr/tumblr.provider', emptyProvider);

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock(
  '@gitroom/frontend/components/launches/general.preview.component',
  () => ({
    GeneralPreviewComponent: () => {
      const { integration, allIntegrations } = useIntegration();
      return (
        <div data-testid="global-preview">
          {integration?.id}:{allIntegrations.map((item) => item.id).join(',')}
        </div>
      );
    },
  })
);

import { ShowAllProviders } from './show.all.providers';

const selected = (id: string, capabilitiesIdentifier: string) =>
  ({
    integration: {
      id,
      identifier: `test-${id}`,
      name: id,
      capabilities: getPlatformCapabilities(capabilitiesIdentifier),
    },
    settings: {},
  } as any);

afterEach(() => {
  cleanup();
  useLaunchStore.getState().reset();
});

describe('ShowAllProviders global preview', () => {
  it('distinguishes no selected channels from fully customized channels', () => {
    useLaunchStore.setState({
      current: 'global',
      selectedIntegrations: [],
      internal: [],
      global: [{ id: 'post', content: '<p>Keep me</p>', delay: 0, media: [] }],
    });

    render(<ShowAllProviders />);

    expect(screen.queryByTestId('global-preview')).toBeNull();
    expect(
      screen.getByText(
        'No channels are selected. Select a channel to preview global content.'
      )
    ).toBeTruthy();
    expect(
      screen.queryByText(
        'All selected channels use customized content. Global content is kept as a source.'
      )
    ).toBeNull();
    expect(useLaunchStore.getState().global[0].content).toBe('<p>Keep me</p>');
  });

  it('previews the first destination that still consumes global content', () => {
    const overridden = selected('overridden', 'pinterest');
    const globalTarget = selected('global-target', 'vk');
    useLaunchStore.setState({
      current: 'global',
      selectedIntegrations: [overridden, globalTarget],
      internal: [
        {
          integration: overridden.integration,
          integrationValue: [],
        },
      ],
      global: [{ id: 'post', content: '<p>Hello</p>', delay: 0, media: [] }],
    });

    render(<ShowAllProviders />);

    expect(screen.getByTestId('global-preview').textContent).toBe(
      'global-target:global-target'
    );
  });

  it('shows a neutral state when every destination has an internal copy', () => {
    const first = selected('first', 'pinterest');
    const second = selected('second', 'vk');
    useLaunchStore.setState({
      current: 'global',
      selectedIntegrations: [first, second],
      internal: [
        { integration: first.integration, integrationValue: [] },
        { integration: second.integration, integrationValue: [] },
      ],
      global: [{ id: 'post', content: '<p>Keep me</p>', delay: 0, media: [] }],
    });

    render(<ShowAllProviders />);

    expect(screen.queryByTestId('global-preview')).toBeNull();
    expect(
      screen.getByText(
        'All selected channels use customized content. Global content is kept as a source.'
      )
    ).toBeTruthy();
    expect(useLaunchStore.getState().global[0].content).toBe('<p>Keep me</p>');
  });
});
