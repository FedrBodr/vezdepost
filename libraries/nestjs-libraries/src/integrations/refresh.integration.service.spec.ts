import { describe, expect, it, vi } from 'vitest';
import { RefreshIntegrationService } from './refresh.integration.service';

describe('RefreshIntegrationService workflow startup', () => {
  it('rejects when a refresh-cron provider has no raw Temporal client', async () => {
    const getRawClient = vi.fn().mockReturnValue(undefined);
    const service = new RefreshIntegrationService(
      {} as never,
      {} as never,
      { client: { getRawClient } } as never
    );

    await expect(
      service.startRefreshWorkflow(
        'organization-fixture',
        'integration-fixture',
        {
          refreshCron: true,
        } as never
      )
    ).rejects.toThrow('Temporal client is unavailable');
    expect(getRawClient).toHaveBeenCalledOnce();
  });

  it('keeps refresh-cron-disabled providers as a harmless no-op', async () => {
    const getRawClient = vi.fn();
    const service = new RefreshIntegrationService(
      {} as never,
      {} as never,
      { client: { getRawClient } } as never
    );

    await expect(
      service.startRefreshWorkflow(
        'organization-fixture',
        'integration-fixture',
        {
          refreshCron: false,
        } as never
      )
    ).resolves.toBe(false);
    expect(getRawClient).not.toHaveBeenCalled();
  });
});

describe('RefreshIntegrationService token refresh failures', () => {
  const integration = {
    id: 'integration-fixture',
    organizationId: 'organization-fixture',
    providerIdentifier: 'vk-group',
    refreshToken: 'refresh-secret&&&&device-1',
    internalId: 'group-1',
    rootInternalId: 'vk-group-oauth:1',
  } as never;

  const setup = (error: unknown) => {
    const integrationService = {
      refreshNeeded: vi.fn(),
      informAboutRefreshError: vi.fn(),
      disconnectChannel: vi.fn(),
      createOrUpdateIntegration: vi.fn(),
    };
    const manager = {
      getSocialIntegration: vi.fn().mockReturnValue({
        refreshToken: vi.fn().mockRejectedValue(error),
      }),
    };
    const service = new RefreshIntegrationService(
      manager as never,
      integrationService as never,
      {} as never
    );
    return { service, integrationService };
  };

  const transient = Object.assign(
    new Error('VK ID refresh failed: fetch failed'),
    {
      transient: true,
    }
  );

  it('keeps the channel connected and rethrows a transient failure on the scheduled refresh', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { service, integrationService } = setup(transient);

    await expect(
      service.refresh(integration, '', { scheduled: true })
    ).rejects.toBe(transient);

    expect(integrationService.refreshNeeded).not.toHaveBeenCalled();
    expect(integrationService.disconnectChannel).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalled();
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('refresh-secret');
    errorLog.mockRestore();
  });

  it('still disconnects on a transient failure outside the scheduled refresh', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { service, integrationService } = setup(transient);

    await expect(service.refresh(integration)).resolves.toBe(false);

    expect(integrationService.refreshNeeded).toHaveBeenCalledWith(
      'organization-fixture',
      'integration-fixture'
    );
    expect(integrationService.disconnectChannel).toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it('disconnects and logs the reason when the refresh token is rejected', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { service, integrationService } = setup(
      new Error('VK oauth2/auth failed with invalid_grant')
    );

    await expect(
      service.refresh(integration, '', { scheduled: true })
    ).resolves.toBe(false);

    expect(integrationService.refreshNeeded).toHaveBeenCalled();
    expect(integrationService.disconnectChannel).toHaveBeenCalled();
    expect(JSON.stringify(errorLog.mock.calls)).toContain('invalid_grant');
    errorLog.mockRestore();
  });
});
