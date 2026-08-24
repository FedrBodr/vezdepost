import { describe, expect, it } from 'vitest';
import { parseEnabledSocialIntegrations } from './enabled.social.integrations';

const registered = ['x', 'linkedin', 'telegram', 'vk-group'] as const;

describe('parseEnabledSocialIntegrations', () => {
  it.each([undefined, '', '   \t\n  '])(
    'keeps every registered provider when the value is %j',
    (rawValue) => {
      expect(parseEnabledSocialIntegrations(rawValue, registered)).toEqual({
        configured: false,
        allowed: registered,
        unknown: [],
      });
    }
  );

  it('normalizes, deduplicates, ignores unknown entries, and preserves registry order', () => {
    expect(
      parseEnabledSocialIntegrations(
        ' TELEGRAM, x,telegram, UNKNOWN-PROVIDER, X ',
        registered
      )
    ).toEqual({
      configured: true,
      allowed: ['x', 'telegram'],
      unknown: ['unknown-provider'],
    });
  });

  it('fails closed when a configured value contains no registered identifiers', () => {
    expect(
      parseEnabledSocialIntegrations('unknown-one,UNKNOWN-TWO', registered)
    ).toEqual({
      configured: true,
      allowed: [],
      unknown: ['unknown-one', 'unknown-two'],
    });
  });

  it('ignores empty comma-separated entries without treating the value as unconfigured', () => {
    expect(parseEnabledSocialIntegrations(' , telegram, , ', registered)).toEqual(
      {
        configured: true,
        allowed: ['telegram'],
        unknown: [],
      }
    );
  });
});
