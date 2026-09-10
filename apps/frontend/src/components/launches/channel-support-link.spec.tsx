// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelSupportLink } from './channel-support-link';

const requestClicked = vi.fn();

vi.mock('./channel-connect.analytics', () => ({
  useChannelConnectAnalytics: () => ({ requestClicked }),
}));

vi.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT:
    () =>
    (
      _key: string,
      fallback: string | { defaultValue: string; platform?: string }
    ) => {
      if (typeof fallback === 'string') return fallback;
      return fallback.defaultValue.replace(
        '{{platform}}',
        fallback.platform ?? ''
      );
    },
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
      `mailto:fedrbodr@gmail.com?subject=${encodeURIComponent(
        "Can't connect X in Vezdepost"
      )}`
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
        'Request a new platform in Vezdepost'
      )}`
    );
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);
    expect(requestClicked).toHaveBeenCalledWith(
      'unspecified',
      'channel_picker'
    );
  });

  it('does not let analytics failures escape the mail link click', () => {
    requestClicked.mockImplementationOnce(() => {
      throw new Error('analytics unavailable');
    });
    render(
      <ChannelSupportLink platform="x" source="connection_error">
        Failure-safe contact
      </ChannelSupportLink>
    );
    const link = screen.getByRole('link', { name: 'Failure-safe contact' });
    link.addEventListener('click', (event) => event.preventDefault());

    expect(() => fireEvent.click(link)).not.toThrow();
    expect(requestClicked).toHaveBeenCalledWith('x', 'connection_error');
  });
});
