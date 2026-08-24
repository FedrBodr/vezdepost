import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadBody } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { NoAuthIntegrationsController } from './no.auth.integrations.controller';

vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: vi.fn(),
    del: vi.fn(),
  },
}));

const organizationId = 'organization-fixture';
const integrationId = 'temporary-integration-fixture';

describe('NoAuthIntegrationsController two-step page loading', () => {
  let provider: {
    isBetweenSteps: boolean;
    refreshCron: boolean;
    isChromeExtension: boolean;
    authenticate: ReturnType<typeof vi.fn>;
    pages: ReturnType<typeof vi.fn>;
  };
  let integrationService: {
    checkPreviousConnections: ReturnType<typeof vi.fn>;
    createOrUpdateIntegration: ReturnType<typeof vi.fn>;
    getIntegrationById: ReturnType<typeof vi.fn>;
    saveProviderPage: ReturnType<typeof vi.fn>;
  };
  let integrationManager: {
    getAllowedSocialsIntegrations: ReturnType<typeof vi.fn>;
    getSocialIntegration: ReturnType<typeof vi.fn>;
    isSocialIntegrationAllowed: ReturnType<typeof vi.fn>;
  };
  let refreshIntegrationService: {
    startRefreshWorkflow: ReturnType<typeof vi.fn>;
  };
  let controller: NoAuthIntegrationsController;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(AuthService, 'signJWT').mockReturnValue(
      'signed-extension-token-fixture'
    );
    vi.mocked(ioRedis.get).mockImplementation(async (key) => {
      const normalizedKey = String(key);
      if (normalizedKey === 'login:oauth-state') return 'pkce-verifier';
      if (normalizedKey === 'organization:oauth-state') return organizationId;
      return null;
    });

    provider = {
      isBetweenSteps: true,
      refreshCron: true,
      isChromeExtension: true,
      authenticate: vi.fn().mockResolvedValue({
        id: 'vk-group-oauth:42',
        name: 'VK administrator fixture',
        picture: '',
        username: 'vk-admin-fixture',
        accessToken: 'access-token-fixture',
        refreshToken: 'refresh-token-fixture',
        expiresIn: 3600,
      }),
      pages: vi.fn(),
    };
    integrationService = {
      checkPreviousConnections: vi.fn().mockResolvedValue(false),
      createOrUpdateIntegration: vi.fn().mockResolvedValue({
        id: integrationId,
        inBetweenSteps: true,
        token: 'stored-access-token-fixture',
        refreshToken: 'stored-refresh-token-fixture',
      }),
      getIntegrationById: vi.fn().mockResolvedValue({
        id: integrationId,
        internalId: 'extension-account-fixture',
        providerIdentifier: 'skool',
      }),
      saveProviderPage: vi.fn(),
    };
    refreshIntegrationService = {
      startRefreshWorkflow: vi.fn().mockResolvedValue(undefined),
    };
    integrationManager = {
      getAllowedSocialsIntegrations: vi.fn().mockReturnValue(['vk-group']),
      getSocialIntegration: vi.fn().mockReturnValue(provider),
      isSocialIntegrationAllowed: vi.fn().mockReturnValue(true),
    };
    const organizationService = {
      getOrgById: vi.fn().mockResolvedValue({
        id: organizationId,
        isTrailing: false,
        apiKey: 'api-key-fixture',
      }),
    };

    controller = new NoAuthIntegrationsController(
      integrationManager as never,
      integrationService as never,
      refreshIntegrationService as never,
      organizationService as never
    );
  });

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

  const connect = () =>
    controller.connectSocialMedia('vk-group', {
      state: 'oauth-state',
      code: 'authorization-code&&&&device-id',
      timezone: '180',
    } as never);

  it('returns a genuine empty managed-community list', async () => {
    provider.pages.mockResolvedValue([]);

    await expect(connect()).resolves.toEqual(
      expect.objectContaining({
        id: integrationId,
        inBetweenSteps: true,
        pages: [],
      })
    );
    expect(provider.pages).toHaveBeenCalledExactlyOnceWith(
      'access-token-fixture'
    );
    expect(
      refreshIntegrationService.startRefreshWorkflow
    ).not.toHaveBeenCalled();
  });

  it('returns a safe HTTP 400 instead of disguising a page failure as empty', async () => {
    provider.pages.mockRejectedValue(
      new BadBody(
        'vk-group',
        '{"token":"raw-upstream-secret"}',
        'raw-upstream-body',
        'VK groups.get failed with error 100'
      )
    );

    let thrown: unknown;
    try {
      await connect();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(400);
    expect((thrown as Error).message).toBe(
      'Could not load managed VK communities. Reconnect VK Group and try again.'
    );
    expect(JSON.stringify(thrown)).not.toContain('raw-upstream-secret');
    expect(JSON.stringify(thrown)).not.toContain('raw-upstream-body');
    expect(
      refreshIntegrationService.startRefreshWorkflow
    ).not.toHaveBeenCalled();
  });

  it('returns the safe selection reconnect error without raw provider details', async () => {
    integrationService.saveProviderPage.mockRejectedValue(
      new HttpException(
        'Reconnect VK Group through VK authorization and try again.',
        400
      )
    );

    let thrown: unknown;
    try {
      await controller.saveProviderPage(integrationId, {
        state: 'oauth-state',
        raw: 'raw-provider-body-fixture',
      });
    } catch (error) {
      thrown = error;
    }

    expect(integrationService.saveProviderPage).toHaveBeenCalledExactlyOnceWith(
      organizationId,
      integrationId,
      { state: 'oauth-state', raw: 'raw-provider-body-fixture' }
    );
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(400);
    expect((thrown as Error).message).toBe(
      'Reconnect VK Group through VK authorization and try again.'
    );
    expect(JSON.stringify(thrown)).not.toContain('raw-provider-body-fixture');
  });
});
