import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

try {
  require('bcrypt');
  require('@prisma/client');
} catch (error) {
  console.error(
    'Workspace lifecycle artifacts are missing. Run `pnpm install --frozen-lockfile` without `--ignore-scripts`, then retry.'
  );
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

if (!process.exitCode) {
  console.log('Workspace lifecycle artifacts are ready.');
}
