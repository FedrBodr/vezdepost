import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  getConnectionType,
  isUsableStartUrl,
  runAnalyticsSafely,
  submitCustomFieldConnection,
} from './add.provider.component';

const source = readFileSync(
  new URL('./add.provider.component.tsx', import.meta.url),
  'utf8'
);

const response = (ok: boolean, body: unknown) =>
  ({ ok, json: vi.fn().mockResolvedValue(body) }) as unknown as Response;

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

  it('records terminal custom-field outcomes and makes failures actionable', () => {
    expect(source).toContain('onCompleted?: () => void;');
    expect(source).toContain('onCompleted: () => onCompleted?.(),');
    expect(source).toContain('onCompleted={() =>');
    expect(source).toContain('analytics.completed(identifier, !!onboarding)');
    expect(source).toContain('onStartFailure={showStartFailure}');
    expect(source).not.toContain(
      "result.message || result.msg || 'Could not connect the channel'"
    );
  });

  it('completes and redirects a successful custom-field connection once', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(true, { url: 'connection-state' }))
      .mockResolvedValueOnce(response(true, { returnURL: '/done' }));
    const onFailed = vi.fn();
    const onCompleted = vi.fn();
    const onRedirect = vi.fn();

    await submitCustomFieldConnection({
      fetcher,
      identifier: 'listmonk',
      onboarding: false,
      data: { token: 'credential-value' },
      onFailed,
      onCompleted,
      onRedirect,
    });

    expect(onFailed).not.toHaveBeenCalled();
    expect(onCompleted).toHaveBeenCalledOnce();
    expect(onRedirect).toHaveBeenCalledWith('/done');
  });

  it.each([
    ['non-OK response', vi.fn().mockResolvedValue(response(false, {}))],
    ['malformed start response', vi.fn().mockResolvedValue(response(true, {}))],
    ['rejected fetch', vi.fn().mockRejectedValue(new Error('offline'))],
  ])('fails a custom-field connection on %s', async (_name, fetcher) => {
    const onFailed = vi.fn();
    const onCompleted = vi.fn();
    const onRedirect = vi.fn();

    await submitCustomFieldConnection({
      fetcher,
      identifier: 'listmonk',
      onboarding: true,
      data: { token: 'credential-value' },
      onFailed,
      onCompleted,
      onRedirect,
    });

    expect(onFailed).toHaveBeenCalledOnce();
    expect(onCompleted).not.toHaveBeenCalled();
    expect(onRedirect).not.toHaveBeenCalled();
  });
});
