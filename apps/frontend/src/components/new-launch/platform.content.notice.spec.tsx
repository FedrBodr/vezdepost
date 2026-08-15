// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformContentNotice } from './platform.content.notice';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

  it('keeps repeated notice identities unique and stable', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const first = {
      platform: 'pinterest',
      severity: 'error' as const,
      code: 'text-too-long' as const,
      text: 'Pinterest account one exceeds its limit.',
    };
    const second = {
      ...first,
      text: 'Pinterest account two exceeds its limit.',
    };
    const { rerender } = render(
      <PlatformContentNotice messages={[first, second]} />
    );
    const originalNodes = new Map(
      screen.getAllByRole('alert').map((node) => [node.textContent, node])
    );

    rerender(<PlatformContentNotice messages={[second, first]} />);

    const reordered = screen.getAllByRole('alert');
    expect(reordered[0]).toBe(originalNodes.get(second.text));
    expect(reordered[1]).toBe(originalNodes.get(first.text));
    expect(consoleError.mock.calls.flat().map(String).join(' ')).not.toContain(
      'same key'
    );
  });
});
