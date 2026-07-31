import { describe, expect, it } from 'vitest';
import { isTrustedLegacyPublication } from './backfill-published-at';

describe('isTrustedLegacyPublication', () => {
  it('accepts only confirmed legacy publications', () => {
    expect(
      isTrustedLegacyPublication({
        state: 'PUBLISHED',
        releaseId: '77',
        releaseURL: 'https://vk.com/wall1_77',
      })
    ).toBe(true);
    expect(
      isTrustedLegacyPublication({
        state: 'PUBLISHED',
        releaseId: 'undefined',
        releaseURL: 'https://vk.com/wall1_undefined',
      })
    ).toBe(false);
    expect(
      isTrustedLegacyPublication({
        state: 'ERROR',
        releaseId: '77',
        releaseURL: 'https://vk.com/wall1_77',
      })
    ).toBe(false);
    expect(
      isTrustedLegacyPublication({
        state: 'PUBLISHED',
        releaseId: null,
        releaseURL: null,
      })
    ).toBe(false);
    expect(
      isTrustedLegacyPublication({
        state: 'PUBLISHED',
        releaseId: '  ',
        releaseURL: 'https://vk.com/wall1_77',
      })
    ).toBe(false);
    expect(
      isTrustedLegacyPublication({
        state: 'PUBLISHED',
        releaseId: '77',
        releaseURL: 'https://vk.com/wall1_undefined',
      })
    ).toBe(false);
  });
});
