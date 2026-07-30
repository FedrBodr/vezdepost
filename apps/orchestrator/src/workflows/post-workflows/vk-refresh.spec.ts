import { describe, expect, it, vi } from 'vitest';
import { ActivityFailure, ApplicationFailure } from '@temporalio/workflow';
import { RetryState } from '@temporalio/common';

const activities = vi.hoisted(() => ({
  main: {
    getPostsList: vi.fn(),
    getPost: vi.fn(),
    inAppNotification: vi.fn(),
    changeState: vi.fn(),
    updatePost: vi.fn(),
    sendWebhooks: vi.fn(),
    isCommentable: vi.fn(),
  },
  taskQueue: {
    postSocial: vi.fn(),
    postComment: vi.fn(),
    getIntegrationById: vi.fn(),
    refreshTokenWithCause: vi.fn(),
    internalPlugs: vi.fn(),
    globalPlugs: vi.fn(),
    processInternalPlug: vi.fn(),
    processPlug: vi.fn(),
  },
}));

vi.mock('@temporalio/workflow', async (importOriginal) => {
  const temporal = await importOriginal<
    typeof import('@temporalio/workflow')
  >();

  return {
    ...temporal,
    proxyActivities: vi.fn((options: { taskQueue?: string }) =>
      options.taskQueue ? activities.taskQueue : activities.main
    ),
    sleep: vi.fn(),
    defineSignal: vi.fn((name: string) => name),
    setHandler: vi.fn(),
    startChild: vi.fn(),
  };
});

import { postWorkflowV105 } from './post.workflow.v1.0.5';

describe('VK workflow token refresh', () => {
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
  });
});
