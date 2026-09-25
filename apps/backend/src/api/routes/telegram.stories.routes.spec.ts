import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationsController } from './integrations.controller';
import { NoAuthIntegrationsController } from './no.auth.integrations.controller';
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

const allowedOrg = { id: 'org-1' } as never;
const otherOrg = { id: 'org-2' } as never;

const expectIntegrationNotAvailable = async (action: Promise<unknown>) => {
  let thrown: unknown;
  try {
    await action;
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ForbiddenException);
  expect((thrown as Error).message).toBe('Integration not available');
};

describe('Telegram Stories rollout gate', () => {
  let manager: IntegrationManager;
  let controller: IntegrationsController;

  beforeEach(() => {
    vi.stubEnv('TELEGRAM_STORIES_ORG_IDS', 'org-1');
    manager = new IntegrationManager();
    controller = new IntegrationsController(
      manager,
      {} as never,
      {} as never,
      {} as never
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('reports availability per organization', () => {
    expect(controller.getTelegramStoriesAvailability(allowedOrg)).toEqual({
      available: true,
    });
    expect(controller.getTelegramStoriesAvailability(otherOrg)).toEqual({
      available: false,
    });
  });

  it('refuses connection status for an organization outside the flag', async () => {
    await expectIntegrationNotAvailable(
      controller.getTelegramStoriesUpdates('nonce', otherOrg)
    );
  });

  it('refuses to start a connection for an organization outside the flag', async () => {
    const generateAuthUrl = vi.spyOn(
      manager.getSocialIntegration('telegram-stories'),
      'generateAuthUrl'
    );

    await expectIntegrationNotAvailable(
      controller.getIntegrationUrl('telegram-stories', '', '', '', '', otherOrg)
    );
    expect(generateAuthUrl).not.toHaveBeenCalled();
  });

  it('refuses to start a connection through the public API', async () => {
    const publicController = new PublicIntegrationsController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      manager,
      {} as never
    );

    await expectIntegrationNotAvailable(
      publicController.getIntegrationUrl('telegram-stories', '', otherOrg)
    );
  });

  it('refuses to complete a connection for an organization outside the flag', async () => {
    const redisState: Record<string, string> = {
      'login:state': 'verifier',
      'organization:state': 'org-2',
    };
    (ioRedis.get as ReturnType<typeof vi.fn>).mockImplementation(
      async (key: string) => redisState[key] ?? null
    );
    const authenticate = vi.spyOn(
      manager.getSocialIntegration('telegram-stories'),
      'authenticate'
    );
    const noAuthController = new NoAuthIntegrationsController(
      manager,
      { createOrUpdateIntegration: vi.fn() } as never,
      {} as never,
      { getOrgById: vi.fn() } as never
    );

    await expectIntegrationNotAvailable(
      noAuthController.connectSocialMedia('telegram-stories', {
        state: 'state',
        code: 'nonce',
        timezone: '180',
      } as never)
    );
    expect(authenticate).not.toHaveBeenCalled();
  });
});
