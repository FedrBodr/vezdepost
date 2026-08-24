import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8');

describe('app root locale metadata', () => {
  it('uses the request locale for root language, direction, and client context', () => {
    expect(source).toContain('const language = await getRequestLanguage();');
    expect(source).toContain(
      'const direction = getLanguageDirection(language);'
    );
    expect(source).toContain('<html lang={language} dir={direction}>');
    expect(source).toContain('language={language}');
  });
});
