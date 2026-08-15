import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getLocalizedPostPublishingError } from './post-publishing-error';

const locale = (name: 'en' | 'ru') =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../../../libraries/react-shared-libraries/src/translation/locales/${name}/translation.json`,
        import.meta.url
      ),
      'utf8'
    )
  );

describe('VK Group calendar publication errors', () => {
  it.each([
    [
      'en',
      'Reconnect VK Group through VK authorization to publish photographs.',
    ],
    [
      'ru',
      'Переподключите VK Group через авторизацию VK, чтобы публиковать фотографии.',
    ],
  ] as const)(
    'extracts and translates serialized error 27 in %s',
    (language, expected) => {
      const messages = locale(language);
      const t = (key: string, fallback: string) => messages[key] || fallback;
      const serialized = JSON.stringify({
        name: 'ApplicationFailure',
        cause: {
          message:
            'Reconnect VK Group through VK authorization to publish photographs.',
          details: [{ body: '<img src=x onerror=alert(1)>' }],
        },
      });

      expect(getLocalizedPostPublishingError('vk-group', serialized, t)).toBe(
        expected
      );
    }
  );

  it.each([
    [
      'en',
      'VK Group photo access is missing. Reconnect VK Group through VK authorization and grant photo access.',
    ],
    [
      'ru',
      'Нет доступа к фотографиям VK Group. Переподключите VK Group через авторизацию VK и предоставьте доступ к фотографиям.',
    ],
  ] as const)(
    'extracts and translates serialized error 15 in %s',
    (language, expected) => {
      const messages = locale(language);
      const t = (key: string, fallback: string) => messages[key] || fallback;

      expect(
        getLocalizedPostPublishingError(
          'vk-group',
          JSON.stringify({
            message:
              'VK Group photo access is missing. Reconnect VK Group through VK authorization and grant photo access.',
          }),
          t
        )
      ).toBe(expected);
    }
  );

  it('never renders an unknown raw serialized workflow failure', () => {
    const t = (key: string, fallback: string) =>
      key === 'An error occurred while publishing this post'
        ? 'Не удалось опубликовать публикацию'
        : fallback;
    const raw = JSON.stringify({
      message: '<img src=x onerror=alert(1)>',
      details: [{ token: 'raw-token-fixture' }],
    });

    const displayed = getLocalizedPostPublishingError('vk-group', raw, t);

    expect(displayed).toBe('Не удалось опубликовать публикацию');
    expect(displayed).not.toContain('onerror');
    expect(displayed).not.toContain('raw-token-fixture');
  });

  it('preserves a Telegram publishing error unchanged', () => {
    const stable =
      'Reconnect VK Group through VK authorization to publish photographs.';

    expect(
      getLocalizedPostPublishingError(
        'telegram',
        stable,
        (_key, fallback) => fallback
      )
    ).toBe(stable);
  });
});
