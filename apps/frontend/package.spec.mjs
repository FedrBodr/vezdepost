import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

test('the frontend production builds use webpack', async () => {
  const frontendPackage = JSON.parse(
    await readFile(new URL('./package.json', import.meta.url), 'utf8')
  );

  expect(frontendPackage.scripts.build).toBe('next build --webpack');
  expect(frontendPackage.scripts['build:sentry']).toBe(
    'dotenv -e ../../.env -- next build --webpack'
  );
});
