import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  getConnectionType,
  isUsableStartUrl,
  runAnalyticsSafely,
  submitCustomFieldConnection,
  VK_GROUP_SAFE_CONNECTION_MESSAGES,
} from './add.provider.component';

const source = readFileSync(
  new URL('./add.provider.component.tsx', import.meta.url),
  'utf8'
);

const response = (ok: boolean, body: unknown) =>
  ({ ok, json: vi.fn().mockResolvedValue(body) } as unknown as Response);

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

  it('propagates a safe string connection failure message', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(true, { url: 'connection-state' }))
      .mockResolvedValueOnce(
        response(false, { msg: 'The VK community token is invalid.' })
      );
    const onFailed = vi.fn();
    const onCompleted = vi.fn();
    const onRedirect = vi.fn();

    await submitCustomFieldConnection({
      fetcher,
      identifier: 'vk-group',
      data: { accessToken: 'credential-value' },
      onFailed,
      onCompleted,
      onRedirect,
    });

    expect(onFailed).toHaveBeenCalledWith('The VK community token is invalid.');
    expect(onCompleted).not.toHaveBeenCalled();
    expect(onRedirect).not.toHaveBeenCalled();
  });

  it.each([
    'Enter a valid VK community link or short name.',
    'The VK community token is invalid.',
    'This token belongs to a different VK community.',
    'The VK community key must allow community management, community wall, and photographs access. Recreate the key and reconnect VK Group.',
  ])('propagates the known VK Group authentication error %s', async (msg) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(true, { url: 'connection-state' }))
      .mockResolvedValueOnce(response(false, { msg }));
    const onFailed = vi.fn();

    await submitCustomFieldConnection({
      fetcher,
      identifier: 'vk-group',
      data: { accessToken: 'credential-value' },
      onFailed,
      onCompleted: vi.fn(),
      onRedirect: vi.fn(),
    });

    expect(onFailed).toHaveBeenCalledWith(msg);
  });

  it('allows exactly the current VK Group authentication errors', () => {
    expect(VK_GROUP_SAFE_CONNECTION_MESSAGES).toEqual(
      new Set([
        'Enter a valid VK community link or short name.',
        'The VK community token is invalid.',
        'This token belongs to a different VK community.',
        'The VK community key must allow community management, community wall, and photographs access. Recreate the key and reconnect VK Group.',
      ])
    );
  });

  it.each([
    ['token', 'vk1.a.secret-community-access-token'],
    ['upload URL', 'https://up.vk.com/upload.php?act=do_upload'],
    ['media URL', 'https://sun9-22.userapi.com/private-photo.jpg'],
    [
      'multipart form body',
      '------WebKitFormBoundary\r\nContent-Disposition: form-data; name="photo"',
    ],
    [
      'upstream payload',
      '{"error":{"error_code":15,"error_msg":"Access denied"}}',
    ],
  ])('keeps a VK Group %s out of the UI and analytics', async (_name, msg) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(true, { url: 'connection-state' }))
      .mockResolvedValueOnce(response(false, { msg }));
    const onFailed = vi.fn();

    await submitCustomFieldConnection({
      fetcher,
      identifier: 'vk-group',
      data: { accessToken: 'credential-value' },
      onFailed,
      onCompleted: vi.fn(),
      onRedirect: vi.fn(),
    });

    expect(onFailed).toHaveBeenCalledWith(undefined);
  });

  it('keeps VK Group detail strings generic for other providers', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(true, { url: 'connection-state' }))
      .mockResolvedValueOnce(
        response(false, { msg: 'The VK community token is invalid.' })
      );
    const onFailed = vi.fn();

    await submitCustomFieldConnection({
      fetcher,
      identifier: 'listmonk',
      data: { token: 'credential-value' },
      onFailed,
      onCompleted: vi.fn(),
      onRedirect: vi.fn(),
    });

    expect(onFailed).toHaveBeenCalledWith(undefined);
  });

  it('rebuilds localized custom-field validation when the translator changes', () => {
    expect(source).toMatch(/\}, \[t, variables\]\);/);
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
