import { describe, expect, it, vi } from 'vitest';
import { PersonalStreakReminderStarter } from './personal-streak-reminder.starter';

function createStarter(start = vi.fn().mockResolvedValue(undefined)) {
  const usersService = {
    getEnabledOrganizationUsers: vi
      .fn()
      .mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]),
  };
  const temporalService = {
    client: { getRawClient: () => ({ workflow: { start } }) },
  };
  const starter = new PersonalStreakReminderStarter(
    temporalService as any,
    usersService as any
  );

  return { starter, start, usersService };
}

describe('PersonalStreakReminderStarter', () => {
  it('starts a replacement workflow with the shared workflow identity', async () => {
    const { starter, start } = createStarter();

    await starter.startForUser('org-1', 'user-1');

    expect(start).toHaveBeenCalledWith(
      'personalStreakReminderWorkflow',
      expect.objectContaining({
        args: [{ organizationId: 'org-1', userId: 'user-1' }],
        workflowId: 'streak_org-1_user-1',
        taskQueue: 'main',
        workflowIdConflictPolicy: 'TERMINATE_EXISTING',
      })
    );
  });

  it('fans out only over users selected as reminder-enabled', async () => {
    const { starter, start, usersService } = createStarter();

    await starter.startForOrganization('org-1');

    expect(usersService.getEnabledOrganizationUsers).toHaveBeenCalledWith(
      'org-1'
    );
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('continues starting other users after one immediate start failure', async () => {
    const start = vi
      .fn()
      .mockRejectedValueOnce(new Error('Temporal unavailable'))
      .mockResolvedValueOnce(undefined);
    const { starter } = createStarter(start);

    await expect(
      starter.startForOrganization('org-1')
    ).resolves.toBeUndefined();

    expect(start).toHaveBeenCalledTimes(2);
  });
});
