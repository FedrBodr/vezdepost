import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { BadBody, RefreshToken } from '../../../integrations/social.abstract';
import { IntegrationService } from './integration.service';

const organizationId = 'organization-fixture';
const temporaryIntegrationId = 'temporary-integration-fixture';
const userAccessToken = 'user-access-token-fixture';
const userRefreshToken = 'user-refresh-token-fixture';
const userTokenExpiration = new Date('2030-01-01T00:00:00.000Z');

const temporaryVkGroupIntegration = () => ({
  id: temporaryIntegrationId,
  internalId: 'vk-group-oauth:42',
  rootInternalId: 'vk-group-oauth:42',
  organizationId,
  name: 'VK administrator fixture',
  picture: 'https://images.example/administrator-fixture.jpg',
  providerIdentifier: 'vk-group',
  type: 'social',
  token: userAccessToken,
  refreshToken: userRefreshToken,
  tokenExpiration: userTokenExpiration,
  inBetweenSteps: true,
});

const selectedGroup = {
  id: '-123',
  name: 'Selected group fixture',
  picture: 'https://images.example/group-fixture.jpg',
  access_token: userAccessToken,
  username: 'selected_group_fixture',
};

describe('IntegrationService VK Group persistence', () => {
  let repository: {
    getIntegrationById: ReturnType<typeof vi.fn>;
    getIntegrationByRootInternalId: ReturnType<typeof vi.fn>;
    checkForDeletedOnceAndUpdate: ReturnType<typeof vi.fn>;
    updateIntegration: ReturnType<typeof vi.fn>;
    needsToBeRefreshed: ReturnType<typeof vi.fn>;
    createOrUpdateIntegration: ReturnType<typeof vi.fn>;
    deleteChannel: ReturnType<typeof vi.fn>;
  };
  let provider: {
    oneTimeToken?: boolean;
    fetchPageInformation: ReturnType<typeof vi.fn>;
    refreshToken: ReturnType<typeof vi.fn>;
  };
  let integrationManager: {
    getSocialIntegration: ReturnType<typeof vi.fn>;
    isSocialIntegrationAllowed: ReturnType<typeof vi.fn>;
  };
  let refreshIntegrationService: {
    startRefreshWorkflow: ReturnType<typeof vi.fn>;
  };
  let service: IntegrationService;

  beforeEach(() => {
    repository = {
      getIntegrationById: vi
        .fn()
        .mockResolvedValue(temporaryVkGroupIntegration()),
      getIntegrationByRootInternalId: vi.fn().mockResolvedValue(null),
      checkForDeletedOnceAndUpdate: vi.fn().mockResolvedValue(undefined),
      updateIntegration: vi
        .fn()
        .mockResolvedValue({ id: temporaryIntegrationId }),
      needsToBeRefreshed: vi.fn().mockResolvedValue([]),
      createOrUpdateIntegration: vi.fn().mockResolvedValue(undefined),
      deleteChannel: vi.fn().mockResolvedValue(undefined),
    };
    provider = {
      fetchPageInformation: vi.fn().mockResolvedValue(selectedGroup),
      refreshToken: vi.fn(),
    };
    integrationManager = {
      getSocialIntegration: vi.fn().mockReturnValue(provider),
      isSocialIntegrationAllowed: vi.fn().mockReturnValue(true),
    };
    refreshIntegrationService = {
      startRefreshWorkflow: vi.fn().mockResolvedValue(undefined),
    };

    service = new IntegrationService(
      repository as never,
      {} as never,
      integrationManager as never,
      {} as never,
      refreshIntegrationService as never,
      {} as never
    );
  });

  it('blocks unavailable two-step completion before provider calls or persistence', async () => {
    integrationManager.isSocialIntegrationAllowed.mockReturnValue(false);

    let thrown: unknown;
    try {
      await service.saveProviderPage(organizationId, temporaryIntegrationId, {
        page: '123',
      });
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

  it('finalizes a temporary VK Group integration without changing its tokens', async () => {
    await expect(
      service.saveProviderPage(organizationId, temporaryIntegrationId, {
        page: '123',
      })
    ).resolves.toEqual({ success: true });

    expect(provider.fetchPageInformation).toHaveBeenCalledExactlyOnceWith(
      userAccessToken,
      { page: '123' }
    );
    expect(repository.checkForDeletedOnceAndUpdate).not.toHaveBeenCalled();
    expect(repository.updateIntegration).toHaveBeenCalledExactlyOnceWith(
      temporaryIntegrationId,
      {
        picture: selectedGroup.picture,
        internalId: '-123',
        organizationId,
        name: selectedGroup.name,
        inBetweenSteps: false,
        token: userAccessToken,
        refreshToken: userRefreshToken,
        tokenExpiration: userTokenExpiration,
        profile: selectedGroup.username,
        rootInternalId: 'vk-group-oauth:42',
        providerIdentifier: 'vk-group',
      }
    );
    expect(repository.deleteChannel).not.toHaveBeenCalled();
    expect(
      refreshIntegrationService.startRefreshWorkflow
    ).toHaveBeenCalledExactlyOnceWith(
      organizationId,
      temporaryIntegrationId,
      provider
    );
  });

  it('reconnects the existing signed group instead of violating uniqueness', async () => {
    repository.updateIntegration.mockResolvedValue({
      id: 'existing-signed-group-fixture',
      internalId: '-123',
      deletedAt: null,
    });

    await service.saveProviderPage(organizationId, temporaryIntegrationId, {
      page: '123',
    });

    expect(repository.checkForDeletedOnceAndUpdate).not.toHaveBeenCalled();
    expect(repository.updateIntegration).toHaveBeenCalledExactlyOnceWith(
      temporaryIntegrationId,
      {
        picture: selectedGroup.picture,
        internalId: '-123',
        organizationId,
        name: selectedGroup.name,
        inBetweenSteps: false,
        token: userAccessToken,
        refreshToken: userRefreshToken,
        tokenExpiration: userTokenExpiration,
        profile: selectedGroup.username,
        rootInternalId: 'vk-group-oauth:42',
        providerIdentifier: 'vk-group',
      }
    );
    expect(repository.deleteChannel).not.toHaveBeenCalled();
    expect(
      refreshIntegrationService.startRefreshWorkflow
    ).toHaveBeenCalledExactlyOnceWith(
      organizationId,
      'existing-signed-group-fixture',
      provider
    );
  });

  it('does not collide with a personal VK integration for the same user', async () => {
    provider.fetchPageInformation.mockResolvedValue({
      ...selectedGroup,
      id: '-42',
    });

    await service.saveProviderPage(organizationId, temporaryIntegrationId, {
      page: '42',
    });

    expect(repository.updateIntegration).toHaveBeenCalledExactlyOnceWith(
      temporaryIntegrationId,
      {
        picture: selectedGroup.picture,
        internalId: '-42',
        organizationId,
        name: selectedGroup.name,
        inBetweenSteps: false,
        token: userAccessToken,
        refreshToken: userRefreshToken,
        tokenExpiration: userTokenExpiration,
        profile: selectedGroup.username,
        rootInternalId: 'vk-group-oauth:42',
        providerIdentifier: 'vk-group',
      }
    );
    expect(repository.updateIntegration).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ internalId: '42' })
    );
  });

  it('refreshes credentials without replacing the selected group id or metadata', async () => {
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

    expect(
      repository.createOrUpdateIntegration
    ).toHaveBeenCalledExactlyOnceWith(
      undefined,
      false,
      organizationId,
      selectedGroup.name,
      undefined,
      'social',
      '-123',
      'vk-group',
      'rotated-access-token-fixture',
      'rotated-refresh-token-fixture',
      7200,
      undefined,
      false,
      undefined,
      undefined,
      undefined
    );
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

  it('retains deleted-channel recovery before finalizing a non-VK provider', async () => {
    repository.getIntegrationById.mockResolvedValue({
      ...temporaryVkGroupIntegration(),
      internalId: 'youtube-oauth:42',
      providerIdentifier: 'youtube',
    });
    provider.fetchPageInformation.mockResolvedValue({
      ...selectedGroup,
      id: 'youtube-channel-fixture',
    });

    await service.saveProviderPage(organizationId, temporaryIntegrationId, {
      page: 'youtube-channel-fixture',
    });

    expect(
      repository.checkForDeletedOnceAndUpdate
    ).toHaveBeenCalledExactlyOnceWith(
      organizationId,
      'youtube-channel-fixture'
    );
    expect(repository.updateIntegration).toHaveBeenCalledOnce();
    expect(
      repository.checkForDeletedOnceAndUpdate.mock.invocationCallOrder[0]
    ).toBeLessThan(repository.updateIntegration.mock.invocationCallOrder[0]);
    expect(repository.updateIntegration.mock.calls[0][1]).not.toHaveProperty(
      'rootInternalId'
    );
    expect(repository.updateIntegration.mock.calls[0][1]).not.toHaveProperty(
      'providerIdentifier'
    );
  });

  it('maps a cross-provider identifier collision to a safe HTTP 409', async () => {
    repository.updateIntegration.mockRejectedValue(
      Object.assign(new Error('repository-provider-conflict-fixture'), {
        code: 'INTEGRATION_PROVIDER_CONFLICT',
      })
    );

    let thrown: unknown;
    try {
      await service.saveProviderPage(organizationId, temporaryIntegrationId, {
        page: '123',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(409);
    expect((thrown as Error).message).toBe(
      'Could not save this channel because its identifier is already used by another provider.'
    );
    expect(JSON.stringify(thrown)).not.toContain(
      'repository-provider-conflict-fixture'
    );
    expect(
      refreshIntegrationService.startRefreshWorkflow
    ).not.toHaveBeenCalled();
  });

  it('retries refresh startup against the final duplicate VK Group after the temporary row was retired', async () => {
    repository.getIntegrationById
      .mockResolvedValueOnce(temporaryVkGroupIntegration())
      .mockResolvedValueOnce({
        ...temporaryVkGroupIntegration(),
        internalId: 'deleted_-123_retired-fixture',
        deletedAt: new Date('2030-01-02T00:00:00.000Z'),
      });
    repository.getIntegrationByRootInternalId.mockResolvedValue({
      ...temporaryVkGroupIntegration(),
      id: 'existing-signed-group-fixture',
      internalId: '-123',
      inBetweenSteps: false,
      deletedAt: null,
    });
    repository.updateIntegration.mockResolvedValue({
      id: 'existing-signed-group-fixture',
      internalId: '-123',
    });
    refreshIntegrationService.startRefreshWorkflow
      .mockRejectedValueOnce(new Error('temporal-unavailable-fixture'))
      .mockResolvedValueOnce(undefined);

    await expect(
      service.saveProviderPage(organizationId, temporaryIntegrationId, {
        page: '123',
      })
    ).rejects.toThrow('temporal-unavailable-fixture');

    await expect(
      service.saveProviderPage(organizationId, temporaryIntegrationId, {
        page: '123',
      })
    ).resolves.toEqual({ success: true });

    expect(provider.fetchPageInformation).toHaveBeenCalledOnce();
    expect(repository.updateIntegration).toHaveBeenCalledOnce();
    expect(
      repository.getIntegrationByRootInternalId
    ).toHaveBeenCalledExactlyOnceWith(
      organizationId,
      'vk-group-oauth:42',
      'vk-group',
      '-123'
    );
    expect(
      refreshIntegrationService.startRefreshWorkflow
    ).toHaveBeenCalledTimes(2);
    expect(
      refreshIntegrationService.startRefreshWorkflow
    ).toHaveBeenNthCalledWith(
      1,
      organizationId,
      'existing-signed-group-fixture',
      provider
    );
    expect(
      refreshIntegrationService.startRefreshWorkflow
    ).toHaveBeenNthCalledWith(
      2,
      organizationId,
      'existing-signed-group-fixture',
      provider
    );
  });

  it('maps a safe VK Group selection failure to HTTP 400', async () => {
    provider.fetchPageInformation.mockRejectedValue(
      new BadBody(
        'vk-group',
        '{"code":15}',
        'upstream-body-fixture',
        'The selected VK community is not managed by this account.'
      )
    );

    let thrown: unknown;
    try {
      await service.saveProviderPage(organizationId, temporaryIntegrationId, {
        page: '999',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(400);
    expect((thrown as Error).message).toBe(
      'The selected VK community is not managed by this account.'
    );
    expect(JSON.stringify(thrown)).not.toContain('upstream-body-fixture');
    expect(repository.updateIntegration).not.toHaveBeenCalled();
    expect(
      refreshIntegrationService.startRefreshWorkflow
    ).not.toHaveBeenCalled();
  });

  it('maps VK error 5 during selection to a safe reconnect HTTP 400', async () => {
    provider.fetchPageInformation.mockRejectedValue(
      new RefreshToken(
        'vk-group',
        '{"token":"raw-selection-token-fixture"}',
        'raw-selection-body-fixture',
        'VK groups.getById failed with error 5'
      )
    );

    let thrown: unknown;
    try {
      await service.saveProviderPage(organizationId, temporaryIntegrationId, {
        page: '123',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(400);
    expect((thrown as Error).message).toBe(
      'Reconnect VK Group through VK authorization and try again.'
    );
    expect(JSON.stringify(thrown)).not.toContain('raw-selection-token-fixture');
    expect(JSON.stringify(thrown)).not.toContain('raw-selection-body-fixture');
    expect(repository.updateIntegration).not.toHaveBeenCalled();
    expect(
      refreshIntegrationService.startRefreshWorkflow
    ).not.toHaveBeenCalled();
  });
});
