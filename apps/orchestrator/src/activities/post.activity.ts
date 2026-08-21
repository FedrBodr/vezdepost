import { Injectable } from '@nestjs/common';
import {
  Activity,
  ActivityMethod,
  TemporalService,
} from 'nestjs-temporal-core';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import {
  NotificationService,
  NotificationType,
} from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { Integration, Post, State } from '@prisma/client';
import { analyzePlatformContentV2 } from '@gitroom/helpers/utils/platform.content.analysis';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  AuthTokenDetails,
  MediaContent,
  PostDetails,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { authorizeMediaSource } from '@gitroom/helpers/utils/media.source';
import {
  collectPublicationMediaSourcePaths,
  collectPublicationThreadMediaSourcePaths,
  parsePublicationMediaSources,
} from './publication.media.sources';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { timer } from '@gitroom/helpers/utils/timer';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { TypedSearchAttributes } from '@temporalio/common';
import {
  organizationId,
  postId as postIdSearchParam,
} from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { PersonalStreakReminderStarter } from '@gitroom/nestjs-libraries/temporal/personal-streak-reminder.starter';
import { ApplicationFailure } from '@temporalio/activity';
import {
  isDeterministicPublicationMediaError,
  PUBLICATION_MEDIA_PREFLIGHT_FAILURE_TYPE,
} from './publication.media.preflight';

// Drops fields the workflow and downstream activities never read — biggest wins are `error` (grows per retry) and `childrenPost` (Prisma side-loads it on every recursive row).
function slimPost(post: any) {
  if (!post) return post;
  const {
    error,
    childrenPost,
    tags,
    description,
    title,
    submittedForOrderId,
    submittedForOrganizationId,
    submittedForOrder,
    submittedForOrganization,
    lastMessageId,
    parentPostId,
    approvedSubmitForOrder,
    deletedAt,
    createdAt,
    updatedAt,
    payoutProblems,
    comments,
    errors,
    ...rest
  } = post;
  return rest;
}

@Injectable()
@Activity()
export class PostActivity {
  constructor(
    private _postService: PostsService,
    private _notificationService: NotificationService,
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _webhookService: WebhooksService,
    private _temporalService: TemporalService,
    private _subscriptionService: SubscriptionService,
    private _personalStreakReminderStarter: PersonalStreakReminderStarter
  ) {}

  @ActivityMethod()
  async getIntegrationById(orgId: string, id: string) {
    return this._integrationService.getIntegrationById(orgId, id);
  }

  @ActivityMethod()
  async searchForMissingThreeHoursPosts() {
    const list = await this._postService.searchForMissingThreeHoursPosts();
    for (const post of list) {
      await this._temporalService.client
        .getRawClient()
        .workflow.signalWithStart('postWorkflowV105', {
          workflowId: `post_${post.id}`,
          taskQueue: 'main',
          signal: 'poke',
          workflowIdConflictPolicy: 'USE_EXISTING',
          signalArgs: [],
          args: [
            {
              taskQueue: post.integration.providerIdentifier
                .split('-')[0]
                .toLowerCase(),
              postId: post.id,
              organizationId: post.organizationId,
            },
          ],
          typedSearchAttributes: new TypedSearchAttributes([
            {
              key: postIdSearchParam,
              value: post.id,
            },
            {
              key: organizationId,
              value: post.organizationId,
            },
          ]),
        });
    }
  }

  @ActivityMethod()
  async updatePost(id: string, postId: string, releaseURL: string) {
    return this._postService.updatePost(id, postId, releaseURL);
  }

  @ActivityMethod()
  async startPersonalStreakReminders(organizationId: string) {
    return this._personalStreakReminderStarter.startForOrganization(
      organizationId
    );
  }

  @ActivityMethod()
  async getPost(orgId: string, postId: string) {
    if (process.env.STRIPE_SECRET_KEY) {
      const subscription = await this._subscriptionService.getSubscription(
        orgId
      );
      if (!subscription) {
        return false;
      }
    }
    const post = await this._postService.getPostById(postId, orgId);
    if (post.deletedAt) {
      return false;
    }

    return post;
  }

