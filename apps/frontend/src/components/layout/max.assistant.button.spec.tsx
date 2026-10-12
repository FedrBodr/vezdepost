// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
const variables = vi.hoisted(() => ({ maxAssistantEnabled: true }));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));
vi.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => variables,
}));
vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

import { MaxAssistantButton } from './max.assistant.button';

beforeEach(() => {
  cleanup();
  fetchMock.mockReset();
  variables.maxAssistantEnabled = true;
});

describe('MaxAssistantButton', () => {
  it('asks the backend for a MAX link and opens it', async () => {
    const tab = { close: vi.fn(), location: { href: '' } };
    window.open = vi.fn(() => tab as any);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ url: 'https://max.ru/bot?start=c' }),
    });
    render(<MaxAssistantButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Постить из MAX' }));
    await waitFor(() =>
      expect(tab.location.href).toBe('https://max.ru/bot?start=c')
    );
    expect(fetchMock).toHaveBeenCalledWith('/assistant/link/max', {
      method: 'POST',
    });
  });

  it('renders nothing while the MAX assistant is not configured', () => {
    variables.maxAssistantEnabled = false;
    const { container } = render(<MaxAssistantButton />);
    expect(container.innerHTML).toBe('');
  });
});
