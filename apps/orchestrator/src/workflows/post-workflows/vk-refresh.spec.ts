import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityFailure, ApplicationFailure } from '@temporalio/workflow';
import { RetryState } from '@temporalio/common';

const activities = vi.hoisted(() => ({
  main: {
    getPostsList: vi.fn(),
    getPost: vi.fn(),
    inAppNotification: vi.fn(),
    changeState: vi.fn(),
    updatePost: vi.fn(),
    startPersonalStreakReminders: vi.fn(),
    sendWebhooks: vi.fn(),
    isCommentable: vi.fn(),
  },
  taskQueue: {
    postSocial: vi.fn(),
    postComment: vi.fn(),
    getIntegrationById: vi.fn(),
    refreshToken: vi.fn(),
    refreshTokenWithCause: vi.fn(),
    internalPlugs: vi.fn(),
    globalPlugs: vi.fn(),
    processInternalPlug: vi.fn(),
    processPlug: vi.fn(),
  },
}));
const proxyOptions = vi.hoisted(() => [] as Array<Record<string, any>>);
const workflowLog = vi.hoisted(() => ({ error: vi.fn() }));
const workflowPatch = vi.hoisted(() => ({ enabled: true }));

vi.mock('@temporalio/workflow', async (importOriginal) => {
  const temporal = await importOriginal<
    typeof import('@temporalio/workflow')
  >();

  return {
    ...temporal,
    proxyActivities: vi.fn((options: Record<string, any>) => {
      proxyOptions.push(options);
      return options.taskQueue ? activities.taskQueue : activities.main;
    }),
    sleep: vi.fn(),
    defineSignal: vi.fn((name: string) => name),
    setHandler: vi.fn(),
    startChild: vi.fn(),
    patched: vi.fn(() => workflowPatch.enabled),
    log: workflowLog,
  };
});

import { postWorkflowV101 } from './post.workflow.v1.0.1';
import { postWorkflowV102 } from './post.workflow.v1.0.2';
import { postWorkflowV103 } from './post.workflow.v1.0.3';
import { postWorkflowV104 } from './post.workflow.v1.0.4';
import { postWorkflowV105 } from './post.workflow.v1.0.5';

const workflows = [
  ['v1.0.1', postWorkflowV101],
  ['v1.0.2', postWorkflowV102],
  ['v1.0.3', postWorkflowV103],
  ['v1.0.4', postWorkflowV104],
  ['v1.0.5', postWorkflowV105],
] as const;

