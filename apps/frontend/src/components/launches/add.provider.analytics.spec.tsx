import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  getConnectionType,
  isUsableStartUrl,
  runAnalyticsSafely,
} from './add.provider.component';

const source = readFileSync(
  new URL('./add.provider.component.tsx', import.meta.url),
  'utf8'
);

describe('provider connection analytics', () => {
  it('derives the connection type by provider precedence', () => {
    expect(getConnectionType({ isWeb3: true })).toBe('web3');
    expect(getConnectionType({ isChromeExtension: true })).toBe(
      'browser_extension'
    );
    expect(getConnectionType({ isExternal: true })).toBe('external');
    expect(getConnectionType({ customFields: [] })).toBe('custom_fields');
    expect(getConnectionType({})).toBe('oauth');
  });

  it('accepts only non-empty string start URLs', () => {
    expect(isUsableStartUrl('https://example.com')).toBe(true);
    expect(isUsableStartUrl(' oauth-state ')).toBe(true);
    expect(isUsableStartUrl('   ')).toBe(false);
    expect(isUsableStartUrl({})).toBe(false);
    expect(isUsableStartUrl(1)).toBe(false);
  });

  it('does not let analytics failures escape into connection flows', () => {
    const capture = vi.fn(() => {
      throw new Error('analytics unavailable');
    });
    expect(() => runAnalyticsSafely(capture)).not.toThrow();
    expect(capture).toHaveBeenCalledOnce();
  });

  it('tracks provider clicks, successful starts, and safe start failures', () => {
    expect(source).toMatch(/analytics\.clicked\(/);
    expect(source).toMatch(/analytics\.started\(/);
    expect(source).toContain(
      "analytics.failed(identifier, 'start', safeMessage)"
    );
    expect(source).toMatch(
      /<ChannelSupportLink\s+platform=\{identifier\}\s+source="connection_error"\s*>/
    );
    expect(source).toMatch(
      /if \(!isExternal\) \{[\s\S]{0,120}analytics\.started\(connectionContext\)/
    );
    expect(source).toContain('onStartFailure(safeMessage)');
    expect(source).not.toContain(
      "toaster.show('Could not start the channel connection', 'warning')"
    );
  });

  it('offers a platform request link from the picker footer', () => {
    expect(source).toContain('<ChannelSupportLink source="channel_picker"');
    expect(source).not.toMatch(
      /<ChannelSupportLink\s+platform=[^>]+source="channel_picker"/
    );
  });
});
