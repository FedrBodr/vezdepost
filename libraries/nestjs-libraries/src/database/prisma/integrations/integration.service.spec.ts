import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationService } from './integration.service';

const organizationId = 'organization-fixture';
const temporaryIntegrationId = 'temporary-integration-fixture';
const userAccessToken = 'user-access-token-fixture';
const userRefreshToken = 'user-refresh-token-fixture';
const userTokenExpiration = new Date('2030-01-01T00:00:00.000Z');

const temporaryVkGroupIntegration = () => ({
  id: temporaryIntegrationId,
  internalId: 'vk-group-oauth:42',
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
  let service: IntegrationService;

  beforeEach(() => {
    repository = {
      getIntegrationById: vi
        .fn()
        .mockResolvedValue(temporaryVkGroupIntegration()),
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
    const integrationManager = {
      getSocialIntegration: vi.fn().mockReturnValue(provider),
    };

    service = new IntegrationService(
      repository as never,
      {} as never,
      integrationManager as never,
      {} as never,
      {} as never,
      {} as never
    );
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
      }
    );
    expect(repository.deleteChannel).not.toHaveBeenCalled();
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
      }
    );
    expect(repository.deleteChannel).not.toHaveBeenCalled();
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
  });
});
