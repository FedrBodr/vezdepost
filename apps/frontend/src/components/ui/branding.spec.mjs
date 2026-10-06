import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const sourceFiles = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.spec\./.test(name) ? [path] : [];
  });

describe('Vezdepost branding', () => {
  it('keeps the Postiz brand name out of visible frontend copy', () => {
    const offenders = sourceFiles(join(root, 'apps/frontend/src')).filter(
      (file) =>
        readFileSync(file, 'utf8')
          .replace(/open-source Postiz project/g, '')
          .match(/(?<![\w/@-])Postiz\b/)
    );
    expect(offenders).toEqual([]);
  });

  it('does not send users to the Postiz CLI or n8n packages', () => {
    const offenders = sourceFiles(join(root, 'apps/frontend/src')).filter(
      (file) =>
        /npm install -g postiz|postiz-agent|n8n-nodes-postiz/.test(
          readFileSync(file, 'utf8')
        )
    );
    expect(offenders).toEqual([]);
  });

  it('keeps the Postiz brand name out of translations except fork attribution', () => {
    const locales = join(
      root,
      'libraries/react-shared-libraries/src/translation/locales'
    );
    for (const lang of readdirSync(locales)) {
      const values = Object.values(
        JSON.parse(readFileSync(join(locales, lang, 'translation.json'), 'utf8'))
      ).join('\n');
      const stripped = values
        .replace(/open-source Postiz project/g, '')
        .replace(/open-source проекта Postiz/g, '');
      expect({ lang, hasPostiz: /Postiz/.test(stripped) }).toEqual({
        lang,
        hasPostiz: false,
      });
    }
  });

  it('replaces the legacy Postiz logo files with the Vezdepost mark', () => {
    for (const name of [
      'postiz.svg',
      'postiz-text.svg',
      'logo.svg',
      'logo-text.svg',
    ]) {
      const svg = readFileSync(join(root, 'apps/frontend/public', name), 'utf8');
      expect({ name, mark: svg.includes('data:image/png;base64,') }).toEqual({
        name,
        mark: true,
      });
    }
  });

  it('serves the Vezdepost favicon from every root layout', () => {
    for (const group of ['(app)', '(provider)', '(extension)']) {
      const layout = readFileSync(
        join(root, 'apps/frontend/src/app', group, 'layout.tsx'),
        'utf8'
      );
      expect(layout).toContain('href="/favicon.ico"');
      expect(layout).toContain('href="/apple-touch-icon.png"');
    }
  });
});
