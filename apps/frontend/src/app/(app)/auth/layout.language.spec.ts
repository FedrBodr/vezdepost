import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8');

describe('auth language layout', () => {
  it('mounts one modal boundary and language trigger in the shared logo row', () => {
    expect(source).toContain('import { MantineWrapper }');
    expect(source).toContain('import { LanguageComponent }');
    expect(source).toContain('<MantineWrapper>');
    expect(source).toMatch(
      /className="flex items-center justify-between"[\s\S]*<LogoTextComponent \/>[\s\S]*<LanguageComponent \/>/
    );
  });

  it('seeds translated client social proof from the request-fixed locale', () => {
    expect(source).toContain('getRequestLanguage');
    expect(source).toContain('getT');
    expect(source).toContain('const language = await getRequestLanguage();');
    expect(source).toContain('initialLanguage={language}');
    expect(source).toContain('initialTranslations={{');
    expect(source).not.toContain('Entrepreneurs use');
  });
});