describe('VK workflow token refresh', () => {
  beforeEach(() => {
    for (const activity of [
      ...Object.values(activities.main),
      ...Object.values(activities.taskQueue),
    ]) {
      activity.mockReset();
    }
    workflowLog.error.mockReset();
    workflowPatch.enabled = true;
  });

  function prepareConfirmedPublication() {
    const integration = {
      id: 'integration-1',
      internalId: 'vk-user-1',
      organizationId: 'organization-1',
      providerIdentifier: 'vk',
      name: 'Personal VK',
      token: 'token',
      refreshNeeded: false,
      disabled: false,
    };
    const post = {
      id: 'post-1',
      organizationId: 'organization-1',
      state: 'QUEUE',
      publishDate: new Date(0),
      integration,
      settings: '{}',
    };

    activities.main.getPost.mockResolvedValue(post);
    activities.main.getPostsList.mockResolvedValue([post]);
    activities.main.inAppNotification.mockResolvedValue(undefined);
    activities.main.updatePost.mockResolvedValue(undefined);
    activities.main.startPersonalStreakReminders.mockResolvedValue(undefined);
    activities.main.sendWebhooks.mockResolvedValue(undefined);
    activities.taskQueue.internalPlugs.mockResolvedValue([]);
    activities.taskQueue.globalPlugs.mockResolvedValue([]);
    activities.taskQueue.postSocial.mockResolvedValue([
      {
        postId: '77',
        releaseURL: 'https://vk.com/feed?w=wallvk-user-1_77',
        status: 'completed',
      },
    ]);

    return post;
  }

  it.each(workflows)(
    '%s skips the new reminder command while replaying history without the patch marker',
    async (_version, workflow) => {
      workflowPatch.enabled = false;
      const post = prepareConfirmedPublication();

      await workflow({
        taskQueue: 'vk-personal',
        postId: post.id,
        organizationId: post.organizationId,
        postNow: true,
      });

      expect(activities.main.updatePost).toHaveBeenCalledTimes(1);
      expect(
        activities.main.startPersonalStreakReminders
      ).not.toHaveBeenCalled();
    }
  );

  it.each(workflows)(
    '%s schedules reminders for executions carrying the patch marker',
    async (_version, workflow) => {
      workflowPatch.enabled = true;
      const post = prepareConfirmedPublication();

      await workflow({
        taskQueue: 'vk-personal',
        postId: post.id,
        organizationId: post.organizationId,
        postNow: true,
      });

      expect(activities.main.startPersonalStreakReminders).toHaveBeenCalledWith(
        'organization-1'
      );
    }
  );

  it('uses a short single-attempt reminder startup activity', () => {
    expect(proxyOptions).toContainEqual(
      expect.objectContaining({
        startToCloseTimeout: '30 seconds',
        retry: { maximumAttempts: 1 },
      })
    );
  });

  it('refreshes an expired token and retries the post with the new token', async () => {
    const integration = {
      id: 'integration-1',
      internalId: 'vk-user-1',
      organizationId: 'organization-1',
      providerIdentifier: 'vk',
      name: 'Personal VK',
      token: 'old-token',
      refreshNeeded: false,
      disabled: false,
    };
    const post = {
      id: 'post-1',
      organizationId: 'organization-1',
      state: 'QUEUE',
      publishDate: new Date(0),
      integration,
      settings: '{}',
    };
    const releaseURL = 'https://vk.com/feed?w=wallvk-user-1_77';
    const attemptedTokens: string[] = [];
    const refreshFailure = new ActivityFailure(
      'postSocial failed',
      'postSocial',
      'activity-1',
      RetryState.NON_RETRYABLE_FAILURE,
      'test-worker',
      ApplicationFailure.nonRetryable(
        'VK access token expired',
        'refresh_token'
      )
    );

    activities.main.getPost.mockResolvedValue(post);
    activities.main.getPostsList.mockResolvedValue([post]);
    activities.main.inAppNotification.mockResolvedValue(undefined);
    activities.main.updatePost.mockResolvedValue(undefined);
    activities.main.startPersonalStreakReminders.mockResolvedValue(undefined);
    activities.main.sendWebhooks.mockResolvedValue(undefined);
    activities.taskQueue.refreshTokenWithCause.mockResolvedValue({
      accessToken: 'new-token',
    });
    activities.taskQueue.internalPlugs.mockResolvedValue([]);
    activities.taskQueue.globalPlugs.mockResolvedValue([]);
    activities.taskQueue.postSocial.mockImplementation(async (current) => {
      attemptedTokens.push(current.token);
      if (attemptedTokens.length === 1) {
        throw refreshFailure;
      }

      return [
        {
          postId: '77',
          releaseURL,
          status: 'completed',
        },
      ];
    });

    await postWorkflowV105({
      taskQueue: 'vk-personal',
      postId: post.id,
      organizationId: post.organizationId,
      postNow: true,
    });

    expect(activities.taskQueue.postSocial).toHaveBeenCalledTimes(2);
    expect(attemptedTokens).toEqual(['old-token', 'new-token']);
    expect(activities.taskQueue.refreshTokenWithCause).toHaveBeenCalledTimes(1);
    expect(activities.taskQueue.refreshTokenWithCause).toHaveBeenCalledWith(
      integration,
      'VK access token expired'
    );
    expect(activities.main.updatePost).toHaveBeenCalledTimes(1);
    expect(activities.main.updatePost).toHaveBeenCalledWith(
      post.id,
      '77',
      releaseURL
    );
    expect(activities.main.startPersonalStreakReminders).toHaveBeenCalledWith(
      'organization-1'
    );
  });

  it('does not mark a confirmed post ERROR when reminder activity times out', async () => {
    const integration = {
      id: 'integration-1',
      internalId: 'vk-user-1',
      organizationId: 'organization-1',
      providerIdentifier: 'vk',
      name: 'Personal VK',
      token: 'token',
      refreshNeeded: false,
      disabled: false,
    };
    const post = {
      id: 'post-1',
      organizationId: 'organization-1',
      state: 'QUEUE',
      publishDate: new Date(0),
      integration,
      settings: '{}',
    };
    const releaseURL = 'https://vk.com/feed?w=wallvk-user-1_77';
    const reminderTimeout = new ActivityFailure(
      'startPersonalStreakReminders timed out',
      'startPersonalStreakReminders',
      'activity-reminder',
      RetryState.TIMEOUT,
      'test-worker',
      ApplicationFailure.retryable('Temporal timeout', 'TimeoutFailure')
    );

    activities.main.getPost.mockResolvedValue(post);
    activities.main.getPostsList.mockResolvedValue([post]);
    activities.main.inAppNotification.mockResolvedValue(undefined);
    activities.main.updatePost.mockResolvedValue(undefined);
    activities.main.startPersonalStreakReminders.mockRejectedValue(
      reminderTimeout
    );
    activities.main.sendWebhooks.mockResolvedValue(undefined);
    activities.taskQueue.internalPlugs.mockResolvedValue([]);
    activities.taskQueue.globalPlugs.mockResolvedValue([]);
    activities.taskQueue.postSocial.mockResolvedValue([
      { postId: '77', releaseURL, status: 'completed' },
    ]);

    await postWorkflowV105({
      taskQueue: 'vk-personal',
      postId: post.id,
      organizationId: post.organizationId,
      postNow: true,
    });

    expect(activities.main.updatePost).toHaveBeenCalledTimes(1);
    expect(activities.main.startPersonalStreakReminders).toHaveBeenCalledTimes(
      1
    );
    expect(activities.main.changeState).not.toHaveBeenCalled();
    expect(workflowLog.error).toHaveBeenCalledWith(
      'Failed to start personal streak reminders after confirmed publication',
      { organizationId: 'organization-1' }
    );
  });
});
