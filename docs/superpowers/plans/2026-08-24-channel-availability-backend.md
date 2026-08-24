# Channel Availability Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ENABLED_SOCIAL_INTEGRATIONS` the backward-compatible backend authority for channel catalogue availability and every user-initiated connection path, then configure the seven verified Vezdepost providers in production.

**Architecture:** A pure parser converts the optional comma-separated environment value into a registry-ordered allowlist and an unknown-entry report. `IntegrationManager` parses once per instance, exposes the allowed subset, and adds `canConnect` to the complete catalogue without filtering the provider registry; existing route guards inherit the policy, while the integration service and extension-refresh route add the two missing completion guards. Base Compose remains all-enabled by default for self-hosters, while the Vezdepost production override tracks an exact seven-provider allowlist and requires the X credentials that make the enabled X card truthful.

**Tech Stack:** TypeScript, NestJS, Vitest, Prisma-backed integration service, PNPM workspace, Docker Compose.

## Global Constraints

- Approved design: `docs/superpowers/specs/2026-08-24-onboarding-channel-availability-and-language-design.md`.
- This plan is backend/deployment only: do not modify `apps/frontend/**`, translation catalogues, PostHog UI, or language-selection code.
- Use only PNPM; run lint, builds, and workspace commands from the repository root.
- Execute in an isolated git worktree. In a newly created worktree, run `rtk pnpm install --frozen-lockfile` and then `rtk pnpm run verify:workspace` before the first test.
- Absent, empty, or whitespace-only `ENABLED_SOCIAL_INTEGRATIONS` means every registered social provider is connectable.
- A non-empty value is trimmed, lowercased, deduplicated, intersected with registered identifiers, and returned in registry order; unknown entries are ignored while valid entries remain enabled.
- Warn once per `IntegrationManager` construction/config parse when unknown identifiers are present; never log credentials or other environment values.
- Keep `socialIntegrationList` complete. Do not filter existing integration queries, posting, capabilities, Temporal workflows, or automatic token refresh.
- Block new connections, OAuth/manual reconnect, extension refresh, and two-step completion for unavailable providers before provider code, Redis state creation, or persistence.
- The exact initial Vezdepost production allowlist is `telegram,max,vk,vk-group,x,linkedin,tumblr`; Pinterest remains request-only.
- No database migration, new dependency, frontend change, application email, or Telegram notification is permitted.

---

## File Structure

- Create `libraries/nestjs-libraries/src/integrations/enabled.social.integrations.ts` for the pure environment parser and its result type.
- Create `libraries/nestjs-libraries/src/integrations/enabled.social.integrations.spec.ts` for parser edge cases independent of `process.env`.
- Modify `libraries/nestjs-libraries/src/integrations/integration.manager.ts` to parse configuration once, warn about unknown identifiers, expose `isSocialIntegrationAllowed`, return the configured subset, and serialize `canConnect` on every catalogue item.
- Modify `libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts` for catalogue/default/warning behavior.
- Create `apps/backend/src/api/routes/integration.connection.availability.spec.ts` to prove the four already-guarded controller entry points consume the manager policy.
- Modify `libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts` and its existing spec to guard both two-step page-save routes while leaving automatic refresh untouched.
- Modify `apps/backend/src/api/routes/no.auth.integrations.controller.ts` and its existing spec to guard extension refresh before authentication or persistence.
- Modify `.env.example`, `docker-compose.yaml`, `docker-compose.override.yaml`, `deploy/README.md`, and `deploy/production-config.spec.ts` for the self-host default, exact Vezdepost list, Pinterest exclusion, and required X preflight.

---

### Task 1: Pure Social Integration Allowlist Parser

**Files:**
- Create: `libraries/nestjs-libraries/src/integrations/enabled.social.integrations.ts`
- Create: `libraries/nestjs-libraries/src/integrations/enabled.social.integrations.spec.ts`

**Interfaces:**
- Consumes: `rawValue: string | undefined` and `registeredIdentifiers: readonly string[]`.
- Produces: `parseEnabledSocialIntegrations(rawValue, registeredIdentifiers): SocialIntegrationAllowlistResult` where the result has `configured: boolean`, `allowed: readonly string[]`, and `unknown: readonly string[]`.

- [ ] **Step 1: Bootstrap the isolated worktree**

Run:

```bash
rtk pnpm install --frozen-lockfile
rtk pnpm run verify:workspace
```

Expected: both commands exit 0; the workspace verifier reports a valid bootstrap before any test runs.

