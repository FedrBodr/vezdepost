import { describe, expect, it } from 'vitest';
import { BlueskyProvider } from './bluesky.provider';
import { DevToProvider } from './dev.to.provider';
import { HashnodeProvider } from './hashnode.provider';
import { LemmyProvider } from './lemmy.provider';
import { ListmonkProvider } from './listmonk.provider';
import { MediumProvider } from './medium.provider';
import { NostrProvider } from './nostr.provider';
import { VkGroupProvider } from './vk.group.provider';
import { WordpressProvider } from './wordpress.provider';

const providers = [
  new BlueskyProvider(),
  new DevToProvider(),
  new HashnodeProvider(),
  new LemmyProvider(),
  new ListmonkProvider(),
  new MediumProvider(),
  new NostrProvider(),
  new VkGroupProvider(),
  new WordpressProvider(),
];

describe('manual social connection guides', () => {
  it.each(providers)('$name publishes an always-visible guide', (provider) => {
    expect(provider.customFields).toBeTypeOf('function');
    expect(provider.customFieldsInstructions?.title.trim()).not.toBe('');
    expect(
      provider.customFieldsInstructions?.items.length
    ).toBeGreaterThanOrEqual(2);
    expect(provider.customFieldsInstructions?.collapsible).not.toBe(true);
  });

  it('names dedicated credentials and high-risk limitations', () => {
    const [bluesky, , , , , medium, nostr, , wordpress] = providers;

    expect(bluesky.customFieldsInstructions?.items.join(' ')).toContain(
      'App Password'
    );
    expect(wordpress.customFieldsInstructions?.items.join(' ')).toContain(
      'Application Password'
    );
    expect(medium.customFieldsInstructions?.warning).toContain(
      'no longer supports'
    );
    expect(nostr.customFieldsInstructions?.warning).toContain('private key');
  });
});
