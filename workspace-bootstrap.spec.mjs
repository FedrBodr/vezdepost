import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

test('the workspace exposes a lifecycle artifact preflight', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('./package.json', import.meta.url), 'utf8')
  );
  const projectInstructions = await readFile(
    new URL('./CLAUDE.md', import.meta.url),
    'utf8'
  );

  expect(packageJson.scripts['verify:workspace']).toBe(
    'node scripts/verify-workspace-bootstrap.mjs'
  );
  expect(projectInstructions).toContain('pnpm install --frozen-lockfile');
  expect(projectInstructions).toContain('pnpm run verify:workspace');
  expect(projectInstructions).toContain('Never use `--ignore-scripts`');
});
