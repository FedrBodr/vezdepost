import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readRootFile = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8');

describe('production configuration', () => {
  it('forwards optional X and PostHog values and documents their setup', () => {
    const override = readRootFile('docker-compose.override.yaml');
    const example = readRootFile('.env.example');
    const readme = readRootFile('deploy/README.md');

    expect(override).toContain("X_API_KEY: '${X_API_KEY:-}'");
    expect(override).toContain("X_API_SECRET: '${X_API_SECRET:-}'");
    expect(override).toContain(
      "NEXT_PUBLIC_POSTHOG_KEY: '${NEXT_PUBLIC_POSTHOG_KEY:-}'"
    );
    expect(override).toContain(
      "NEXT_PUBLIC_POSTHOG_HOST: '${NEXT_PUBLIC_POSTHOG_HOST:-}'"
    );
    expect(example).toContain('NEXT_PUBLIC_POSTHOG_KEY=""');
    expect(example).toContain(
      'NEXT_PUBLIC_POSTHOG_HOST="https://eu.i.posthog.com"'
    );
    expect(readme).toContain(
      'https://app.vezdepost.ru/integrations/social/x'
    );
    expect(readme).toContain('OAuth 1.0a');
    expect(readme).toContain('Read and write');
  });
});
