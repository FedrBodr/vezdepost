// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolvePlatformCapabilityV2 } from '@gitroom/helpers/utils/platform.capability.resolver';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { resolveEditorCapabilityV2 } from '@gitroom/frontend/components/new-launch/platform.editor.capabilities';

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
      capabilitiesV2: resolvePlatformCapabilityV2({
        identifier,
        settings: {},
        media: [],
      }),
    },
    settings: {},
  } as any);

afterEach(() => {
  cleanup();
  useLaunchStore.getState().reset();
});

describe('InformationComponent V2 counters', () => {
  it('hides empty-source errors when every selected target is customized', () => {
    const pinterest = selected('pin', 'pinterest', 'Pinterest');
    const vk = selected('vk', 'vk', 'VK');
    const internal = [
      { integration: pinterest.integration, integrationValue: [] as any[] },
      { integration: vk.integration, integrationValue: [] as any[] },
    ];
    useLaunchStore.setState({
      current: 'global',
      selectedIntegrations: [pinterest, vk],
      internal,
    });
    const capability = resolveEditorCapabilityV2(
      'global',
      [pinterest, vk],
      internal,
      '',
      []
    );

    const { container } = render(
      <InformationComponent capability={capability} isPicture={false} />
    );

    expect(container.firstChild).toBeNull();
    expect(
      screen.queryByText(
        'Your post should have at least one character or one image.'
      )
    ).toBeNull();
  });

  it('keeps a real empty customized target invalid', () => {
    const pinterest = selected('pin', 'pinterest', 'Pinterest');
    useLaunchStore.setState({
      current: pinterest.integration.id,
      selectedIntegrations: [pinterest],
      internal: [{ integration: pinterest.integration, integrationValue: [] }],
    });
    const capability = resolveEditorCapabilityV2('pin', [pinterest], [], '', [
      { path: 'photo.jpg' },
    ]);

    const { container } = render(
      <InformationComponent capability={capability} isPicture={false} />
    );

    expect(container.firstElementChild?.className).toContain('bg-[#FF3F3F]');
    expect(
      screen.getByText(
        'Your post should have at least one character or one image.'
      )
    ).toBeTruthy();
    expect(screen.getByText('0/500')).toBeTruthy();
  });

  it('omits overridden destinations from global per-destination counters', () => {
    const pinterest = selected('pin', 'pinterest', 'Pinterest');
    const vk = selected('vk', 'vk', 'VK');
    const internal = [
      { integration: pinterest.integration, integrationValue: [] as any[] },
    ];
    useLaunchStore.setState({
      current: 'global',
      selectedIntegrations: [pinterest, vk],
      internal,
    });
    const capability = resolveEditorCapabilityV2(
      'global',
      [pinterest, vk],
      internal,
      'x'.repeat(600),
      []
    );

    render(<InformationComponent capability={capability} isPicture={false} />);

    expect(screen.getAllByText('600/16384')).toHaveLength(2);
    expect(screen.getByText(/VK \(Vk\) · Body:/)).toBeTruthy();
    expect(screen.queryAllByText(/Pinterest/)).toHaveLength(0);
  });

  it('labels non-grapheme counters with their V2 unit without treating recommendations as blocking', () => {
    const slack = selected('slack', 'slack', 'Slack');
    useLaunchStore.setState({
      current: 'slack',
      selectedIntegrations: [slack],
    });
    const capability = resolveEditorCapabilityV2(
      'slack',
      [slack],
      [],
      'x'.repeat(4_001),
      []
    );

    const { container } = render(
      <InformationComponent capability={capability} isPicture={false} />
    );

    expect(screen.getByText('4001/40000 UTF-16 units')).toBeTruthy();
    expect(container.firstElementChild?.className).not.toContain(
      'bg-[#FF3F3F]'
    );
  });

  it('labels the active TikTok photo description field', () => {
    const tiktok = selected('tiktok', 'tiktok', 'TikTok');
    useLaunchStore.setState({
      current: 'global',
      selectedIntegrations: [tiktok],
    });
    const capability = resolveEditorCapabilityV2(
      'global',
      [tiktok],
      [],
      'Photo description',
      [{ path: 'photo.jpg' }]
    );

    render(<InformationComponent capability={capability} isPicture={true} />);

    expect(screen.getByText(/TikTok \(Tiktok\) · Description:/)).toBeTruthy();
    expect(screen.getAllByText('17/4000 UTF-16 units')).toHaveLength(2);
  });
});
