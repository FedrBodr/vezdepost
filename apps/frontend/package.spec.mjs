import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

test('the frontend production builds use Turbopack', async () => {
  const frontendPackage = JSON.parse(
    await readFile(new URL('./package.json', import.meta.url), 'utf8')
  );

  expect(frontendPackage.scripts.build).toBe('next build');
  expect(frontendPackage.scripts['build:sentry']).toBe(
    'dotenv -e ../../.env -- next build'
  );
});

test('Turbopack uses the current monorepo checkout as its root', async () => {
  const { default: nextConfig } = await import('./next.config.js');
  const frontendDirectory = fileURLToPath(new URL('.', import.meta.url));

  expect(nextConfig.turbopack?.root).toBe(resolve(frontendDirectory, '../..'));
});
