import { describe, expect, it } from 'vitest';
import { selectPostValidationFailure } from './post.validation';

const clean = {
  identifier: 'pinterest',
  name: 'Pinterest',
  contentError: '',
  emptyContent: false,
  valid: true,
  settingsError: '',
  errors: true as const,
  tooLong: false,
  maximumCharacters: 500,
};

describe('selectPostValidationFailure', () => {
  it('keeps the established category priority for a publishable post', () => {
    expect(
      selectPostValidationFailure(
        [
          {
            ...clean,
            valid: false,
            errors: 'Provider error',
            tooLong: true,
            contentError: 'Shared error',
          },
        ],
        false
      )?.category
    ).toBe('invalid-settings');

    expect(
      selectPostValidationFailure(
        [
          {
            ...clean,
            errors: 'Provider error',
            tooLong: true,
            contentError: 'Shared error',
          },
        ],
        false
      )?.category
    ).toBe('provider-validity');

    expect(
      selectPostValidationFailure(
        [{ ...clean, tooLong: true, contentError: 'Shared error' }],
        false
      )?.category
    ).toBe('too-long');
  });

  it('blocks empty drafts but permits other draft platform errors', () => {
    expect(
      selectPostValidationFailure(
        [{ ...clean, emptyContent: true, contentError: 'Shared error' }],
        true
      )?.category
    ).toBe('empty-content');
    expect(
      selectPostValidationFailure(
        [{ ...clean, contentError: 'Shared error' }],
        true
      )
    ).toBeUndefined();
  });
});
