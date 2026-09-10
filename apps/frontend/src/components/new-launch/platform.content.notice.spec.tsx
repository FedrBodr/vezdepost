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
  it('renders Telegram media caption overflow as nonblocking split information', () => {
    render(
      <PlatformContentNotice
        diagnostics={[
          {
            destination: 'telegram',
            variant: 'media',
            field: 'caption',
            severity: 'information',
            code: 'media-text-split',
            message:
              'Media will be published first, followed by the full text as a separate message.',
          },
        ]}
      />
    );

    expect(screen.getByRole('status').textContent).toContain(
      'separate message'
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders blocking V2 diagnostics as alerts', () => {
    render(
      <PlatformContentNotice
        diagnostics={[
          {
            destination: 'pinterest',
            variant: 'pin',
            severity: 'error',
            code: 'unsupported-media',
            message: 'Attached media does not match the pin requirements.',
          },
        ]}
      />
    );

    expect(screen.getByRole('alert').textContent).toContain(
      'does not match the pin requirements'
    );
  });

  it('renders recommended limits as a distinct nonblocking recommendation', () => {
    render(
      <PlatformContentNotice
        diagnostics={[
          {
            destination: 'slack',
            variant: 'message',
            field: 'body',
            severity: 'warning',
            code: 'recommended-limit-exceeded',
            measured: 4_001,
            limit: 4_000,
            unit: 'utf16-code-units',
            message:
              'Body exceeds the recommended 4000-UTF-16-code-unit limit.',
          },
        ]}
      />
    );

    expect(screen.getByRole('status').textContent).toContain('Recommended:');
    expect(screen.getByRole('status').textContent).toContain(
      'recommended 4000-UTF-16-code-unit limit'
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('customizes the exact destination account while keeping its provider label readable', () => {
    const onCustomize = vi.fn();
    render(
      <PlatformContentNotice
        diagnostics={[
          {
            destination: 'linkedin',
            variant: 'feed',
            targetIntegrationId: 'linkedin-account-2',
            severity: 'warning',
            code: 'formatting-loss',
            message: 'Some formatting in Body will be converted or removed.',
          },
        ]}
        onCustomize={onCustomize}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Customize for linkedin' })
    );
    expect(onCustomize).toHaveBeenCalledWith('linkedin-account-2');
  });

  it('keeps repeated V2 diagnostic identities unique and stable', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const first = {
      destination: 'pinterest',
      variant: 'pin',
      targetIntegrationId: 'pinterest-account-1',
      severity: 'error' as const,
      code: 'text-too-long',
      message: 'Body exceeds the 500-grapheme limit.',
    };
    const second = {
      ...first,
      targetIntegrationId: 'pinterest-account-2',
    };
    const { rerender } = render(
      <PlatformContentNotice diagnostics={[first, second]} />
    );
    const originalNodes = new Map(
      screen
        .getAllByRole('alert')
        .map((node, index) => [
          [first.targetIntegrationId, second.targetIntegrationId][index],
          node,
        ])
    );

    rerender(<PlatformContentNotice diagnostics={[second, first]} />);

    const reordered = screen.getAllByRole('alert');
    expect(reordered[0]).toBe(originalNodes.get(second.targetIntegrationId));
    expect(reordered[1]).toBe(originalNodes.get(first.targetIntegrationId));
    expect(consoleError.mock.calls.flat().map(String).join(' ')).not.toContain(
      'same key'
    );
  });
});
