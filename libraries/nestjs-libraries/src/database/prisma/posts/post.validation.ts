export type PostValidationCategory =
  | 'empty-content'
  | 'invalid-settings'
  | 'provider-validity'
  | 'too-long'
  | 'content-error';

export type PostValidationResult = {
  identifier: string;
  name: string;
  emptyContent: boolean;
  valid: boolean;
  settingsError?: string;
  errors: string | true;
  tooLong: boolean;
  maximumCharacters: number;
  contentError?: string;
};

export type PostValidationFailure = {
  category: PostValidationCategory;
  item: PostValidationResult;
};

/**
 * Selects the first publish-blocking result without choosing caller-specific
 * wording. Empty content remains the only platform failure that blocks drafts.
 *
 * The iteration order intentionally preserves the dashboard's established
 * behavior: empty content wins across all integrations, then each integration
 * is checked in settings/provider/too-long/shared-content priority order.
 */
export function selectPostValidationFailure(
  validation: readonly PostValidationResult[],
  isDraft: boolean
): PostValidationFailure | undefined {
  const emptyItem = validation.find((item) => item.emptyContent);
  if (emptyItem) {
    return { category: 'empty-content', item: emptyItem };
  }

  if (isDraft) {
    return undefined;
  }

  for (const item of validation) {
    if (!item.valid) {
      return { category: 'invalid-settings', item };
    }
    if (item.errors !== true) {
      return { category: 'provider-validity', item };
    }
    if (item.tooLong) {
      return { category: 'too-long', item };
    }
    if (item.contentError) {
      return { category: 'content-error', item };
    }
  }

  return undefined;
}
