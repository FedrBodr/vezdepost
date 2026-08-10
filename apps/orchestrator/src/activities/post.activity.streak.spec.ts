import { describe, expect, it, vi } from 'vitest';
import { PostActivity } from './post.activity';

function createActivity({ start = vi.fn() } = {}) {
  const postService = {
    updatePost: vi.fn().mockResolvedValue({
      id: 'post-1',
      organizationId: 'org-1',
      state: 'PUBLISHED',
    }),
  };
  const usersService = {
    getEnabledOrganizationUsers: vi
      .fn()
      .mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]),
  };
  const temporalService = {
    client: {
      getRawClient: () => ({ workflow: { start } }),
    },
  };
  const activity = new PostActivity(
    postService as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    temporalService as any,
    {} as any,
    usersService as any
  );

  return { activity, postService, usersService, start };
}

describe('PostActivity personal streak reminders', () => {
  it('starts one replacement workflow per enabled organization user after publishing', async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const { activity, postService, usersService } = createActivity({ start });

    await activity.updatePost('post-1', '77', 'https://vk.test/wall1_77');

    expect(postService.updatePost).toHaveBeenCalledTimes(1);
    expect(usersService.getEnabledOrganizationUsers).toHaveBeenCalledWith(
      'org-1'
    );
    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenNthCalledWith(
      1,
      'personalStreakReminderWorkflow',
      expect.objectContaining({
        args: [{ organizationId: 'org-1', userId: 'user-1' }],
        workflowId: 'streak_org-1_user-1',
        taskQueue: 'main',
        workflowIdConflictPolicy: 'TERMINATE_EXISTING',
      })
    );
    expect(start).toHaveBeenNthCalledWith(
      2,
      'personalStreakReminderWorkflow',
      expect.objectContaining({
        args: [{ organizationId: 'org-1', userId: 'user-2' }],
        workflowId: 'streak_org-1_user-2',
        workflowIdConflictPolicy: 'TERMINATE_EXISTING',
      })
    );
  });

  it('does not reject a confirmed publication when reminder startup fails', async () => {
    const start = vi.fn().mockRejectedValue(new Error('Temporal unavailable'));
    const { activity, postService } = createActivity({ start });

    await expect(
      activity.updatePost('post-1', '77', 'https://vk.test/wall1_77')
    ).resolves.toEqual(
      expect.objectContaining({ id: 'post-1', state: 'PUBLISHED' })
    );
    expect(postService.updatePost).toHaveBeenCalledTimes(1);
  });
});
