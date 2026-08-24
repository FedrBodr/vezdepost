import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationsController } from './integrations.controller';
import { NoAuthIntegrationsController } from './no.auth.integrations.controller';
import { EnterpriseController } from './enterprise.controller';
import { PublicIntegrationsController } from '@gitroom/backend/public-api/routes/v1/public.integrations.controller';
import { ForbiddenException } from '@nestjs/common';

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

const expectIntegrationNotAvailable = async (action: Promise<unknown>) => {
  let thrown: unknown;
  try {
    await action;
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ForbiddenException);
  expect((thrown as ForbiddenException).getStatus()).toBe(403);
  expect((thrown as Error).message).toBe('Integration not available');
};

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

    await expectIntegrationNotAvailable(
      controller.getIntegrationUrl('reddit', '', '', '', '', org)
    );
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

    await expectIntegrationNotAvailable(
      controller.connectSocialMedia('reddit', {
        state: 'state-fixture',
        code: 'authorization-code-fixture',
        timezone: '180',
      } as never)
    );
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

    await expectIntegrationNotAvailable(
      controller.getIntegrationUrl('reddit', '', org)
    );
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

    await expectIntegrationNotAvailable(
      controller.redirectParams('signed-params-fixture')
    );
    expect(generateAuthUrl).not.toHaveBeenCalled();
    expect(ioRedis.set).not.toHaveBeenCalled();
  });

  it('preserves legacy enterprise handling for downstream forbidden errors', async () => {
    vi.spyOn(AuthService, 'verifyJWT').mockReturnValue({
      redirectUrl: 'https://customer.example/return',
      apiKey: 'api-key-fixture',
      provider: 'telegram',
      webhookUrl: 'https://customer.example/webhook',
    } as never);
    vi.spyOn(
      manager.getSocialIntegration('telegram'),
      'generateAuthUrl'
    ).mockRejectedValue(new ForbiddenException('Downstream forbidden'));
    const controller = new EnterpriseController(
      manager,
      { getOrgByApiKey: vi.fn().mockResolvedValue(org) } as never,
      {} as never,
      {} as never
    );

    await expect(
      controller.redirectParams('signed-params-fixture')
    ).resolves.toBeUndefined();
    expect(ioRedis.set).not.toHaveBeenCalled();
  });
});
