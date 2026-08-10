import { describe, expect, it, vi } from 'vitest';
import { PersonalStreakReminderStarter } from './personal-streak-reminder.starter';

function createStarter(start = vi.fn().mockResolvedValue(undefined)) {
  const usersService = {
    getEnabledOrganizationUsers: vi
      .fn()
      .mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]),
    getEnabledReminderOrganizations: vi
      .fn()
      .mockResolvedValue([
        { organizationId: 'org-1' },
        { organizationId: 'org-2' },
      ]),
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
    let rejectFirst!: (reason: Error) => void;
    const firstStart = new Promise<void>((_, reject) => {
      rejectFirst = reject;
    });
    const start = vi
      .fn()
      .mockReturnValueOnce(firstStart)
      .mockResolvedValueOnce(undefined);
    const { starter } = createStarter(start);
    const logger = vi.fn();
    (starter as any)._logger.error = logger;

    const fanout = starter.startForOrganization('org-1');
    await Promise.resolve();

    expect(start).toHaveBeenCalledTimes(2);
    rejectFirst(new Error('Temporal unavailable'));
    await expect(fanout).resolves.toBeUndefined();
    expect(logger).toHaveBeenCalledWith(
      'Failed to start streak reminder organizationId=org-1 userId=user-1'
    );
  });

  it('replaces reminders for every enabled organization membership of a user', async () => {
    const { starter, start, usersService } = createStarter();

    await starter.startForUserOrganizations('user-1');

    expect(usersService.getEnabledReminderOrganizations).toHaveBeenCalledWith(
      'user-1'
    );
    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledWith(
      'personalStreakReminderWorkflow',
      expect.objectContaining({ workflowId: 'streak_org-1_user-1' })
    );
    expect(start).toHaveBeenCalledWith(
      'personalStreakReminderWorkflow',
      expect.objectContaining({ workflowId: 'streak_org-2_user-1' })
    );
  });
});