- [ ] **Step 2: Write the failing parser tests**

Create `libraries/nestjs-libraries/src/integrations/enabled.social.integrations.spec.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { parseEnabledSocialIntegrations } from './enabled.social.integrations';

const registered = ['x', 'linkedin', 'telegram', 'vk-group'] as const;

describe('parseEnabledSocialIntegrations', () => {
  it.each([undefined, '', '   \t\n  '])(
    'keeps every registered provider when the value is %j',
    (rawValue) => {
      expect(parseEnabledSocialIntegrations(rawValue, registered)).toEqual({
        configured: false,
        allowed: registered,
        unknown: [],
      });
    }
  );

  it('normalizes, deduplicates, ignores unknown entries, and preserves registry order', () => {
    expect(
      parseEnabledSocialIntegrations(
        ' TELEGRAM, x,telegram, UNKNOWN-PROVIDER, X ',
        registered
      )
    ).toEqual({
      configured: true,
      allowed: ['x', 'telegram'],
      unknown: ['unknown-provider'],
    });
  });

  it('fails closed when a configured value contains no registered identifiers', () => {
    expect(
      parseEnabledSocialIntegrations('unknown-one,UNKNOWN-TWO', registered)
    ).toEqual({
      configured: true,
      allowed: [],
      unknown: ['unknown-one', 'unknown-two'],
    });
  });

  it('ignores empty comma-separated entries without treating the value as unconfigured', () => {
    expect(parseEnabledSocialIntegrations(' , telegram, , ', registered)).toEqual(
      {
        configured: true,
        allowed: ['telegram'],
        unknown: [],
      }
    );
  });
});
```

- [ ] **Step 3: Run the parser test and verify RED**

Run:

```bash
rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/enabled.social.integrations.spec.ts
```

Expected: FAIL because `./enabled.social.integrations` does not exist.

- [ ] **Step 4: Implement the pure parser**

Create `libraries/nestjs-libraries/src/integrations/enabled.social.integrations.ts` with:

```ts
export type SocialIntegrationAllowlistResult = Readonly<{
  configured: boolean;
  allowed: readonly string[];
  unknown: readonly string[];
}>;

export const parseEnabledSocialIntegrations = (
  rawValue: string | undefined,
  registeredIdentifiers: readonly string[]
): SocialIntegrationAllowlistResult => {
  if (!rawValue?.trim()) {
    return {
      configured: false,
      allowed: registeredIdentifiers,
      unknown: [],
    };
  }

  const configuredIdentifiers = Array.from(
    new Set(
      rawValue
        .split(',')
        .map((identifier) => identifier.trim().toLowerCase())
        .filter(Boolean)
    )
  );
  const registered = new Set(registeredIdentifiers);
  const configured = new Set(configuredIdentifiers);

  return {
    configured: true,
    allowed: registeredIdentifiers.filter((identifier) =>
      configured.has(identifier)
    ),
    unknown: configuredIdentifiers.filter(
      (identifier) => !registered.has(identifier)
    ),
  };
};
```

- [ ] **Step 5: Run the parser test and verify GREEN**

Run:

```bash
rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/enabled.social.integrations.spec.ts
```

Expected: PASS with 4 tests and all parameterized cases green.

- [ ] **Step 6: Commit the parser**

```bash
rtk git add libraries/nestjs-libraries/src/integrations/enabled.social.integrations.ts libraries/nestjs-libraries/src/integrations/enabled.social.integrations.spec.ts
rtk git commit -m "feat: parse enabled social integrations"
```

Expected: one commit containing only the pure parser and its focused tests.

---

