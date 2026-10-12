// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

import { MobileVersionLink } from './mobile.version.link';

beforeEach(cleanup);

describe('MobileVersionLink', () => {
  it('renders nothing while the mobile route is disabled', () => {
    const { container } = render(<MobileVersionLink enabled={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('links to /m when enabled', () => {
    render(<MobileVersionLink enabled />);
    expect(
      screen.getByRole('link', { name: 'Мобильная версия' }).getAttribute('href')
    ).toBe('/m');
  });
});
