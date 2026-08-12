// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import i18next from '@gitroom/react/translation/i18next';
import { CustomFieldsInstructions } from './custom-fields-instructions';

describe('CustomFieldsInstructions', () => {
  beforeEach(async () => {
    cleanup();
    await i18next.changeLanguage('en');
  });

  it('translates the VK community guide in English and Russian', async () => {
    const instructions = {
      collapsible: true,
      summary: 'Where to get the link and key',
      title: 'Connect a VK community',
      items: [
        'Open the community in the desktop VK website and select Management.',
        'Open More → API usage → Access keys.',
        'Select Create key.',
        'Grant only community management, community wall, and photographs access.',
        'Copy the generated community access key into Vezdepost.',
        'Copy the public community address, for example https://vk.ru/fedrbodr_pro, into the first field.',
      ],
      notRequired: 'Callback API and Long Poll API are not required.',
      warning:
        'The access key is secret. Do not send it to support, put it in screenshots, or share it with third parties.',
    };

    expect(i18next.exists(instructions.summary)).toBe(true);
    expect(i18next.exists(instructions.notRequired)).toBe(true);
    render(<CustomFieldsInstructions instructions={instructions} />);
    expect(
      screen.getByRole('button', { name: 'Where to get the link and key' })
    ).not.toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(
      screen.getByText('Callback API and Long Poll API are not required.')
    ).not.toBeNull();

    cleanup();
    await i18next.changeLanguage('ru');

    render(<CustomFieldsInstructions instructions={instructions} />);
    expect(
      screen.getByRole('button', { name: 'Где взять ссылку и ключ' })
    ).not.toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(
      screen.getByText('Callback API и Long Poll API не требуются.')
    ).not.toBeNull();
  });

  it('publishes the complete VK Group copy in both locales', async () => {
    const expectedRussianCopy = {
      label_vk_community_link: 'Ссылка на сообщество VK',
      vk_group_community_link_placeholder: 'https://vk.ru/fedrbodr_pro',
      'Enter a valid VK community link or short name.':
        'Введите корректную ссылку или короткое имя сообщества VK.',
      label_community_access_key: 'Ключ доступа сообщества',
      'Where to get the link and key': 'Где взять ссылку и ключ',
      'Connect a VK community': 'Подключение сообщества VK',
      'Open the community in the desktop VK website and select Management.':
        'Откройте сообщество в полной версии сайта VK и выберите «Управление».',
      'Open More → API usage → Access keys.':
        'Откройте «Дополнительно» → «Работа с API» → «Ключи доступа».',
      'Select Create key.': 'Нажмите «Создать ключ».',
      'Grant only community management, community wall, and photographs access.':
        'Разрешите только управление сообществом, доступ к стене сообщества и фотографиям.',
      'Copy the generated community access key into Vezdepost.':
        'Скопируйте созданный ключ доступа сообщества в Vezdepost.',
      'Copy the public community address, for example https://vk.ru/fedrbodr_pro, into the first field.':
        'Скопируйте публичный адрес сообщества, например https://vk.ru/fedrbodr_pro, в первое поле.',
      'Callback API and Long Poll API are not required.':
        'Callback API и Long Poll API не требуются.',
      'The access key is secret. Do not send it to support, put it in screenshots, or share it with third parties.':
        'Ключ доступа — секрет. Не отправляйте его в поддержку, не добавляйте на скриншоты и не передавайте третьим лицам.',
      'The VK community token is invalid.':
        'Ключ доступа сообщества VK недействителен.',
      'This token belongs to a different VK community.':
        'Этот ключ относится к другому сообществу VK.',
      'The VK community key must allow community management, community wall, and photographs access. Recreate the key and reconnect VK Group.':
        'Ключ сообщества VK должен разрешать управление сообществом, доступ к стене сообщества и фотографиям. Создайте новый ключ и переподключите VK Group.',
      'VK Group supports up to 10 photographs per post.':
        'VK Group поддерживает не более 10 фотографий в одной публикации.',
      'VK Group supports photographs only. Remove videos and other attachments.':
        'VK Group поддерживает только фотографии. Удалите видео и другие вложения.',
      'VK Group photo access is missing. Recreate the community key with photographs access and reconnect VK Group.':
        'Нет доступа к фотографиям VK Group. Создайте новый ключ сообщества с доступом к фотографиям и переподключите VK Group.',
    } as const;

    await i18next.changeLanguage('en');
    for (const [key] of Object.entries(expectedRussianCopy)) {
      expect(i18next.exists(key), key).toBe(true);
    }

    await i18next.changeLanguage('ru');
    for (const [key, value] of Object.entries(expectedRussianCopy)) {
      expect(i18next.t(key), key).toBe(value);
    }
  });

  it('starts a collapsible VK community guide closed and reveals its translated content', () => {
    const instructions = {
      collapsible: true,
      summary: 'Where to get the link and key',
      title: 'Connect a VK community',
      items: [
        'Open the community in the desktop VK website and select Management.',
        'Open More → API usage → Access keys.',
        'Select Create key.',
        'Grant only community management, community wall, and photographs access.',
        'Copy the generated community access key into Vezdepost.',
        'Copy the public community address, for example https://vk.ru/fedrbodr_pro, into the first field.',
      ],
      notRequired: 'Callback API and Long Poll API are not required.',
      warning:
        'The access key is secret. Do not send it to support, put it in screenshots, or share it with third parties.',
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
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    instructions.items.forEach((item) => {
      expect(screen.getByText(item)).not.toBeNull();
    });
    expect(screen.getByText(instructions.notRequired)).not.toBeNull();
    expect(screen.getByText(instructions.warning)).not.toBeNull();
  });

  it('renders the VK community-key permission guide', () => {
    const html = renderToStaticMarkup(
      <CustomFieldsInstructions
        instructions={{
          title: 'When creating the VK access key, select only:',
          items: [
            'Allow the application to manage the community',
            'Allow the application to access the community wall',
          ],
          note: 'Messages, photos, documents, stories, and products/orders are not required.',
        }}
      />
    );

    expect(html).toContain('When creating the VK access key, select only:');
    expect(html).toContain('Allow the application to manage the community');
    expect(html).toContain(
      'Allow the application to access the community wall'
    );
    expect(html).toContain(
      'Messages, photos, documents, stories, and products/orders are not required.'
    );
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
  it('does not register VK Group in the OAuth page picker', () => {
    const source = readFileSync(
      'apps/frontend/src/components/new-launch/providers/continue-provider/list.tsx',
      'utf8'
    );

    expect(source).not.toContain("'vk-group':");
    expect(source).not.toContain('VkGroupContinue');
  });

  it('submits custom credentials without putting them in a callback URL', () => {
    const source = readFileSync(
      'apps/frontend/src/components/launches/add.provider.component.tsx',
      'utf8'
    );
    const customVariablesSource = source.slice(
      source.indexOf('export const CustomVariables'),
      source.indexOf('const ExtensionNotFound')
    );

    expect(customVariablesSource).toContain(
      '/integrations/social-connect/${identifier}'
    );
    expect(customVariablesSource).not.toContain('code=${Buffer.from');
  });
});
