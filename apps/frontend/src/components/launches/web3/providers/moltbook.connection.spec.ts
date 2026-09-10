import { describe, expect, it } from 'vitest';
import { isAllowedMoltbookClaimUrl } from './moltbook.connection';

describe('Moltbook claim URL validation', () => {
  it('allows only the official HTTPS claim path', () => {
    expect(
      isAllowedMoltbookClaimUrl(
        'https://www.moltbook.com/claim/moltbook_claim_123'
      )
    ).toBe(true);
  });

  it.each([
    'http://www.moltbook.com/claim/token',
    'https://moltbook.com/claim/token',
    'https://www.moltbook.com.evil.test/claim/token',
    'https://user:pass@www.moltbook.com/claim/token',
    'https://www.moltbook.com/profile/token',
    'not a url',
  ])('rejects %s', (url) => {
    expect(isAllowedMoltbookClaimUrl(url)).toBe(false);
  });
});
