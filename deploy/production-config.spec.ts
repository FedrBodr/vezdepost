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

  it('requires personal LinkedIn credentials and documents the OAuth setup', () => {
    const override = readRootFile('docker-compose.override.yaml');
    const readme = readRootFile('deploy/README.md');

    expect(override).toContain(
      "LINKEDIN_CLIENT_ID: '${LINKEDIN_CLIENT_ID:?set in .env}'"
    );
    expect(override).toContain(
      "LINKEDIN_CLIENT_SECRET: '${LINKEDIN_CLIENT_SECRET:?set in .env}'"
    );
    expect(readme).toContain('Sign In with LinkedIn using OpenID Connect');
    expect(readme).toContain('Share on LinkedIn');
    expect(readme).toContain(
      'https://app.vezdepost.ru/integrations/social/linkedin'
    );
  });

  it('forwards required Tumblr credentials into every recreated postiz container', () => {
    const override = readRootFile('docker-compose.override.yaml');

    expect(override).toContain(
      "TUMBLR_CLIENT_ID: '${TUMBLR_CLIENT_ID:?set in .env}'"
    );
    expect(override).toContain(
      "TUMBLR_CLIENT_SECRET: '${TUMBLR_CLIENT_SECRET:?set in .env}'"
    );
  });
});
