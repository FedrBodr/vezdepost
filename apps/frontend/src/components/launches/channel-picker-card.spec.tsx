// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelPickerCard } from './channel-picker-card';

const baseProps = {
  identifier: 'pinterest',
  name: 'Pinterest',
  isMobile: false,
  requestLabel: 'Request',
  requestedLabel: 'Requested',
};

beforeEach(cleanup);

describe('ChannelPickerCard', () => {
  it('preserves the enabled card connection action and renders no request button', () => {
    const onConnect = vi.fn();
    render(
      <ChannelPickerCard
        {...baseProps}
        canConnect={true}
        onConnect={onConnect}
        onRequest={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('channel-card-pinterest'));
    expect(onConnect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Request Pinterest' })).toBeNull();
  });

  it('treats an omitted canConnect field as enabled for old backends', () => {
    const onConnect = vi.fn();
    render(
      <ChannelPickerCard
        {...baseProps}
        onConnect={onConnect}
        onRequest={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('channel-card-pinterest'));
    expect(onConnect).toHaveBeenCalledOnce();
  });

  it('preserves the enabled tooltip trigger and desktop card height', () => {
    render(
      <ChannelPickerCard
        {...baseProps}
        canConnect={true}
        toolTip="Requires a business account"
        onConnect={vi.fn()}
        onRequest={vi.fn()}
      />
    );

    const card = screen.getByTestId('channel-card-pinterest');
    expect(card.classList.contains('h-[100px]')).toBe(true);
    expect(card.getAttribute('data-tooltip-id')).toBe('tooltip');
    expect(card.getAttribute('data-tooltip-content')).toBe(
      'Requires a business account'
    );
    expect(card.querySelector('svg')).not.toBeNull();
  });

  it('preserves enabled connection behavior on embedded mobile', () => {
    const onConnect = vi.fn();
    render(
      <ChannelPickerCard
        {...baseProps}
        canConnect={true}
        isMobile={true}
        onConnect={onConnect}
        onRequest={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('channel-card-pinterest'));
    expect(onConnect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('makes an unavailable card body inert and requests only through its button', () => {
    const onConnect = vi.fn();
    const onRequest = vi.fn();
    render(
      <ChannelPickerCard
        {...baseProps}
        canConnect={false}
        onConnect={onConnect}
        onRequest={onRequest}
      />
    );

    fireEvent.click(screen.getByTestId('channel-card-pinterest'));
    expect(onConnect).not.toHaveBeenCalled();
    expect(onRequest).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Request Pinterest' }));
    expect(onRequest).toHaveBeenCalledOnce();
    expect(
      (screen.getByRole('button', {
        name: 'Requested Pinterest',
      }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('suppresses duplicate request events for one mounted card', () => {
    const onRequest = vi.fn();
    render(
      <ChannelPickerCard
        {...baseProps}
        canConnect={false}
        onConnect={vi.fn()}
        onRequest={onRequest}
      />
    );

    const request = screen.getByRole('button', { name: 'Request Pinterest' });
    fireEvent.click(request);
    fireEvent.click(request);

    expect(onRequest).toHaveBeenCalledOnce();
  });

  it('shows Requested even when the analytics callback throws', () => {
    render(
      <ChannelPickerCard
        {...baseProps}
        canConnect={false}
        onConnect={vi.fn()}
        onRequest={() => {
          throw new Error('analytics unavailable');
        }}
      />
    );

    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Request Pinterest' }))
    ).not.toThrow();
    expect(
      (screen.getByRole('button', {
        name: 'Requested Pinterest',
      }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('dims an unavailable mobile card but exposes no request action', () => {
    render(
      <ChannelPickerCard
        {...baseProps}
        canConnect={false}
        isMobile={true}
        onConnect={vi.fn()}
        onRequest={vi.fn()}
      />
    );

    expect(
      screen
        .getByTestId('channel-card-content-pinterest')
        .classList.contains('opacity-50')
    ).toBe(true);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
