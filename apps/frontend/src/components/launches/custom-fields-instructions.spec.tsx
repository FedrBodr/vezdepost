// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import i18next from '@gitroom/react/translation/i18next';
import { CustomFieldsInstructions } from './custom-fields-instructions';

describe('CustomFieldsInstructions', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
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
