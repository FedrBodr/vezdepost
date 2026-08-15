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
