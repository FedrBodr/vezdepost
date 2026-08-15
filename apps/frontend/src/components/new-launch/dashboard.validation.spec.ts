import { describe, expect, it } from 'vitest';
import { selectDashboardContentValidationFailure } from './dashboard.validation';

describe('dashboard content validation priority', () => {
  it('keeps too-long precedence when shared contentError is duplicated', () => {
    expect(
      selectDashboardContentValidationFailure({
        tooLong: true,
        contentError: 'Your post exceeds 500 characters.',
      })
    ).toEqual({ category: 'too-long' });
  });

  it('uses the shared content error when the post is not too long', () => {
    expect(
      selectDashboardContentValidationFailure({
        tooLong: false,
        contentError: 'This platform requires media.',
      })
    ).toEqual({
      category: 'content-error',
      message: 'This platform requires media.',
    });
  });
});
