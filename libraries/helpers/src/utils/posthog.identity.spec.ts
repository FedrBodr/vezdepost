import { describe, expect, it, vi } from 'vitest';
import { resetPostHogBeforeRedirect } from './posthog.identity';

describe('resetPostHogBeforeRedirect', () => {
  it('resets the distinct id before navigation', () => {
    const order: string[] = [];
    const reset = vi.fn(() => order.push('reset'));
    const redirect = vi.fn(() => order.push('redirect'));

    resetPostHogBeforeRedirect(reset, redirect);

    expect(reset).toHaveBeenCalledOnce();
    expect(redirect).toHaveBeenCalledOnce();
    expect(order).toEqual(['reset', 'redirect']);
  });

  it('does not let a reset failure block sign-out navigation', () => {
    const redirect = vi.fn();

    expect(() =>
      resetPostHogBeforeRedirect(() => {
        throw new Error('PostHog unavailable');
      }, redirect)
    ).toThrow('PostHog unavailable');
    expect(redirect).toHaveBeenCalledOnce();
  });
});
