import { describe, expect, it, vi } from 'vitest';
import { UsersController } from './users.controller';

function createController(startForUser = vi.fn().mockResolvedValue(undefined)) {
  const userService = {
    updateTimezone: vi
      .fn()
      .mockResolvedValue({ timezoneName: 'America/New_York' }),
  };
  const reminderStarter = { startForUser };
  const controller = new UsersController(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    userService as any,
    {} as any,
    {} as any,
    reminderStarter as any
  );

  return { controller, userService, reminderStarter };
}

describe('UsersController.updateTimezone reminder replacement', () => {
  it('starts the personal reminder only after persisting the canonical timezone', async () => {
    const { controller, userService, reminderStarter } = createController();

    await expect(
      controller.updateTimezone(
        { id: 'user-1' } as any,
        { id: 'org-1' } as any,
        { timezoneName: 'US/Eastern' }
      )
    ).resolves.toEqual({ timezoneName: 'America/New_York' });

    expect(userService.updateTimezone).toHaveBeenCalledWith(
      'user-1',
      'US/Eastern'
    );
    expect(reminderStarter.startForUser).toHaveBeenCalledWith(
      'org-1',
      'user-1'
    );
    expect(userService.updateTimezone.mock.invocationCallOrder[0]).toBeLessThan(
      reminderStarter.startForUser.mock.invocationCallOrder[0]
    );
  });

  it('keeps a valid persisted timezone when reminder replacement fails', async () => {
    const startForUser = vi
      .fn()
      .mockRejectedValue(new Error('Temporal unavailable'));
    const { controller, userService } = createController(startForUser);

    await expect(
      controller.updateTimezone(
        { id: 'user-1' } as any,
        { id: 'org-1' } as any,
        { timezoneName: 'America/New_York' }
      )
    ).resolves.toEqual({ timezoneName: 'America/New_York' });

    expect(userService.updateTimezone).toHaveBeenCalledTimes(1);
  });
});
