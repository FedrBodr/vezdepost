import { describe, expect, it, vi } from 'vitest';
import { PostActivity } from './post.activity';

function createActivity() {
  const postService = {
    updatePost: vi.fn().mockResolvedValue({
      id: 'post-1',
      organizationId: 'org-1',
      state: 'PUBLISHED',
    }),
  };
  const reminderStarter = {
    startForOrganization: vi.fn().mockResolvedValue(undefined),
  };
  const activity = new PostActivity(
    postService as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    reminderStarter as any
  );

  return { activity, postService, reminderStarter };
}

describe('PostActivity personal streak reminders', () => {
  it('keeps the atomic publication update free of reminder side effects', async () => {
    const { activity, postService, reminderStarter } = createActivity();

    await expect(
      activity.updatePost('post-1', '77', 'https://vk.test/wall1_77')
    ).resolves.toEqual(
      expect.objectContaining({ id: 'post-1', state: 'PUBLISHED' })
    );

    expect(postService.updatePost).toHaveBeenCalledWith(
      'post-1',
      '77',
      'https://vk.test/wall1_77'
    );
    expect(reminderStarter.startForOrganization).not.toHaveBeenCalled();
  });

  it('exposes reminder fan-out as a separate activity', async () => {
    const { activity, reminderStarter } = createActivity();

    await activity.startPersonalStreakReminders('org-1');

    expect(reminderStarter.startForOrganization).toHaveBeenCalledWith('org-1');
  });
});
