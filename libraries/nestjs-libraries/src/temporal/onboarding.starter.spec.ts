import { describe, expect, it, vi } from 'vitest';
import { OnboardingStarter } from './onboarding.starter';

function createStarter(start = vi.fn().mockResolvedValue(undefined)) {
  const temporalService = {
    client: { getRawClient: () => ({ workflow: { start } }) },
  };
  return { starter: new OnboardingStarter(temporalService as any), start };
}

describe('OnboardingStarter', () => {
  it('starts one chain per user and reuses a running one', async () => {
    const { starter, start } = createStarter();

    await starter.startForNewUser('org-1', 'user-1');

    expect(start).toHaveBeenCalledWith(
      'onboardingWorkflow',
      expect.objectContaining({
        args: [{ userId: 'user-1' }],
        workflowId: 'onboarding_user-1',
        taskQueue: 'main',
        workflowIdConflictPolicy: 'USE_EXISTING',
      })
    );
  });

  it('logs instead of throwing when Temporal is unavailable', async () => {
    const { starter } = createStarter(
      vi.fn().mockRejectedValue(new Error('Temporal unavailable'))
    );
    const logger = vi.fn();
    (starter as any)._logger.error = logger;

    await expect(
      starter.startForNewUser('org-1', 'user-1')
    ).resolves.toBeUndefined();
    expect(logger).toHaveBeenCalled();
  });
});
