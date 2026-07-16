// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelSupportLink } from './channel-support-link';

const requestClicked = vi.fn();

vi.mock('./channel-connect.analytics', () => ({
  useChannelConnectAnalytics: () => ({ requestClicked }),
}));

describe('ChannelSupportLink', () => {
  beforeEach(() => {
    requestClicked.mockReset();
  });

  it('uses a provider-specific subject and tracks its identifier', () => {
    render(
      <ChannelSupportLink platform="x" source="connection_error">
        Contact support
      </ChannelSupportLink>
    );
    const link = screen.getByRole('link', { name: 'Contact support' });
    expect(link.getAttribute('href')).toBe(
      'mailto:fedrbodr@gmail.com?subject=%D0%9D%D0%B5%20%D0%BF%D0%BE%D0%B4%D0%BA%D0%BB%D1%8E%D1%87%D0%B0%D0%B5%D1%82%D1%81%D1%8F%20X%20%D0%B2%20%D0%92%D0%B5%D0%B7%D0%B4%D0%B5%D0%BF%D0%BE%D1%81%D1%82%D0%B5'
    );
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);
    expect(requestClicked).toHaveBeenCalledWith('x', 'connection_error');
  });

  it('uses the missing-platform subject and tracks an unspecified platform', () => {
    render(
      <ChannelSupportLink source="channel_picker" className="underline">
        Request a platform
      </ChannelSupportLink>
    );
    const link = screen.getByRole('link', { name: 'Request a platform' });
    expect(link.classList.contains('underline')).toBe(true);
    expect(link.getAttribute('href')).toBe(
      `mailto:fedrbodr@gmail.com?subject=${encodeURIComponent(
        'Нужна новая платформа в Вездепосте'
      )}`
    );
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);
    expect(requestClicked).toHaveBeenCalledWith(
      'unspecified',
      'channel_picker'
    );
  });
});
