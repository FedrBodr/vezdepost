import { describe, expect, it } from 'vitest';
import { PROFILE_IDENTIFIERS } from '@gitroom/helpers/utils/platform.capability.profiles';
import {
  IntegrationManager,
  socialIntegrationList,
} from './integration.manager';

const REGISTERED_IDENTIFIERS = [
  'x',
  'linkedin',
  'linkedin-page',
  'reddit',
  'instagram',
  'instagram-standalone',
  'facebook',
  'threads',
  'youtube',
  'gmb',
  'tiktok',
  'pinterest',
  'dribbble',
  'discord',
  'slack',
  'kick',
  'twitch',
  'mastodon',
  'bluesky',
  'lemmy',
  'wrapcast',
  'telegram',
  'max',
  'nostr',
  'vk',
  'vk-group',
  'medium',
  'devto',
  'hashnode',
  'wordpress',
  'listmonk',
  'moltbook',
  'whop',
  'skool',
  'mewe',
  'tumblr',
] as const;

describe('registered platform capability matrix', () => {
  it('resolves the exact 36-destination inventory through V2', async () => {
    const identifiers = socialIntegrationList.map(
      (integration) => integration.identifier
    );

    expect(identifiers).toEqual(REGISTERED_IDENTIFIERS);
    expect(new Set(identifiers).size).toBe(36);

    const manager = new IntegrationManager();
    const resolved = await Promise.all(
      identifiers.map((providerName) =>
        manager.resolveCapabilitiesV2({
          providerName,
          settings: {},
          media: [],
        })
      )
    );
    const profiled = new Set<string>(PROFILE_IDENTIFIERS);
    const bridged = resolved.filter(
      ({ verification }) => verification === 'unverified-adapter'
    );

    expect(PROFILE_IDENTIFIERS.length).toBe(12);
    expect(profiled.size).toBe(12);
    expect(bridged).toHaveLength(24);

    const bluesky = resolved.find(
      ({ identifier }) => identifier === 'bluesky'
    );
    expect(bluesky).toMatchObject({
      verification: 'verified',
      profileIdentifier: 'bluesky',
    });

    for (const [index, capability] of resolved.entries()) {
      expect(capability.identifier).toBe(identifiers[index]);

      if (profiled.has(capability.identifier)) {
        expect(capability.verification).not.toBe('unverified-adapter');
      } else {
        expect(capability.verification).toBe('unverified-adapter');
      }

      expect(capability.profileIdentifier).toBe(
        capability.identifier === 'linkedin-page'
          ? 'linkedin'
          : capability.identifier
      );
    }
  });

  it('does not expose the V1 manager capability API', () => {
    expect('getCapabilities' in new IntegrationManager()).toBe(false);
  });
});
