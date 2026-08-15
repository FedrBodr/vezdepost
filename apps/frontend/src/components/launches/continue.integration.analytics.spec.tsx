import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  getLocalizedConnectionError,
  getSafeErrorMessage,
  normalizeIntegrationCallbackParams,
  runAnalyticsSafely,
  VK_GROUP_SAFE_CONNECTION_MESSAGES,
} from './continue.integration';

const source = readFileSync(
  new URL('./continue.integration.tsx', import.meta.url),
  'utf8'
);
const callbackEffect = source.slice(
  source.indexOf('useEffect(() => {'),
  source.indexOf('const onSave = useCallback')
);
const onSaveBlock = source.slice(
  source.indexOf('const onSave = useCallback'),
  source.indexOf('const Provider = useMemo')
);
const errorRender = source.slice(
  source.indexOf('if (error) {'),
  source.indexOf('// Loading state')
);

describe('continued provider connection analytics', () => {
  it.each(['vk', 'vk-group'])(
    'normalizes %s callback code with its device binding',
    (provider) => {
      expect(
        normalizeIntegrationCallbackParams(provider, {
          state: 'oauth-state',
          code: 'authorization-code',
          device_id: 'device-id',
        })
      ).toEqual({
        state: 'oauth-state',
        code: 'authorization-code&&&&device-id',
        device_id: 'device-id',
      });
    }
  );

  it('keeps a malformed VK callback safe when device_id is missing', () => {
    expect(
      normalizeIntegrationCallbackParams('vk-group', {
        state: 'oauth-state',
        code: 'authorization-code',
      })
    ).toEqual({
      state: 'oauth-state',
      code: 'authorization-code',
    });
  });

  it('translates only whitelisted VK Group provider failures', () => {
    const russian = JSON.parse(
      readFileSync(
        new URL(
          '../../../../../libraries/react-shared-libraries/src/translation/locales/ru/translation.json',
          import.meta.url
        ),
        'utf8'
      )
    );
    const t = vi.fn(
      (key: string, fallback: string) => russian[key] || fallback
    );
    const selectedGroupError =
      'The selected VK community is not managed by this account.';

    expect(
      getLocalizedConnectionError(
        'vk-group',
        { message: selectedGroupError },
        'Failed to save channel configuration',
        t
      )
    ).toBe('Выбранное сообщество VK не управляется этим аккаунтом.');
    expect(t).toHaveBeenCalledExactlyOnceWith(
      selectedGroupError,
      selectedGroupError
    );

    expect(
      getLocalizedConnectionError(
        'vk-group',
        { message: 'raw upstream body with token fixture' },
        'Failed to save channel configuration',
        t
      )
    ).toBe('Failed to save channel configuration');
  });

  it.each([
    [
      'en',
      'Could not save this channel because its identifier is already used by another provider.',
    ],
    [
      'ru',
      'Не удалось сохранить канал: его идентификатор уже используется другим провайдером.',
    ],
  ] as const)(
    'renders the safe provider-conflict failure through the %s locale',
    (locale, expected) => {
      const messages = JSON.parse(
        readFileSync(
          new URL(
            `../../../../../libraries/react-shared-libraries/src/translation/locales/${locale}/translation.json`,
            import.meta.url
          ),
          'utf8'
        )
      );
      const t = vi.fn(
        (key: string, fallback: string) => messages[key] || fallback
      );
      const conflict =
        'Could not save this channel because its identifier is already used by another provider.';

      expect(
        getLocalizedConnectionError(
          'vk-group',
          { message: conflict },
          'Failed to save channel configuration',
          t
        )
      ).toBe(expected);
      expect(t).toHaveBeenCalledExactlyOnceWith(conflict, conflict);
    }
  );

  it.each([
    ['en', 'Reconnect VK Group through VK authorization and try again.'],
    ['ru', 'Переподключите VK Group через авторизацию VK и попробуйте снова.'],
  ] as const)(
    'renders selection error 5 through the %s locale',
    (locale, expected) => {
      const messages = JSON.parse(
        readFileSync(
          new URL(
            `../../../../../libraries/react-shared-libraries/src/translation/locales/${locale}/translation.json`,
            import.meta.url
          ),
          'utf8'
        )
      );
      const t = (key: string, fallback: string) => messages[key] || fallback;
      const reconnect =
        'Reconnect VK Group through VK authorization and try again.';

      expect(
        getLocalizedConnectionError(
          'vk-group',
          { message: reconnect },
          'Failed to save channel configuration',
          t
        )
      ).toBe(expected);
    }
  );

  it('has English and Russian entries for every shown VK Group provider failure', () => {
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
    const english = locale('en');
    const russian = locale('ru');

    for (const message of VK_GROUP_SAFE_CONNECTION_MESSAGES) {
      expect(english[message], `English: ${message}`).toBe(message);
      expect(russian[message], `Russian: ${message}`).toEqual(
        expect.any(String)
      );
      expect(russian[message], `Russian: ${message}`).not.toBe(message);
    }
  });

  it('accepts only parsed string messages for analytics', () => {
    expect(
      getSafeErrorMessage({ message: 'Callback rejected' }, 'fallback')
    ).toBe('Callback rejected');
    expect(getSafeErrorMessage({ msg: 'Provider rejected' }, 'fallback')).toBe(
      'Provider rejected'
    );
    expect(getSafeErrorMessage({ message: { secret: true } }, 'fallback')).toBe(
      'fallback'
    );
  });

  it('does not let analytics failures escape callback flows', () => {
    const capture = vi.fn(() => {
      throw new Error('analytics unavailable');
    });

    expect(() => runAnalyticsSafely(capture)).not.toThrow();
    expect(capture).toHaveBeenCalledOnce();
  });

  it('records callback failures with a safe parsed message', () => {
    expect(callbackEffect).toContain(
      "analytics.failed(provider, 'callback', safeMessage)"
    );
    expect(callbackEffect).toMatch(
      /const safeMessage = getLocalizedConnectionError\(\s*provider,\s*errorData,[\s\S]*?setErrorMessage\(safeMessage\);[\s\S]*?setError\(true\);[\s\S]*?runAnalyticsSafely\(\(\) =>\s*analytics\.failed\(provider, 'callback', safeMessage\)\s*\)/
    );
  });

  it('records callback completion immediately before navigation', () => {
    expect(callbackEffect).toMatch(
      /runAnalyticsSafely\(\(\) => analytics\.completed\(provider, onboarding\)\);\s*navigateOrShow\(/
    );
  });

  it('records two-step save failures with a safe parsed message', () => {
    expect(onSaveBlock).toContain(
      "analytics.failed(provider, 'two_step_save', safeMessage)"
    );
    expect(onSaveBlock).toMatch(
      /const safeMessage = getLocalizedConnectionError\(\s*provider,\s*errorData,[\s\S]*?setErrorMessage\(safeMessage\);[\s\S]*?setError\(true\);[\s\S]*?runAnalyticsSafely\(\(\) =>\s*analytics\.failed\(provider, 'two_step_save', safeMessage\)\s*\)/
    );
  });

  it('records two-step completion immediately before navigation', () => {
    expect(onSaveBlock).toMatch(
      /runAnalyticsSafely\(\(\) =>\s*analytics\.completed\(provider, twoStepState\.onboarding\)\s*\);\s*navigateOrShow\(/
    );
  });

  it('offers provider-aware support and an explicit return action', () => {
    expect(errorRender).toMatch(
      /<ChannelSupportLink\s+platform=\{provider\}\s+source="connection_error"\s*>/
    );
    expect(errorRender).not.toContain(
      '<Redirect url="/launches" delay={3000} />'
    );
    expect(errorRender).toMatch(/href="\/launches"/);
    expect(errorRender).toContain("'Вернуться к каналам'");
  });

  it('gives the actionable error screen precedence over two-step state', () => {
    expect(source).toContain('if (twoStepState && Provider && !error) {');
  });
});
