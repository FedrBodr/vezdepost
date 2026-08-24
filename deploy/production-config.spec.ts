import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readRootFile = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8');

describe('production configuration', () => {
  it('requires X credentials and forwards optional PostHog values', () => {
    const override = readRootFile('docker-compose.override.yaml');
    const example = readRootFile('.env.example');
    const readme = readRootFile('deploy/README.md');

    expect(override).toContain(
      "X_API_KEY: '${X_API_KEY:?set in .env}'"
    );
    expect(override).toContain(
      "X_API_SECRET: '${X_API_SECRET:?set in .env}'"
    );
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
    expect(readme).toContain('https://app.vezdepost.ru/integrations/social/x');
    expect(readme).toContain('OAuth 1.0a');
    expect(readme).toContain('Read and write');
  });

  it('preserves self-host defaults and tracks the exact Vezdepost allowlist', () => {
    const base = readRootFile('docker-compose.yaml');
    const override = readRootFile('docker-compose.override.yaml');
    const example = readRootFile('.env.example');
    const readme = readRootFile('deploy/README.md');
    const productionAllowlist =
      "ENABLED_SOCIAL_INTEGRATIONS: 'telegram,max,vk,vk-group,x,linkedin,tumblr'";

    expect(base).toContain(
      "ENABLED_SOCIAL_INTEGRATIONS: '${ENABLED_SOCIAL_INTEGRATIONS:-}'"
    );
    const configuredValue = override.match(
      /^\s*ENABLED_SOCIAL_INTEGRATIONS: '([^']+)'$/m
    )?.[1];

    expect(override).toContain(productionAllowlist);
    expect(configuredValue).toBe(
      'telegram,max,vk,vk-group,x,linkedin,tumblr'
    );
    expect(configuredValue?.split(',')).not.toContain('pinterest');
    expect(example).toContain('ENABLED_SOCIAL_INTEGRATIONS=""');
    expect(example).toContain(
      'Blank or unset keeps every registered provider connectable.'
    );
    expect(readme).toContain(
      'telegram,max,vk,vk-group,x,linkedin,tumblr'
    );
    expect(readme).toContain('Pinterest remains request-only');
    expect(readme).toContain('rtk docker compose config --quiet');
    expect(readme).toContain(
      'Unknown identifiers are ignored while valid identifiers remain enabled; a configured list containing only unknown identifiers fails closed and allows no new connections.'
    );
    expect(readme).toContain(
      'After changing ENABLED_SOCIAL_INTEGRATIONS, restart or recreate the postiz service/container for the updated environment to take effect.'
    );
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

  it('requires Pinterest credentials and documents the Trial OAuth setup', () => {
    const override = readRootFile('docker-compose.override.yaml');
    const readme = readRootFile('deploy/README.md');

    expect(override).toContain(
      "PINTEREST_CLIENT_ID: '${PINTEREST_CLIENT_ID:?set in .env}'"
    );
    expect(override).toContain(
      "PINTEREST_CLIENT_SECRET: '${PINTEREST_CLIENT_SECRET:?set in .env}'"
    );
    expect(readme).toContain(
      'https://app.vezdepost.ru/integrations/social/pinterest'
    );
    expect(readme).toContain('Trial access');
    expect(readme).toContain('19-deploy-pinterest-trial.sh');
  });

  it('loads gated external Caddy sites through the shared edge network', () => {
    const override = readRootFile('docker-compose.override.yaml');
    const caddyfile = readRootFile('deploy/Caddyfile');

    expect(override).toContain('/etc/caddy/sites:/etc/caddy/sites:ro');
    expect(override).toMatch(
      /caddy:[\s\S]*networks:[\s\S]*- postiz-network[\s\S]*- caddy-edge/
    );
    expect(override).toMatch(
      /caddy-edge:[\s\S]*external: true[\s\S]*name: caddy-edge/
    );
    expect(caddyfile).toContain('import /etc/caddy/sites/*.caddy');
    expect(caddyfile).not.toContain('ksy-deals.fedrbodr.com');
  });
});
