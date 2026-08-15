import { describe, expect, it } from 'vitest';
import { IntegrationManager } from './integration.manager';

describe('IntegrationManager capability metadata', () => {
  it('uses the shared registry as the source of the VK limit', () => {
    const manager = new IntegrationManager();
    expect(manager.getCapabilities('vk')).toMatchObject({
      identifier: 'vk',
      verified: true,
      text: { max: 16384 },
    });
  });
});
