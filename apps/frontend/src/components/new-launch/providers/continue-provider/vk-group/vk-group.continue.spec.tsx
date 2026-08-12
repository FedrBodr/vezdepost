// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock(
  '@gitroom/frontend/components/launches/helpers/use.custom.provider.function',
  () => ({
    useCustomProviderFunction: () => ({ get: vi.fn() }),
  })
);

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

const componentPath = resolve(
  'apps/frontend/src/components/new-launch/providers/continue-provider/vk-group/vk-group.continue.tsx'
);
const componentModule = './vk-group.continue';

const loadComponent = async () => {
  expect(existsSync(componentPath), 'VK Group selector module').toBe(true);
  return vi.importActual<{ VkGroupContinue: React.ComponentType<any> }>(
    componentModule
  );
};

describe('VkGroupContinue', () => {
  beforeEach(() => {
    cleanup();
    vi.stubGlobal('React', React);
  });

  it('is registered explicitly as the VK Group two-step selector', () => {
    const source = readFileSync(
      resolve(
        'apps/frontend/src/components/new-launch/providers/continue-provider/list.tsx'
      ),
      'utf8'
    );

    expect(source).toContain("'vk-group': VkGroupContinue");
  });

  it('renders verified community identity without a community-key input', async () => {
    const { VkGroupContinue } = await loadComponent();

    render(
      <VkGroupContinue
        existingId={[]}
        initialData={[
          {
            id: '321',
            page: '-321',
            username: 'vk_builders',
            name: 'VK Builders',
            picture: 'https://example.com/vk-builders.jpg',
          },
        ]}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByText('VK Builders')).not.toBeNull();
    expect(screen.getByText('@vk_builders')).not.toBeNull();
    expect(screen.getByAltText('VK Builders').getAttribute('src')).toBe(
      'https://example.com/vk-builders.jpg'
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByLabelText(/community.*key/i)).toBeNull();
    expect(readFileSync(componentPath, 'utf8')).not.toMatch(
      /accessToken|label_community_access_key|vk_group_community_link_placeholder|<Input/i
    );
  });

  it('submits the selected community as { page: id }', async () => {
    const { VkGroupContinue } = await loadComponent();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <VkGroupContinue
        existingId={[]}
        initialData={[
          {
            id: '321',
            page: '-321',
            username: 'vk_builders',
            name: 'VK Builders',
            picture: 'https://example.com/vk-builders.jpg',
          },
        ]}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByText('VK Builders'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ page: '321' }));
  });

  it('shows actionable empty-state guidance', async () => {
    const { VkGroupContinue } = await loadComponent();

    render(
      <VkGroupContinue existingId={[]} initialData={[]} onSave={vi.fn()} />
    );

    expect(
      screen.getByText('No managed VK communities were found.')
    ).not.toBeNull();
    expect(
      screen.getByText(
        'Sign in with a VK account that is an administrator of at least one community.'
      )
    ).not.toBeNull();
    expect(
      screen.getByText(
        'Already connected VK Group with a community key? Delete that integration and reconnect through VK authorization.'
      )
    ).not.toBeNull();
  });

  it('publishes complete VK Group OAuth copy in English and Russian', () => {
    const english = JSON.parse(
      readFileSync(
        resolve(
          'libraries/react-shared-libraries/src/translation/locales/en/translation.json'
        ),
        'utf8'
      )
    );
    const russian = JSON.parse(
      readFileSync(
        resolve(
          'libraries/react-shared-libraries/src/translation/locales/ru/translation.json'
        ),
        'utf8'
      )
    );
    const expected = {
      vk_group_oauth_description: [
        'Authorize with VK to securely choose a community you administer.',
        'Авторизуйтесь через VK, чтобы безопасно выбрать сообщество, которым вы управляете.',
      ],
      vk_group_select_community: [
        'Select a VK community:',
        'Выберите сообщество VK:',
      ],
      vk_group_community_authorship: [
        'Posts are published on behalf of the selected community.',
        'Публикации размещаются от имени выбранного сообщества.',
      ],
      vk_group_photo_limit: [
        'VK Group supports up to 10 photographs per post.',
        'VK Group поддерживает не более 10 фотографий в одной публикации.',
      ],
      vk_group_video_unsupported: [
        'VK Group does not support video posts.',
        'VK Group не поддерживает публикации с видео.',
      ],
      vk_group_no_managed_communities: [
        'No managed VK communities were found.',
        'Не найдено сообществ VK, которыми вы управляете.',
      ],
      vk_group_admin_required: [
        'Sign in with a VK account that is an administrator of at least one community.',
        'Войдите в аккаунт VK, который является администратором хотя бы одного сообщества.',
      ],
      vk_group_legacy_reconnect: [
        'Already connected VK Group with a community key? Delete that integration and reconnect through VK authorization.',
        'Ранее подключали VK Group с помощью ключа сообщества? Удалите эту интеграцию и подключите её заново через авторизацию VK.',
      ],
    } as const;

    for (const [key, [englishValue, russianValue]] of Object.entries(
      expected
    )) {
      expect(english[key], key).toBe(englishValue);
      expect(russian[key], key).toBe(russianValue);
    }
  });
});