### Task 2: Integration Manager Catalogue Policy and Existing Route Coverage

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/integration.manager.ts`
- Modify: `libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts`
- Create: `apps/backend/src/api/routes/integration.connection.availability.spec.ts`

**Interfaces:**
- Consumes: `parseEnabledSocialIntegrations(process.env.ENABLED_SOCIAL_INTEGRATIONS, socialIntegrationList identifiers)` from Task 1.
- Produces: `IntegrationManager.isSocialIntegrationAllowed(identifier: string): boolean`, a configured `getAllowedSocialsIntegrations(): string[]`, and `canConnect: boolean` on every `getAllIntegrations().social` item.

- [ ] **Step 1: Write failing manager catalogue tests**

Update the import in `libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts` to:

```ts
import {
  IntegrationManager,
  socialIntegrationList,
} from './integration.manager';
```

Append this describe block:

```ts
describe('IntegrationManager deployment availability', () => {
  it('keeps every provider allowed when the environment value is blank', async () => {
    vi.stubEnv('ENABLED_SOCIAL_INTEGRATIONS', '   ');
    const manager = new IntegrationManager();
    const catalogue = await manager.getAllIntegrations();

    expect(manager.getAllowedSocialsIntegrations()).toEqual(
      socialIntegrationList.map(({ identifier }) => identifier)
    );
    expect(catalogue.social).toHaveLength(socialIntegrationList.length);
    expect(catalogue.social.every(({ canConnect }) => canConnect)).toBe(true);
  });

  it('adds canConnect without filtering or reordering the catalogue', async () => {
    vi.stubEnv(
      'ENABLED_SOCIAL_INTEGRATIONS',
      ' telegram, X,telegram,unknown-provider '
    );
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const manager = new IntegrationManager();
    const catalogue = await manager.getAllIntegrations();

    expect(manager.getAllowedSocialsIntegrations()).toEqual(['x', 'telegram']);
    expect(manager.isSocialIntegrationAllowed('x')).toBe(true);
    expect(manager.isSocialIntegrationAllowed('reddit')).toBe(false);
    expect(catalogue.social.map(({ identifier }) => identifier)).toEqual(
      socialIntegrationList.map(({ identifier }) => identifier)
    );
    expect(
      catalogue.social.find(({ identifier }) => identifier === 'x')
    ).toMatchObject({ canConnect: true });
    expect(
      catalogue.social.find(({ identifier }) => identifier === 'reddit')
    ).toMatchObject({ canConnect: false });
    expect(warning).toHaveBeenCalledExactlyOnceWith(
      '[integrations] Ignoring unknown ENABLED_SOCIAL_INTEGRATIONS identifiers: unknown-provider'
    );
  });
});
```

- [ ] **Step 2: Add failing end-to-end controller-policy unit tests**

Create `apps/backend/src/api/routes/integration.connection.availability.spec.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationsController } from './integrations.controller';
import { NoAuthIntegrationsController } from './no.auth.integrations.controller';
import { EnterpriseController } from './enterprise.controller';
import { PublicIntegrationsController } from '@gitroom/backend/public-api/routes/v1/public.integrations.controller';

vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock('@sentry/nestjs', () => ({
  metrics: { count: vi.fn() },
}));

const org = { id: 'organization-fixture' } as never;