  @ActivityMethod()
  async getPostsList(orgId: string, postId: string) {
    if (process.env.STRIPE_SECRET_KEY) {
      const subscription = await this._subscriptionService.getSubscription(
        orgId
      );
      if (!subscription) {
        return [];
      }
    }

    const getPosts = await this._postService.getPostsRecursively(
      postId,
      true,
      orgId
    );
    if (!getPosts || getPosts.length === 0 || getPosts[0].parentPostId) {
      return [];
    }

    try {
      const posts = getPosts.map(slimPost);
      const providerIdentifier = posts[0]?.integration?.providerIdentifier;
      if (typeof providerIdentifier !== 'string' || !providerIdentifier) {
        throw new Error('Invalid publication integration');
      }
      return await this.resolveAndAuthorizePublicationThreadMedia(
        providerIdentifier,
        posts
      );
    } catch (error) {
      if (!isDeterministicPublicationMediaError(error)) throw error;
      throw ApplicationFailure.fromError(error, {
        type: PUBLICATION_MEDIA_PREFLIGHT_FAILURE_TYPE,
        nonRetryable: true,
      });
    }
  }

  @ActivityMethod()
  async isCommentable(integration: Integration) {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    return !!getIntegration.comment;
  }

  @ActivityMethod()
  async postComment(
    postId: string,
    lastPostId: string | undefined,
    integration: Integration,
    posts: Post[]
  ) {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    return getIntegration.comment(
      integration.internalId,
      postId,
      lastPostId,
      integration.token,
      await this.preparePostDetails(integration, posts, getIntegration),
      integration
    );
  }

  @ActivityMethod()
  async postSocial(integration: Integration, posts: Post[]) {
    if (process.env.STRIPE_SECRET_KEY) {
      const subscription = await this._subscriptionService.getSubscription(
        integration.organizationId
      );

      if (!subscription) {
        throw new Error('No active subscription found for this organization.');
      }
    }

    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    const postNow = await getIntegration.post(
      integration.internalId,
      integration.token,
      await this.preparePostDetails(integration, posts, getIntegration),
      integration
    );

    return postNow;
  }

  private async preparePostDetails(
    integration: Integration,
    posts: Post[],
    provider: SocialProvider
  ): Promise<PostDetails[]> {
    const preflightedPosts =
      await this.resolveAndAuthorizePublicationThreadMedia(
        integration.providerIdentifier,
        posts
      );

    const newPosts = await this._postService.updateTags(
      integration.organizationId,
      preflightedPosts as Post[]
    );

    return Promise.all(
      (newPosts || []).map(async (post) => {
        const settings = JSON.parse(post.settings || '{}');
        const normalizedMedia = (await this._postService.updateMedia(
          post.id,
          JSON.parse(post.image || '[]'),
          false
        )) as MediaContent[];
        const analyze = async (media: MediaContent[]) => {
          const capabilities =
            await this._integrationManager.resolveCapabilitiesV2({
              providerName: integration.providerIdentifier,
              settings,
              media: media.map(({ type }) => ({ type })),
              integration,
            });
          const analysis = analyzePlatformContentV2({
            canonicalHtml: post.content,
            settings,
            media: media.map(({ type }) => ({ type })),
            capability: capabilities,
            convertMentionFunction: provider.mentionFormat,
          });
          const blocking = analysis.diagnostics.find(
            ({ severity }) => severity === 'error'
          );
          if (blocking) throw new Error(blocking.message);
          return analysis;
        };

        const analysis = await analyze(normalizedMedia);
        const media = provider.convertToJPEG
          ? ((await this._postService.updateMedia(
              post.id,
              normalizedMedia,
              true
            )) as MediaContent[])
          : normalizedMedia;

        const sourcePaths = collectPublicationMediaSourcePaths({
          providerIdentifier: integration.providerIdentifier,
          settings,
          media,
        });
        await Promise.all(
          sourcePaths.map((path) => authorizeMediaSource(path))
        );
        const fields = analysis.fields;
        return {
          id: post.id,
          fields,
          message:
            fields.body?.value ??
            fields.caption?.value ??
            fields.description?.value ??
            '',
          settings,
          media,
        };
      })
    );
  }

