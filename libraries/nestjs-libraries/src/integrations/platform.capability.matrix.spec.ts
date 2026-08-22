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

    expect(PROFILE_IDENTIFIERS.length).toBe(29);
    expect(profiled.size).toBe(29);
    expect(bridged.map(({ identifier }) => identifier)).toEqual([
      'gmb',
      'dribbble',
      'listmonk',
      'moltbook',
      'whop',
      'skool',
      'mewe',
    ]);

    const ALIASES: Record<string, string> = {
      'linkedin-page': 'linkedin',
      'instagram-standalone': 'instagram',
    };
    const aliased = resolved.filter(
      ({ identifier }) => identifier in ALIASES
    );
    expect(
      aliased.map(({ identifier, profileIdentifier }) => ({
        identifier,
        profileIdentifier,
      }))
    ).toEqual([
      { identifier: 'linkedin-page', profileIdentifier: 'linkedin' },
      { identifier: 'instagram-standalone', profileIdentifier: 'instagram' },
    ]);

    const x = resolved.find(({ identifier }) => identifier === 'x');
    expect(x).toMatchObject({
      verification: 'runtime',
      profileIdentifier: 'x',
    });

    const reddit = resolved.find(({ identifier }) => identifier === 'reddit');
    expect(reddit).toMatchObject({
      verification: 'runtime',
      profileIdentifier: 'reddit',
      variant: 'self',
    });

    const bluesky = resolved.find(
      ({ identifier }) => identifier === 'bluesky'
    );
    expect(bluesky).toMatchObject({
      verification: 'verified',
      profileIdentifier: 'bluesky',
    });

    const facebook = resolved.find(
      ({ identifier }) => identifier === 'facebook'
    );
    expect(facebook).toMatchObject({
      verification: 'verified',
      profileIdentifier: 'facebook',
      variant: 'feed',
    });

    const threads = resolved.find(
      ({ identifier }) => identifier === 'threads'
    );
    expect(threads).toMatchObject({
      verification: 'verified',
      profileIdentifier: 'threads',
      variant: 'text',
    });

    for (const [index, capability] of resolved.entries()) {
      expect(capability.identifier).toBe(identifiers[index]);

      if (profiled.has(capability.identifier)) {
        expect(capability.verification).not.toBe('unverified-adapter');
      } else {
        expect(capability.verification).toBe('unverified-adapter');
      }

      expect(capability.profileIdentifier).toBe(
        ALIASES[capability.identifier] ?? capability.identifier
      );
    }
  });

  it('does not expose the V1 manager capability API', () => {
    expect('getCapabilities' in new IntegrationManager()).toBe(false);
  });
});