describe('connection availability route boundaries', () => {
  let manager: IntegrationManager;
  let generateAuthUrl: ReturnType<typeof vi.spyOn>;
  let authenticate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('ENABLED_SOCIAL_INTEGRATIONS', 'telegram');
    manager = new IntegrationManager();
    const reddit = manager.getSocialIntegration('reddit');
    generateAuthUrl = vi.spyOn(reddit, 'generateAuthUrl').mockResolvedValue({
      codeVerifier: 'code-verifier-fixture',
      state: 'state-fixture',
      url: 'https://reddit.example/authorize',
    });
    authenticate = vi.spyOn(reddit, 'authenticate');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('blocks the authenticated connection start before auth URL or Redis state', async () => {
    const controller = new IntegrationsController(
      manager,
      {} as never,
      {} as never,
      {} as never
    );

    await expect(
      controller.getIntegrationUrl('reddit', '', '', '', '', org)
    ).rejects.toThrow('Integration not allowed');
    expect(generateAuthUrl).not.toHaveBeenCalled();
    expect(ioRedis.set).not.toHaveBeenCalled();
  });

  it('blocks callback completion before authentication or persistence', async () => {
    const integrationService = {
      createOrUpdateIntegration: vi.fn(),
    };
    const controller = new NoAuthIntegrationsController(
      manager,
      integrationService as never,
      {} as never,
      {} as never
    );

    await expect(
      controller.connectSocialMedia('reddit', {
        state: 'state-fixture',
        code: 'authorization-code-fixture',
        timezone: '180',
      } as never)
    ).rejects.toThrow('Integration not allowed');
    expect(authenticate).not.toHaveBeenCalled();
    expect(integrationService.createOrUpdateIntegration).not.toHaveBeenCalled();
  });

  it('blocks public API connection start before auth URL or Redis state', async () => {
    const controller = new PublicIntegrationsController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      manager,
      {} as never
    );

    await expect(
      controller.getIntegrationUrl('reddit', '', org)
    ).rejects.toMatchObject({ status: 400 });
    expect(generateAuthUrl).not.toHaveBeenCalled();
    expect(ioRedis.set).not.toHaveBeenCalled();
  });

  it('blocks enterprise handoff before auth URL or Redis state', async () => {
    vi.spyOn(AuthService, 'verifyJWT').mockReturnValue({
      redirectUrl: 'https://customer.example/return',
      apiKey: 'api-key-fixture',
      provider: 'reddit',
      webhookUrl: 'https://customer.example/webhook',
    } as never);
    const controller = new EnterpriseController(
      manager,
      { getOrgByApiKey: vi.fn().mockResolvedValue(org) } as never,
      {} as never,
      {} as never
    );

    await expect(controller.redirectParams('signed-params-fixture')).resolves.toBeUndefined();
    expect(generateAuthUrl).not.toHaveBeenCalled();
    expect(ioRedis.set).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run manager and route tests and verify RED**

Run:

```bash
rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts apps/backend/src/api/routes/integration.connection.availability.spec.ts
```

Expected: FAIL because `canConnect` and `isSocialIntegrationAllowed` do not exist and `getAllowedSocialsIntegrations()` still returns every provider despite the configured environment value.

- [ ] **Step 4: Implement manager parsing, warning, policy methods, and catalogue flag**

Add this import to `libraries/nestjs-libraries/src/integrations/integration.manager.ts`:

```ts
import { parseEnabledSocialIntegrations } from '@gitroom/nestjs-libraries/integrations/enabled.social.integrations';
```

Add these members at the start of `IntegrationManager`:

```ts
  private readonly socialIntegrationAllowlist =
    parseEnabledSocialIntegrations(
      process.env.ENABLED_SOCIAL_INTEGRATIONS,
      socialIntegrationList.map(({ identifier }) => identifier)
    );

  constructor() {
    if (this.socialIntegrationAllowlist.unknown.length) {
      console.warn(
        `[integrations] Ignoring unknown ENABLED_SOCIAL_INTEGRATIONS identifiers: ${this.socialIntegrationAllowlist.unknown.join(
          ', '
        )}`
      );
    }
  }
```

Replace `getAllowedSocialsIntegrations()` and add the predicate directly below it:

```ts
  getAllowedSocialsIntegrations() {
    return [...this.socialIntegrationAllowlist.allowed];
  }

  isSocialIntegrationAllowed(identifier: string) {
    return this.socialIntegrationAllowlist.allowed.includes(identifier);
  }
```

Add this property to each object produced inside `getAllIntegrations()` immediately after `identifier`:

```ts
          canConnect: this.isSocialIntegrationAllowed(p.identifier),
```

- [ ] **Step 5: Run manager and route tests and verify GREEN**

Run:

```bash
rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/enabled.social.integrations.spec.ts libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts apps/backend/src/api/routes/integration.connection.availability.spec.ts
```

Expected: PASS; the full catalogue remains in registry order, only X and Telegram are marked connectable in the configured manager test, and all four existing controller boundaries deny Reddit before side effects.

- [ ] **Step 6: Commit the manager policy and route coverage**

```bash
rtk git add libraries/nestjs-libraries/src/integrations/integration.manager.ts libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts apps/backend/src/api/routes/integration.connection.availability.spec.ts
rtk git commit -m "feat: expose social integration availability"
```

Expected: one commit containing the manager policy, additive catalogue field, and controller-boundary regression coverage.

---

### Task 3: Two-Step Completion and Extension-Refresh Enforcement

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts`
- Modify: `libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.spec.ts`
- Modify: `apps/backend/src/api/routes/no.auth.integrations.controller.ts`
- Modify: `apps/backend/src/api/routes/no.auth.integrations.controller.spec.ts`

**Interfaces:**
- Consumes: `IntegrationManager.isSocialIntegrationAllowed(identifier: string): boolean` from Task 2.
- Produces: HTTP 403 `Integration not available` before two-step provider calls or extension authentication; `IntegrationService.refreshTokens()` remains independent of the allowlist.

- [ ] **Step 1: Extend the integration-service fixture with the policy predicate**

In `libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.spec.ts`, declare the manager beside the existing provider variables:

```ts
  let integrationManager: {
    getSocialIntegration: ReturnType<typeof vi.fn>;
    isSocialIntegrationAllowed: ReturnType<typeof vi.fn>;
  };
```

Replace the local manager construction in `beforeEach` with:

```ts
    integrationManager = {
      getSocialIntegration: vi.fn().mockReturnValue(provider),
      isSocialIntegrationAllowed: vi.fn().mockReturnValue(true),
    };
```

Pass `integrationManager as never` as the third `IntegrationService` constructor argument.

The resulting construction is:

```ts
    service = new IntegrationService(
      repository as never,
      {} as never,
      integrationManager as never,
      {} as never,
      refreshIntegrationService as never,
      {} as never
    );
```

- [ ] **Step 2: Write failing two-step denial and automatic-refresh regression tests**

Add these tests inside `IntegrationService VK Group persistence`:

```ts
  it('blocks unavailable two-step completion before provider calls or persistence', async () => {
    integrationManager.isSocialIntegrationAllowed.mockReturnValue(false);

    let thrown: unknown;
    try {
      await service.saveProviderPage(
        organizationId,
        temporaryIntegrationId,
        { page: '123' }
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(403);
    expect((thrown as Error).message).toBe('Integration not available');
    expect(provider.fetchPageInformation).not.toHaveBeenCalled();
    expect(repository.updateIntegration).not.toHaveBeenCalled();
    expect(
      refreshIntegrationService.startRefreshWorkflow
    ).not.toHaveBeenCalled();
  });

  it('keeps automatic token refresh active outside the connection allowlist', async () => {
    integrationManager.isSocialIntegrationAllowed.mockReturnValue(false);
    repository.needsToBeRefreshed.mockResolvedValue([
      {
        ...temporaryVkGroupIntegration(),
        id: 'selected-group-integration-fixture',
        internalId: '-123',
        name: selectedGroup.name,
        picture: selectedGroup.picture,
        profile: selectedGroup.username,
        inBetweenSteps: false,
      },
    ]);
    provider.refreshToken.mockResolvedValue({
      id: '42',
      name: 'Refreshed VK administrator fixture',
      picture: 'https://images.example/refreshed-administrator-fixture.jpg',
      username: 'refreshed_administrator_fixture',
      accessToken: 'rotated-access-token-fixture',
      refreshToken: 'rotated-refresh-token-fixture',
      expiresIn: 7200,
    });

    await service.refreshTokens();

    expect(provider.refreshToken).toHaveBeenCalledOnce();
    expect(repository.createOrUpdateIntegration).toHaveBeenCalledOnce();
    expect(
      integrationManager.isSocialIntegrationAllowed
    ).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Prepare the extension-refresh test fixture and write the failing denial test**

In `apps/backend/src/api/routes/no.auth.integrations.controller.spec.ts`, add this import:

```ts
import { AuthService } from '@gitroom/helpers/auth/auth.service';
```

Extend the `provider` type and fixture with:

```ts
    isChromeExtension: boolean;
```

and:

```ts
      isChromeExtension: true,
```

Extend the integration-service fixture type and object with:

```ts
    getIntegrationById: ReturnType<typeof vi.fn>;
```

```ts
      getIntegrationById: vi.fn().mockResolvedValue({
        id: integrationId,
        internalId: 'extension-account-fixture',
        providerIdentifier: 'skool',
      }),
```

Hoist the manager into the describe scope:

```ts
  let integrationManager: {
    getAllowedSocialsIntegrations: ReturnType<typeof vi.fn>;
    getSocialIntegration: ReturnType<typeof vi.fn>;
    isSocialIntegrationAllowed: ReturnType<typeof vi.fn>;
  };
```

Initialize and pass it in `beforeEach`:

```ts
    integrationManager = {
      getAllowedSocialsIntegrations: vi.fn().mockReturnValue(['vk-group']),
      getSocialIntegration: vi.fn().mockReturnValue(provider),
      isSocialIntegrationAllowed: vi.fn().mockReturnValue(true),
    };
```

Add this test:

```ts
  it('blocks unavailable extension refresh before provider authentication', async () => {
    vi.spyOn(AuthService, 'verifyJWT').mockReturnValue({
      integrationId,
      organizationId,
      internalId: 'extension-account-fixture',
      provider: 'skool',
    } as never);
    integrationManager.isSocialIntegrationAllowed.mockReturnValue(false);

    let thrown: unknown;
    try {
      await controller.extensionRefreshCookies({
        jwt: 'signed-extension-token-fixture',
        cookies: 'encoded-cookie-fixture',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(403);
    expect((thrown as Error).message).toBe('Integration not available');
    expect(provider.authenticate).not.toHaveBeenCalled();
    expect(integrationService.createOrUpdateIntegration).not.toHaveBeenCalled();
  });
```

- [ ] **Step 4: Run service and controller tests and verify RED**

Run:

```bash
rtk pnpm exec vitest run libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.spec.ts apps/backend/src/api/routes/no.auth.integrations.controller.spec.ts
```

Expected: FAIL because two-step save and extension refresh do not consult `isSocialIntegrationAllowed`; provider methods are called instead of returning HTTP 403.

- [ ] **Step 5: Guard two-step completion in the integration service**

In `IntegrationService.saveProviderPage()`, immediately after the existing owned-integration not-found check and before `getSocialIntegration`, add:

```ts
    if (
      !this._integrationManager.isSocialIntegrationAllowed(
        getIntegration.providerIdentifier
      )
    ) {
      throw new HttpException(
        'Integration not available',
        HttpStatus.FORBIDDEN
      );
    }
```

This service boundary covers both `POST /integrations/provider/:id/connect` and `POST /integrations/public/provider/:id/connect` without duplicating controller logic.

- [ ] **Step 6: Guard extension refresh before provider authentication**

In `NoAuthIntegrationsController.extensionRefreshCookies()`, immediately after validating the stored integration and before `getSocialIntegration`, add:

```ts
    if (
      !this._integrationManager.isSocialIntegrationAllowed(
        integration.providerIdentifier
      )
    ) {
      throw new HttpException(
        'Integration not available',
        HttpStatus.FORBIDDEN
      );
    }
```

- [ ] **Step 7: Run enforcement tests and verify GREEN**

Run:

```bash
rtk pnpm exec vitest run libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.spec.ts apps/backend/src/api/routes/no.auth.integrations.controller.spec.ts apps/backend/src/api/routes/integration.connection.availability.spec.ts
```

Expected: PASS; unavailable two-step and extension paths return 403 before provider/persistence calls, while automatic token refresh still updates credentials without consulting the connection allowlist.

- [ ] **Step 8: Commit the missing backend guards**

```bash
rtk git add libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.spec.ts apps/backend/src/api/routes/no.auth.integrations.controller.ts apps/backend/src/api/routes/no.auth.integrations.controller.spec.ts
rtk git commit -m "fix: enforce social availability on completion paths"
```

Expected: one commit containing the service-level two-step guard, extension-refresh guard, and automatic-refresh regression proof.

---

### Task 4: Self-Host Defaults and Vezdepost Production Configuration

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yaml`
- Modify: `docker-compose.override.yaml`
- Modify: `deploy/README.md`
- Modify: `deploy/production-config.spec.ts`

**Interfaces:**
- Consumes: the backend variable `ENABLED_SOCIAL_INTEGRATIONS` defined in Tasks 1-2.
- Produces: blank/default-all self-host configuration, exact seven-provider Vezdepost configuration, Compose-time required X credential preflight, and operator documentation.

- [ ] **Step 1: Write failing production configuration tests**

In `deploy/production-config.spec.ts`, change the first test name and X assertions from optional interpolation to required interpolation:

```ts
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
```

Add this exact availability test:

```ts
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
  });
```

- [ ] **Step 2: Run the deployment spec and verify RED**

Run:

```bash
rtk pnpm exec vitest run deploy/production-config.spec.ts
```

Expected: FAIL because the allowlist is absent and X still uses optional `${X_API_KEY:-}` / `${X_API_SECRET:-}` interpolation.

- [ ] **Step 3: Forward the optional self-host variable and document its default**

Add this block immediately before `# === Social Media API Settings` in `.env.example`:

```dotenv
# Comma-separated provider identifiers allowed for new connections.
# Blank or unset keeps every registered provider connectable.
ENABLED_SOCIAL_INTEGRATIONS=""
```

Add this entry under the `postiz` service environment's social-media settings in `docker-compose.yaml`:

```yaml
      ENABLED_SOCIAL_INTEGRATIONS: '${ENABLED_SOCIAL_INTEGRATIONS:-}'
```

- [ ] **Step 4: Track the production allowlist and make X preflight fail closed**

In `docker-compose.override.yaml`, add this exact environment entry after `VK_ID`:

```yaml
      ENABLED_SOCIAL_INTEGRATIONS: 'telegram,max,vk,vk-group,x,linkedin,tumblr'
```

Replace the two optional X entries with:

```yaml
      X_API_KEY: '${X_API_KEY:?set in .env}'
      X_API_SECRET: '${X_API_SECRET:?set in .env}'
```

Replace the override's leading secret inventory with this exact block so X is listed as required rather than optional:

```yaml
# Secrets are interpolated from an untracked `.env` file next to this file:
#   JWT_SECRET=...
#   TELEGRAM_TOKEN=...
#   MAX_TOKEN=...
#   GOOGLE_CLIENT_ID=...
#   GOOGLE_CLIENT_SECRET=...
#   LINKEDIN_CLIENT_ID=...
#   LINKEDIN_CLIENT_SECRET=...
#   TUMBLR_CLIENT_ID=...
#   TUMBLR_CLIENT_SECRET=...
#   PINTEREST_CLIENT_ID=...
#   PINTEREST_CLIENT_SECRET=...
#   X_API_KEY=...
#   X_API_SECRET=...
# Optional integrations: NEXT_PUBLIC_POSTHOG_KEY, NEXT_PUBLIC_POSTHOG_HOST.
```

- [ ] **Step 5: Document production operations and the X preflight**

Add this section to `deploy/README.md` immediately before `## LinkedIn personal profiles`:

````markdown
## Hosted channel availability

The hosted Vezdepost connection allowlist is tracked in
`docker-compose.override.yaml` as:

`telegram,max,vk,vk-group,x,linkedin,tumblr`

The application still shows other registered adapters as request-only. Pinterest
remains request-only until Standard access and public readiness are verified.
Adding a hosted provider requires both an end-to-end production connection check
and an explicit update to this tracked list and `deploy/production-config.spec.ts`.

Before recreating `postiz`, validate required credentials and interpolation
without printing their values:

```bash
rtk docker compose config --quiet
```

Because X is in the hosted allowlist, the production override requires both
`X_API_KEY` and `X_API_SECRET`; Compose stops before recreation when either is
unset or empty. Real credentials remain only in the untracked server `.env`.
````

- [ ] **Step 6: Run the deployment spec and verify GREEN**

Run:

```bash
rtk pnpm exec vitest run deploy/production-config.spec.ts
```

Expected: PASS, including the exact seven-provider assertion, Pinterest exclusion, base blank-default contract, and required X assertions.

- [ ] **Step 7: Prove the X Compose preflight rejects an empty key**

Run:

```bash
rtk env JWT_SECRET=x TELEGRAM_TOKEN=x MAX_TOKEN=x VK_ID=x GOOGLE_CLIENT_ID=x GOOGLE_CLIENT_SECRET=x LINKEDIN_CLIENT_ID=x LINKEDIN_CLIENT_SECRET=x TUMBLR_CLIENT_ID=x TUMBLR_CLIENT_SECRET=x PINTEREST_CLIENT_ID=x PINTEREST_CLIENT_SECRET=x X_API_KEY= X_API_SECRET=x docker compose config --quiet
```

Expected: non-zero exit with a Compose interpolation error naming `X_API_KEY`; no credential value is printed.

- [ ] **Step 8: Prove the complete production Compose configuration passes**

Run:

```bash
rtk env JWT_SECRET=x TELEGRAM_TOKEN=x MAX_TOKEN=x VK_ID=x GOOGLE_CLIENT_ID=x GOOGLE_CLIENT_SECRET=x LINKEDIN_CLIENT_ID=x LINKEDIN_CLIENT_SECRET=x TUMBLR_CLIENT_ID=x TUMBLR_CLIENT_SECRET=x PINTEREST_CLIENT_ID=x PINTEREST_CLIENT_SECRET=x X_API_KEY=x X_API_SECRET=x docker compose config --quiet
```

Expected: exit 0 with no output.

- [ ] **Step 9: Commit deployment configuration and documentation**

```bash
rtk git add .env.example docker-compose.yaml docker-compose.override.yaml deploy/README.md deploy/production-config.spec.ts
rtk git commit -m "ops: gate hosted social integrations"
```

Expected: one commit containing only deployment configuration, its automated contract test, and operator documentation.

---

### Task 5: Backend Availability Verification

**Files:**
- Verify: `libraries/nestjs-libraries/src/integrations/enabled.social.integrations.ts`
- Verify: `libraries/nestjs-libraries/src/integrations/integration.manager.ts`
- Verify: `libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts`
- Verify: `apps/backend/src/api/routes/no.auth.integrations.controller.ts`
- Verify: `.env.example`
- Verify: `docker-compose.yaml`
- Verify: `docker-compose.override.yaml`
- Verify: `deploy/README.md`
- Verify: `deploy/production-config.spec.ts`

**Interfaces:**
- Consumes: all parser, manager, enforcement, and deployment contracts from Tasks 1-4.
- Produces: fresh evidence that the backend-only feature passes focused tests, formatting, workspace verification, lint, and the backend production build.

- [ ] **Step 1: Run every focused availability test together**

Run:

```bash
rtk pnpm exec vitest run libraries/nestjs-libraries/src/integrations/enabled.social.integrations.spec.ts libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts apps/backend/src/api/routes/integration.connection.availability.spec.ts libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.spec.ts apps/backend/src/api/routes/no.auth.integrations.controller.spec.ts deploy/production-config.spec.ts
```

Expected: exit 0; parser, full catalogue, four existing route guards, two-step guard, extension-refresh guard, automatic refresh, exact production list, and X preflight source assertions all pass in one run.

- [ ] **Step 2: Check formatting for every changed file**

Run:

```bash
rtk pnpm exec prettier --check libraries/nestjs-libraries/src/integrations/enabled.social.integrations.ts libraries/nestjs-libraries/src/integrations/enabled.social.integrations.spec.ts libraries/nestjs-libraries/src/integrations/integration.manager.ts libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts apps/backend/src/api/routes/integration.connection.availability.spec.ts libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.spec.ts apps/backend/src/api/routes/no.auth.integrations.controller.ts apps/backend/src/api/routes/no.auth.integrations.controller.spec.ts docker-compose.yaml docker-compose.override.yaml deploy/README.md deploy/production-config.spec.ts
```

Expected: exit 0 and every listed file reports unchanged formatting.

If the check fails, run these exact recovery commands, inspect the formatting-only diff, and then repeat Tasks 5.1-5.2:

```bash
rtk pnpm exec prettier --write libraries/nestjs-libraries/src/integrations/enabled.social.integrations.ts libraries/nestjs-libraries/src/integrations/enabled.social.integrations.spec.ts libraries/nestjs-libraries/src/integrations/integration.manager.ts libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts apps/backend/src/api/routes/integration.connection.availability.spec.ts libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.spec.ts apps/backend/src/api/routes/no.auth.integrations.controller.ts apps/backend/src/api/routes/no.auth.integrations.controller.spec.ts docker-compose.yaml docker-compose.override.yaml deploy/README.md deploy/production-config.spec.ts
rtk git diff --check
rtk git add libraries/nestjs-libraries/src/integrations/enabled.social.integrations.ts libraries/nestjs-libraries/src/integrations/enabled.social.integrations.spec.ts libraries/nestjs-libraries/src/integrations/integration.manager.ts libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts apps/backend/src/api/routes/integration.connection.availability.spec.ts libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.spec.ts apps/backend/src/api/routes/no.auth.integrations.controller.ts apps/backend/src/api/routes/no.auth.integrations.controller.spec.ts docker-compose.yaml docker-compose.override.yaml deploy/README.md deploy/production-config.spec.ts
rtk git commit -m "style: format channel availability backend"
```

- [ ] **Step 3: Check the final patch for whitespace errors**

Run:

```bash
rtk git diff --check
```

Expected: exit 0 with no output.

- [ ] **Step 4: Re-run workspace bootstrap verification**

Run:

```bash
rtk pnpm run verify:workspace
```

Expected: exit 0 with the workspace bootstrap reported valid.

- [ ] **Step 5: Run ESLint from the repository root**

Run:

```bash
rtk pnpm exec eslint libraries/nestjs-libraries/src/integrations/enabled.social.integrations.ts libraries/nestjs-libraries/src/integrations/enabled.social.integrations.spec.ts libraries/nestjs-libraries/src/integrations/integration.manager.ts libraries/nestjs-libraries/src/integrations/integration.manager.spec.ts apps/backend/src/api/routes/integration.connection.availability.spec.ts libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.spec.ts apps/backend/src/api/routes/no.auth.integrations.controller.ts apps/backend/src/api/routes/no.auth.integrations.controller.spec.ts deploy/production-config.spec.ts
```

Expected: exit 0 with no ESLint errors; the command is run only from the repository root.

- [ ] **Step 6: Build the backend production bundle**

Run:

```bash
rtk pnpm run build:backend
```

Expected: exit 0 and Nest reports a successful production backend build.

- [ ] **Step 7: Inspect the final scope and history**

Run:

```bash
rtk git status --short
rtk git diff --stat origin/prod...HEAD
rtk git log -5 --oneline
```

Expected: the worktree is clean; the diff contains only the backend, deployment, tests, and documentation paths listed in this plan; the four focused commits are present, with one additional formatting commit only if Task 5.2 required it; no `apps/frontend/**` or translation file appears.
