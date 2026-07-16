import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  getSafeErrorMessage,
  runAnalyticsSafely,
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
      /const safeMessage = getSafeErrorMessage\(\s*errorData,[\s\S]*?setErrorMessage\(safeMessage\);[\s\S]*?setError\(true\);[\s\S]*?runAnalyticsSafely\(\(\) =>\s*analytics\.failed\(provider, 'callback', safeMessage\)\s*\)/
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
      /const safeMessage = getSafeErrorMessage\(\s*errorData,[\s\S]*?setErrorMessage\(safeMessage\);[\s\S]*?setError\(true\);[\s\S]*?runAnalyticsSafely\(\(\) =>\s*analytics\.failed\(provider, 'two_step_save', safeMessage\)\s*\)/
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
});
