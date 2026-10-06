import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readRootFile = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8');

describe('production configuration', () => {
  it('keeps request-only X credentials optional and forwards optional PostHog values', () => {
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
    expect(override).toContain(
      "MOBILE_ROUTE_ENABLED: '${MOBILE_ROUTE_ENABLED:-false}'"
    );
    expect(override).toContain(
      "MAX_ASSISTANT_TOKEN: '${MAX_ASSISTANT_TOKEN:-}'"
    );
    expect(override).toContain(
      "MAX_ASSISTANT_BOT_NAME: '${MAX_ASSISTANT_BOT_NAME:-}'"
    );
    expect(example).toContain('MAX_ASSISTANT_TOKEN=""');
    expect(example).toContain('MOBILE_ROUTE_ENABLED="false"');
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
      "ENABLED_SOCIAL_INTEGRATIONS: 'telegram,telegram-stories,max,vk,vk-group,linkedin,tumblr,bluesky,wordpress,devto,hashnode,lemmy,nostr,listmonk'";

    expect(base).toContain(
      "ENABLED_SOCIAL_INTEGRATIONS: '${ENABLED_SOCIAL_INTEGRATIONS:-}'"
    );
    const configuredValue = override.match(
      /^\s*ENABLED_SOCIAL_INTEGRATIONS: '([^']+)'$/m
    )?.[1];

    expect(override).toContain(productionAllowlist);
    expect(configuredValue).toBe('telegram,telegram-stories,max,vk,vk-group,linkedin,tumblr,bluesky,wordpress,devto,hashnode,lemmy,nostr,listmonk');
    expect(configuredValue?.split(',')).not.toContain('x');
    expect(configuredValue?.split(',')).not.toContain('pinterest');
    expect(example).toContain('ENABLED_SOCIAL_INTEGRATIONS=""');
    expect(example).toContain(
      'Blank or unset keeps every registered provider connectable.'
    );
    expect(readme).toContain('telegram,telegram-stories,max,vk,vk-group,linkedin,tumblr,bluesky,wordpress,devto,hashnode,lemmy,nostr,listmonk');
    expect(readme).toMatch(/X remains\s+request-only/);
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

  it('keeps a 30-day access log with referrers for both Vezdepost sites', () => {
    const caddyfile = readRootFile('deploy/Caddyfile');
    const override = readRootFile('docker-compose.override.yaml');

    expect(caddyfile).toMatch(
      /\(access_log\) \{[\s\S]*output file \/data\/access-logs\/access\.log[\s\S]*roll_keep_for 720h[\s\S]*format json/
    );
    expect(caddyfile).toMatch(
      /vezdepost\.ru, www\.vezdepost\.ru \{\s*import access_log/
    );
    expect(caddyfile).toMatch(/app\.vezdepost\.ru \{\s*import access_log/);
    expect(override).toContain('caddy-data:/data');
  });

  it('sends the app to the same GA4 stream as the landing', () => {
    const override = readRootFile('docker-compose.override.yaml');
    const landing = readRootFile('deploy/landing/index.html');

    expect(override).toContain("GOOGLE_ANALYTICS_ID: 'G-NG6Q7F0Z9N'");
    expect(landing).toContain('gtag/js?id=G-NG6Q7F0Z9N');
  });

  it('serves UTM-tagged short links on vezdepost.ru from a reloadable directory', () => {
    const caddyfile = readRootFile('deploy/Caddyfile');
    const override = readRootFile('docker-compose.override.yaml');
    const autodeploy = readRootFile('deploy/autodeploy.sh');
    const rules = readRootFile('deploy/links/vezdepost.caddy')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));

    expect(caddyfile).toMatch(
      /vezdepost\.ru, www\.vezdepost\.ru \{[^}]*import \/etc\/caddy\/links\/\*\.caddy/
    );
    expect(override).toContain('./deploy/links:/etc/caddy/links:ro');
    expect(autodeploy).toContain('docker exec caddy caddy reload');

    expect(rules.length).toBeGreaterThan(0);
    const codes = rules.map((rule) => rule.split(' ')[1]);
    expect(new Set(codes).size).toBe(codes.length);
    for (const rule of rules) {
      expect(rule).toMatch(
        /^redir \/go\/[a-z0-9]+(-[a-z0-9]+)* https:\/\/\S+ 302$/
      );
      const url = new URL(rule.split(' ')[2]);
      if (!/(^|\.)(vezdepost\.ru|fedrbodr\.com)$/.test(url.hostname)) continue;
      for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) {
        expect(url.searchParams.get(key) ?? '').toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      }
    }
  });
});
