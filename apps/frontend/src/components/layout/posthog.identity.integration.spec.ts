import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const logoutSource = readFileSync(
  new URL('./logout.component.tsx', import.meta.url),
  'utf8'
);
const layoutSource = readFileSync(
  new URL('./layout.context.tsx', import.meta.url),
  'utf8'
);

describe('PostHog identity lifecycle wiring', () => {
  it('resets before explicit logout redirect', () => {
    expect(logoutSource).toContain('usePostHog()');
    expect(logoutSource).toContain('resetPostHogBeforeRedirect(');
  });

  it('resets before insecure logout-header and general auth-loss redirects', () => {
    expect(layoutSource).toContain('usePostHog()');
    expect(layoutSource.match(/resetPostHogBeforeRedirect\(/g)).toHaveLength(2);
    expect(layoutSource).toContain("response.status === 401 || response?.headers?.get('logout')");
  });
});
