import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntegrationManager } from './integration.manager';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('IntegrationManager capability metadata', () => {
  it('uses the shared registry as the source of the VK limit', () => {
    const manager = new IntegrationManager();
    expect(manager.getCapabilities('vk')).toMatchObject({
      identifier: 'vk',
      verified: true,
      text: { max: 16384 },
    });
  });

  it('passes provider settings to legacy capability limits', () => {
    const manager = new IntegrationManager();
    expect(
      manager.getCapabilities('x', [{ title: 'Verified', value: true }])
    ).toMatchObject({
      identifier: 'x',
      verified: false,
      text: { max: 4000 },
    });
  });

  it('derives raw URL stripping from an X-style legacy provider', () => {
    vi.stubEnv('STRIP_LINKS_FROM_X_POSTS', 'true');

    expect(new IntegrationManager().getCapabilities('x')).toMatchObject({
      identifier: 'x',
      verified: false,
      delivery: { stripRawUrls: true },
    });
  });

  it('overlays explicit provider URL stripping on a verified profile', () => {
    const manager = new IntegrationManager();
    const capabilities = manager.getCapabilities('telegram');
    const provider = new Proxy(manager.getSocialIntegration('telegram'), {
      get(target, property, receiver) {
        if (property === 'capabilities') return capabilities;
        if (property === 'stripLinks') return () => true;
        return Reflect.get(target, property, receiver);
      },
    });
    vi.spyOn(manager, 'getSocialIntegration').mockReturnValue(provider);

    expect(manager.getCapabilities('future-verified')).toMatchObject({
      verified: true,
      delivery: { stripRawUrls: true },
    });
  });
});