  private async resolveAndAuthorizePublicationThreadMedia<
    T extends { settings?: string | null; image?: string | null }
  >(providerIdentifier: string, posts: readonly T[]): Promise<T[]> {
    const resolvedPosts = await Promise.all(
      posts.map(async (post) => {
        const media = parsePublicationMediaSources(post.image);
        const resolvedMedia = media.some(
          ({ path }) => typeof path !== 'string' || !path.trim()
        )
          ? await this._postService.resolveMediaSources(media)
          : media;
        return { ...post, image: JSON.stringify(resolvedMedia) };
      })
    );
    const sourcePaths = collectPublicationThreadMediaSourcePaths({
      providerIdentifier,
      posts: resolvedPosts,
    });
    await Promise.all(sourcePaths.map((path) => authorizeMediaSource(path)));
    return resolvedPosts;
  }

  @ActivityMethod()
  async inAppNotification(
    orgId: string,
    subject: string,
    message: string,
    sendEmail = false,
    digest = false,
    type: NotificationType = 'success'
  ) {
    await this._notificationService.inAppNotification(
      orgId,
      subject,
      message,
      sendEmail,
      digest,
      type
    );
  }

  @ActivityMethod()
  async globalPlugs(integration: Integration) {
    return this._postService.checkPlugs(
      integration.organizationId,
      integration.providerIdentifier,
      integration.id
    );
  }

  @ActivityMethod()
  async changeState(id: string, state: State, err?: any, body?: any) {
    await this._postService.changeState(id, state, err, body);
  }

  @ActivityMethod()
  async internalPlugs(integration: Integration, settings: any) {
    return this._postService.checkInternalPlug(
      integration,
      integration.organizationId,
      integration.id,
      settings
    );
  }

  @ActivityMethod()
  async sendWebhooks(postId: string, orgId: string, integrationId: string) {
    const webhooks = (await this._webhookService.getWebhooks(orgId)).filter(
      (f) => {
        return (
          f.integrations.length === 0 ||
          f.integrations.some((i) => i.integration.id === integrationId)
        );
      }
    );

    const post = await this._postService.getPostByForWebhookId(postId);
    await Promise.all(
      webhooks.map(async (webhook) => {
        try {
          await fetch(webhook.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(post),
          });
        } catch (e) {
          /**empty**/
        }
      })
    );
  }
  @ActivityMethod()
  async processPlug(data: {
    plugId: string;
    postId: string;
    delay: number;
    totalRuns: number;
    currentRun: number;
  }) {
    return this._integrationService.processPlugs(data);
  }

  @ActivityMethod()
  async processInternalPlug(data: {
    post: string;
    originalIntegration: string;
    integration: string;
    plugName: string;
    orgId: string;
    delay: number;
    information: any;
  }) {
    await this._integrationService.processInternalPlug(data);
  }

  @ActivityMethod()
  async refreshToken(
    integration: Integration
  ): Promise<false | AuthTokenDetails> {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    try {
      const refresh = await this._refreshIntegrationService.refresh(
        integration
      );
      if (!refresh) {
        return false;
      }

      if (getIntegration.refreshWait) {
        await timer(10000);
      }

      return refresh;
    } catch (err) {
      await this._refreshIntegrationService.setBetweenSteps(integration);
      return false;
    }
  }

  @ActivityMethod()
  async refreshTokenWithCause(
    integration: Integration,
    cause: string
  ): Promise<false | AuthTokenDetails> {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    try {
      const refresh = await this._refreshIntegrationService.refresh(
        integration,
        cause
      );
      if (!refresh) {
        return false;
      }

      if (getIntegration.refreshWait) {
        await timer(10000);
      }

      return refresh;
    } catch (err) {
      await this._refreshIntegrationService.setBetweenSteps(integration, cause);
      return false;
    }
  }
}
