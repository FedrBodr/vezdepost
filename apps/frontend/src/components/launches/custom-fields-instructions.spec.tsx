import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CustomFieldsInstructions } from './custom-fields-instructions';

describe('CustomFieldsInstructions', () => {
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
