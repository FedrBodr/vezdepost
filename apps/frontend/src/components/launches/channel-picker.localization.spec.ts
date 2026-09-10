import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { languages } from '@gitroom/react/translation/i18n.config';

const keys = [
  'missing_platform_prompt',
  'missing_platform_email',
  'request_platform',
  'platform_requested',
  'request_new_platform_email_subject',
  'provider_connection_help_email_subject',
] as const;

const catalogue = (language: string) => {
  const path = new URL(
    `../../../../../libraries/react-shared-libraries/src/translation/locales/${language}/translation.json`,
    import.meta.url
  );
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
};

describe('channel-picker translations', () => {
  it('defines every reviewed key in all 14 configured locales', () => {
    expect(languages).toEqual([
      'en',
      'he',
      'ru',
      'zh',
      'fr',
      'es',
      'pt',
      'de',
      'it',
      'ja',
      'ko',
      'ar',
      'tr',
      'vi',
    ]);
    for (const language of languages) {
      for (const key of keys) {
        expect(catalogue(language)[key], `${language}.${key}`).toBeTruthy();
      }
      expect(
        catalogue(language).provider_connection_help_email_subject,
        `${language} provider interpolation`
      ).toContain('{{platform}}');
    }
  });

  it('pins the reviewed English and Russian copy', () => {
    expect(keys.map((key) => catalogue('en')[key])).toEqual([
      "Can't find the platform you need?",
      "Email us — we'll try to add it.",
      'Request',
      'Requested',
      'Request a new platform in Vezdepost',
      "Can't connect {{platform}} in Vezdepost",
    ]);
    expect(keys.map((key) => catalogue('ru')[key])).toEqual([
      'Не нашли нужную платформу?',
      'Напишите нам — постараемся добавить.',
      'Запросить',
      'Запрошено',
      'Нужна новая платформа в Вездепосте',
      'Не подключается {{platform}} в Вездепосте',
    ]);
  });
});
