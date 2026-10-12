// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

import { DesktopVersionLink } from './desktop.version.link';

beforeEach(() => {
  cleanup();
  document.cookie = 'vz-desktop=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
});

describe('DesktopVersionLink', () => {
  it('points at the desktop calendar and sets the opt-out cookie on click', () => {
    render(<DesktopVersionLink />);
    const link = screen.getByRole('link', { name: 'Полная версия' });
    expect(link.getAttribute('href')).toBe('/launches');
    // jsdom cannot navigate; keep the click but stop the default action.
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);
    expect(document.cookie).toContain('vz-desktop=1');
  });
});
