import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

test('the frontend release build uses webpack', async () => {
  const frontendPackage = JSON.parse(
    await readFile(new URL('./package.json', import.meta.url), 'utf8')
  );

  expect(frontendPackage.scripts.build).toBe('next build --webpack');
});
