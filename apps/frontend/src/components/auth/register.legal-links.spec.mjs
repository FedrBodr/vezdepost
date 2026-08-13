import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const registerSource = readFileSync(
  join(
    process.cwd(),
    'apps/frontend/src/components/auth/register.tsx'
  ),
  'utf8'
);

describe('registration legal links', () => {
  it('opens the Vezdepost privacy policy safely in a new tab', () => {
    const privacyAnchor = registerSource.match(
      /<a\s+[\s\S]*?href="https:\/\/vezdepost\.ru\/privacy"[\s\S]*?>/
    )?.[0];

    expect(privacyAnchor).toBeDefined();
    expect(privacyAnchor).toContain('target="_blank"');
    expect(privacyAnchor).toContain('rel="noopener noreferrer nofollow"');
    expect(registerSource).not.toContain('https://postiz.com/privacy');
  });
});
