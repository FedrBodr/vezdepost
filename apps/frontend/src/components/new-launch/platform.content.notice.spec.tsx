// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlatformContentNotice } from './platform.content.notice';

describe('PlatformContentNotice', () => {
  it('renders information without marking the post invalid', () => {
    render(
      <PlatformContentNotice
        messages={[
          {
            severity: 'information',
            code: 'media-text-split',
            text: 'Media will be published first, followed by the full text as a separate message.',
          },
        ]}
      />
    );
    expect(screen.getByRole('status').textContent).toContain(
      'separate message'
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders blocking errors as alerts', () => {
    render(
      <PlatformContentNotice
        messages={[
          {
            severity: 'error',
            code: 'media-required',
            text: 'This platform requires media.',
          },
        ]}
      />
    );
    expect(screen.getByRole('alert').textContent).toContain('requires media');
  });

  it('offers a platform-specific copy for a universal warning', () => {
    const onCustomize = vi.fn();
    render(
      <PlatformContentNotice
        messages={[
          {
            platform: 'linkedin',
            severity: 'warning',
            code: 'formatting-loss',
            text: 'linkedin: Some formatting will be converted to plain text.',
          },
        ]}
        onCustomize={onCustomize}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Customize for linkedin' })
    );
    expect(onCustomize).toHaveBeenCalledWith('linkedin');
  });
});
