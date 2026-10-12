// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

const openModal = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() =>
  vi.fn(async () => ({
    json: async () => ({ social: [{ identifier: 'vk' }], article: [] }),
  }))
);
const rendered = vi.hoisted(() => ({ props: null as any }));

vi.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));
vi.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ openModal }),
}));
vi.mock('@gitroom/frontend/components/launches/add.provider.component', () => ({
  AddProviderComponent: (props: any) => {
    rendered.props = props;
    return <div>picker</div>;
  },
}));

import { useMobileAddProvider } from './use.mobile.add.provider';

describe('useMobileAddProvider', () => {
  it('opens the picker full screen in compact layout, not in WebView mode', async () => {
    const update = vi.fn();
    const { result } = renderHook(() => useMobileAddProvider(update));

    await act(async () => {
      await result.current();
    });

    expect(fetchMock).toHaveBeenCalledWith('/integrations');
    expect(openModal).toHaveBeenCalledTimes(1);
    const options = openModal.mock.calls[0][0];
    expect(options).toMatchObject({ fullScreen: true, removeLayout: true });
    // Render the children element to inspect the props it passes down.
    const { render } = await import('@testing-library/react');
    render(options.children);
    expect(rendered.props).toMatchObject({
      compact: true,
      invite: false,
      social: [{ identifier: 'vk' }],
    });
    expect(rendered.props.isMobile).toBeUndefined();
    expect(rendered.props.update).toBe(update);
  });
});
