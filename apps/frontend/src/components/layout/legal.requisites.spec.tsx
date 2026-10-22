// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const variables = vi.hoisted(() => ({ legalRequisites: '' }));

vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => variables,
}));

import { LegalRequisites } from './legal.requisites';

beforeEach(() => {
  cleanup();
  variables.legalRequisites = '';
});

describe('LegalRequisites', () => {
  it('shows the configured seller details', () => {
    variables.legalRequisites = 'ИП Иванов · ИНН 000000000000';
    render(<LegalRequisites />);
    expect(screen.getByText('ИП Иванов · ИНН 000000000000')).toBeTruthy();
  });

  it('renders nothing while the requisites are not configured', () => {
    const { container } = render(<LegalRequisites />);
    expect(container.innerHTML).toBe('');
  });
});
