import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CustomFieldsInstructionsDefinition } from './social.integrations.interface';
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

const locale = (language: 'en' | 'ru') =>
  JSON.parse(
    readFileSync(
      `libraries/react-shared-libraries/src/translation/locales/${language}/translation.json`,
      'utf8'
    )
  ) as Record<string, string>;

const guideStrings = (guide: CustomFieldsInstructionsDefinition) =>
  [
    guide.title,
    ...guide.items,
    guide.note,
    guide.notRequired,
    guide.warning,
  ].filter((value): value is string => Boolean(value));

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

  it('ships every guide sentence and dedicated field label in English and Russian', () => {
    const english = locale('en');
    const russian = locale('ru');
    const strings = providers.flatMap((provider) =>
      guideStrings(provider.customFieldsInstructions!)
    );

    for (const value of strings) {
      expect(english[value], `missing English copy: ${value}`).toBe(value);
      expect(russian[value], `missing Russian copy: ${value}`).toBeTruthy();
      expect(russian[value], `untranslated Russian copy: ${value}`).not.toBe(
        value
      );
    }

    expect(english.label_bluesky_app_password).toBe('App Password');
    expect(russian.label_bluesky_app_password).toBe('Пароль приложения');
    expect(english.label_wordpress_application_password).toBe(
      'Application Password'
    );
    expect(russian.label_wordpress_application_password).toBe(
      'Пароль приложения'
    );
  });
});
