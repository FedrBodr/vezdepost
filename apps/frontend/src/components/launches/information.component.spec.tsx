// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPlatformCapabilities } from '@gitroom/helpers/utils/platform.capabilities';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
vi.mock('@gitroom/react/helpers/safe.image', () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));

import { InformationComponent } from './information.component';

const selected = (id: string, identifier: string, name: string) =>
  ({
    integration: {
      id,
      identifier,
      name,
      capabilities: getPlatformCapabilities(identifier),
    },
    settings: {},
  } as any);

afterEach(() => {
  cleanup();
  useLaunchStore.getState().reset();
});

describe('InformationComponent global targets', () => {
  it('hides empty-source errors when every selected target is customized', () => {
    const pinterest = selected('pin', 'pinterest', 'Pinterest');
    const vk = selected('vk', 'vk', 'VK');
    useLaunchStore.setState({
      current: 'global',
      selectedIntegrations: [pinterest, vk],
      internal: [
        { integration: pinterest.integration, integrationValue: [] },
        { integration: vk.integration, integrationValue: [] },
      ],
    });

    const { container } = render(
      <InformationComponent
        analysis={{
          normalized: '',
          visibleLength: 0,
          blocking: false,
          messages: [],
        }}
        chars={{ pin: 500, vk: 16_384 }}
        totalChars={0}
        totalAllowedChars={500}
        isPicture={false}
      />
    );

    expect(container.firstChild).toBeNull();
    expect(
      screen.queryByText(
        'Your post should have at least one character or one image.'
      )
    ).toBeNull();
    expect(screen.queryByText('0/500')).toBeNull();
  });

  it('keeps a real empty customized target invalid', () => {
    const pinterest = selected('pin', 'pinterest', 'Pinterest');
    useLaunchStore.setState({
      current: pinterest.integration.id,
      selectedIntegrations: [pinterest],
      internal: [{ integration: pinterest.integration, integrationValue: [] }],
    });

    const { container } = render(
      <InformationComponent
        analysis={{
          normalized: '',
          visibleLength: 0,
          blocking: false,
          messages: [],
        }}
        chars={{ pin: 500 }}
        totalChars={0}
        totalAllowedChars={500}
        isPicture={false}
      />
    );

    expect(container.firstElementChild?.className).toContain('bg-[#FF3F3F]');
    expect(
      screen.getByText(
        'Your post should have at least one character or one image.'
      )
    ).toBeTruthy();
    expect(screen.getByText('0/500')).toBeTruthy();
  });

  it('omits overridden destinations from universal counters and diagnostics', () => {
    const pinterest = selected('pin', 'pinterest', 'Pinterest');
    const vk = selected('vk', 'vk', 'VK');
    useLaunchStore.setState({
      current: 'global',
      selectedIntegrations: [pinterest, vk],
      internal: [
        {
          integration: pinterest.integration,
          integrationValue: [],
        },
      ],
    });

    render(
      <InformationComponent
        analysis={{
          normalized: 'x'.repeat(600),
          visibleLength: 600,
          blocking: false,
          messages: [],
        }}
        chars={{ pin: 500, vk: 16_384 }}
        totalChars={600}
        totalAllowedChars={16_384}
        isPicture={false}
      />
    );

    expect(screen.getAllByText('600/16384')).toHaveLength(2);
    expect(screen.getByText(/VK \(Vk\):/)).toBeTruthy();
    expect(screen.queryAllByText(/Pinterest/)).toHaveLength(0);
    expect(screen.queryByText('Internal Edit')).toBeNull();
  });
});
