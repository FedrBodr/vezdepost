// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from '@gitroom/react/translation/i18next';
import { CustomFieldsInstructions } from './custom-fields-instructions';
import { AddProviderComponent } from './add.provider.component';

const providerMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  openModal: vi.fn(),
  postMessage: vi.fn(),
}));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => providerMocks.fetch,
}));

vi.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({
    openModal: providerMocks.openModal,
    closeAll: vi.fn(),
    closeCurrent: vi.fn(),
  }),
}));

vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({
    isGeneral: false,
    extensionId: undefined as string | undefined,
  }),
}));

vi.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: vi.fn() }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('./channel-connect.analytics', () => ({
  useChannelConnectAnalytics: () => ({
    resetTerminal: vi.fn(),
    clicked: vi.fn(),
    started: vi.fn(),
    failed: vi.fn(),
    completed: vi.fn(),
  }),
}));

describe('CustomFieldsInstructions', () => {
  beforeEach(async () => {
    cleanup();
    providerMocks.fetch.mockReset();
    providerMocks.openModal.mockReset();
    providerMocks.postMessage.mockReset();
    await i18next.changeLanguage('en');
  });

  it('starts a collapsible guide closed and reveals its content', () => {
    const instructions = {
      collapsible: true,
      summary: 'Show setup instructions',
      title: 'Before connecting',
      items: ['Create credentials', 'Paste credentials'],
      note: 'Keep credentials private.',
    };

    expect(
      renderToStaticMarkup(
        <CustomFieldsInstructions instructions={instructions} />
      )
    ).toContain('aria-expanded="false"');

    render(<CustomFieldsInstructions instructions={instructions} />);

    const disclosure = screen.getByRole('button', {
      name: instructions.summary,
    });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(instructions.title)).toBeNull();

    fireEvent.click(disclosure);

    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(instructions.title)).not.toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    instructions.items.forEach((item) => {
      expect(screen.getByText(item)).not.toBeNull();
    });
    expect(screen.getByText(instructions.note)).not.toBeNull();
  });

  it('renders nothing when a provider has no instructions', () => {
    expect(
      renderToStaticMarkup(
        <CustomFieldsInstructions instructions={undefined} />
      )
    ).toBe('');
  });
});

describe('VK Group continue flow', () => {
  it('starts VK Group OAuth directly without opening custom fields', async () => {
    providerMocks.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ url: 'https://oauth.example/vk' }),
    });
    Object.defineProperty(window, 'ReactNativeWebView', {
      configurable: true,
      value: { postMessage: providerMocks.postMessage },
    });

    render(
      <AddProviderComponent
        invite={false}
        isMobile
        social={[
          {
            identifier: 'vk-group',
            name: 'VK Group',
            isExternal: false,
            isWeb3: false,
          },
        ]}
        article={[]}
      />
    );

    expect(screen.queryByLabelText(/community.*key/i)).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.click(screen.getByText('VK Group'));

    await waitFor(() =>
      expect(providerMocks.fetch).toHaveBeenCalledWith(
        '/integrations/social/vk-group?externalUrl=undefined&redirectUrl=postiz%3A%2F%2Fintegrations'
      )
    );
    expect(providerMocks.openModal).not.toHaveBeenCalled();
    expect(providerMocks.postMessage).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'open-external',
        url: 'https://oauth.example/vk',
      })
    );
  });

  it('contains no VK Group community-key onboarding source', () => {
    const source = readFileSync(
      'apps/frontend/src/components/launches/add.provider.component.tsx',
      'utf8'
    );

    expect(source).not.toContain('label_community_access_key');
    expect(source).not.toContain('vk_group_community_link_placeholder');
  });
});
