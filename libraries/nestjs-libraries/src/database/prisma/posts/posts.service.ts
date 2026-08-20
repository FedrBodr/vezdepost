import {
  BadRequestException,
  Injectable,
  ValidationPipe,
} from '@nestjs/common';
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';
import { CreatePostDto } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import dayjs from 'dayjs';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  Integration,
  Post,
  Media,
  From,
  CreationMethod,
  State,
} from '@prisma/client';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import { GetPostsListDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.list.dto';
import { shuffle } from 'lodash';
import { CreateGeneratedPostsDto } from '@gitroom/nestjs-libraries/dtos/generator/create.generated.posts.dto';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import utc from 'dayjs/plugin/utc';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';
import { CreateTagDto } from '@gitroom/nestjs-libraries/dtos/posts/create.tag.dto';
import {
  minifyPostsList,
  minifyPosts,
} from '@gitroom/helpers/utils/posts.list.minify';
import sharp from 'sharp';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { Readable } from 'stream';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
dayjs.extend(utc);
import * as Sentry from '@sentry/nestjs';
import { TemporalService } from 'nestjs-temporal-core';
import { TypedSearchAttributes } from '@temporalio/common';
import {
  organizationId,
  postId as postIdSearchParam,
} from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
import { AnalyticsData } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { timer } from '@gitroom/helpers/utils/timer';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import {
  ValidUrlExtension,
  ValidUrlPath,
} from '@gitroom/helpers/utils/valid.url.path';
import {
  SAFE_REMOTE_IMAGE_FETCH_BODY_TIMEOUT_MS,
  SAFE_REMOTE_IMAGE_FETCH_MAX_BYTES,
  fetchRemoteBuffer,
} from '@gitroom/helpers/utils/ssrf.safe.fetch';
import { readOrFetch } from '@gitroom/helpers/utils/read.or.fetch';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { analyzePlatformContent } from '@gitroom/helpers/utils/platform.content';
import { analyzePlatformContentV2 } from '@gitroom/helpers/utils/platform.content.analysis';
import { normalizedFieldMeasurementValue } from '@gitroom/helpers/utils/platform.content.normalizers';
import type { ResolvedPlatformCapabilityV2 } from '@gitroom/helpers/utils/platform.capability.types';
import {
  PostValidationFailure,
  selectPostValidationFailure,
} from '@gitroom/nestjs-libraries/database/prisma/posts/post.validation';
import {
  resolveAppOwnedLocalUploadFilePath,
  resolveLocalUploadFilePath,
} from '@gitroom/helpers/utils/local.upload.path';

type PostWithConditionals = Post & {
  integration?: Integration;
  childrenPost: Post[];
};

const mediaPathValidator = new ValidUrlPath();
const mediaExtensionValidator = new ValidUrlExtension();
const mediaValidationArguments = {} as any;

@Injectable()
export class PostsService {
  private storage = UploadFactory.createStorage();
  constructor(
    private _postRepository: PostsRepository,
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _mediaService: MediaService,
    private _shortLinkService: ShortLinkService,
    private _openaiService: OpenaiService,
    private _temporalService: TemporalService,
    private _refreshIntegrationService: RefreshIntegrationService
  ) {}

  searchForMissingThreeHoursPosts() {
    return this._postRepository.searchForMissingThreeHoursPosts();
  }

  updatePost(id: string, postId: string, releaseURL: string) {
    if (
      typeof postId !== 'string' ||
      postId.trim() === '' ||
      postId === 'undefined'
    ) {
      throw new BadRequestException('A provider post ID is required');
    }

    return this._postRepository.updatePost(id, postId, releaseURL);
  }

  async getMissingContent(
    orgId: string,
    postId: string,
    forceRefresh = false
  ): Promise<{ id: string; url: string }[]> {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post || post.releaseId !== 'missing') {
      return [];
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      post.integration.providerIdentifier
    );

    if (!integrationProvider.missing) {
      return [];
    }

    const getIntegration = post.integration!;

    if (
      dayjs(getIntegration?.tokenExpiration).isBefore(dayjs()) ||
      forceRefresh
    ) {
      const data = await this._refreshIntegrationService.refresh(
        getIntegration
      );
      if (!data) {
        return [];
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this._integrationService.disconnectChannel(orgId, getIntegration);
        return [];
      }
    }

    try {
      return await integrationProvider.missing(
        getIntegration.internalId,
        getIntegration.token
      );
    } catch (e) {
      console.log(e);
      if (e instanceof RefreshToken) {
        return this.getMissingContent(orgId, postId, true);
      }
    }

    return [];
  }

  async getPostById(postId: string, orgId: string) {
    return this._postRepository.getPostById(postId, orgId);
  }

  async updateReleaseId(orgId: string, postId: string, releaseId: string) {
    return this._postRepository.updateReleaseId(postId, orgId, releaseId);
  }

  async checkPostAnalytics(
    orgId: string,
    postId: string,
    date: number,
    forceRefresh = false
  ): Promise<AnalyticsData[] | { missing: true }> {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post || !post.releaseId) {
      return [];
    }

    if (post.releaseId === 'missing') {
      return { missing: true };
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      post.integration.providerIdentifier
    );

    if (!integrationProvider.postAnalytics) {
      return [];
    }

    const getIntegration = post.integration!;

    if (
      dayjs(getIntegration?.tokenExpiration).isBefore(dayjs()) ||
      forceRefresh
    ) {
      const data = await this._refreshIntegrationService.refresh(
        getIntegration
      );
      if (!data) {
        return [];
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this._integrationService.disconnectChannel(orgId, getIntegration);
        return [];
      }
    }

    // const getIntegrationData = await ioRedis.get(
    //   `integration:${orgId}:${post.id}:${date}`
    // );
    // if (getIntegrationData) {
    //   return JSON.parse(getIntegrationData);
    // }

    try {
      const loadAnalytics = await integrationProvider.postAnalytics(
        getIntegration.internalId,
        getIntegration.token,
        post.releaseId,
        date
      );
      await ioRedis.set(
        `integration:${orgId}:${post.id}:${date}`,
        JSON.stringify(loadAnalytics),
        'EX',
        !process.env.NODE_ENV || process.env.NODE_ENV === 'development'
          ? 1
          : 3600
      );
      return loadAnalytics;
    } catch (e) {
      console.log(e);
      if (e instanceof RefreshToken) {
        return this.checkPostAnalytics(orgId, postId, date, true);
      }
    }

    return [];
  }

  async getStatistics(orgId: string, id: string) {
    const getPost = await this.getPostsRecursively(id, true, orgId, true);
    const content = getPost.map((p) => p.content);
    const shortLinksTracking = await this._shortLinkService.getStatistics(
      content
    );

    return {
      clicks: shortLinksTracking,
    };
  }

  async mapTypeToPost(
    body: CreatePostDto,
    organization: string,
    replaceDraft: boolean = false
  ): Promise<CreatePostDto> {
    if (!body?.posts?.every((p) => p?.integration?.id)) {
      throw new BadRequestException('All posts must have an integration id');
    }

    const mappedValues = {
      ...body,
      type: replaceDraft ? 'schedule' : body?.type,
      posts: await Promise.all(
        body?.posts?.map(async (post) => {
          const integration = await this._integrationService.getIntegrationById(
            organization,
            post.integration.id
          );

          if (!integration) {
            throw new BadRequestException(
              `Integration with id ${post.integration.id} not found`
            );
          }

          return {
            type: replaceDraft ? 'schedule' : body?.type,
            ...post,
            settings: {
              ...(post.settings || ({} as any)),
              __type: integration.providerIdentifier,
            },
          };
        }) || []
      ),
    };

    const validationPipe = new ValidationPipe({
      skipMissingProperties: false,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    });

    return await validationPipe.transform(mappedValues, {
      type: 'body',
      metatype: CreatePostDto,
    });
  }

  async getPostsRecursively(
    id: string,
    includeIntegration = false,
    orgId?: string,
    isFirst?: boolean
  ): Promise<PostWithConditionals[]> {
    const post = await this._postRepository.getPost(
      id,
      includeIntegration,
      orgId,
      isFirst
    );

    if (!post) {
      return [];
    }

    return [
      post!,
      ...(post?.childrenPost?.length
        ? await this.getPostsRecursively(
            post?.childrenPost?.[0]?.id,
            false,
            orgId,
            false
          )
        : []),
    ];
  }

  async getPosts(orgId: string, query: GetPostsDto) {
    return this._postRepository.getPosts(orgId, query);
  }

  async getPostsMinified(orgId: string, query: GetPostsDto) {
    return minifyPosts({
      posts: await this._postRepository.getPosts(orgId, query),
    });
  }

  async getPostsList(orgId: string, query: GetPostsListDto) {
    return minifyPostsList(
      await this._postRepository.getPostsList(orgId, query)
    );
  }

  async updateMedia(
    id: string,
    imagesList: any[] | null,
    convertToJPEG = false
  ) {
    if (imagesList === null) {
      return [];
    }
    if (!Array.isArray(imagesList)) {
      throw new BadRequestException('Invalid media list.');
    }
    if (
      imagesList.some(
        (item) =>
          !item ||
          typeof item !== 'object' ||
          (!item.path && (typeof item.id !== 'string' || !item.id))
      )
    ) {
      throw new BadRequestException('Invalid media attachment.');
    }

    try {
      let imageUpdateNeeded = false;
      const getImageList = await Promise.all(
        (
          await Promise.all(
            (imagesList || []).map(async (p: any) => {
              if (!p.path && p.id) {
                imageUpdateNeeded = true;
                const stored = await this._mediaService.getMediaById(p.id);
                if (!stored) {
                  throw new BadRequestException('Invalid media attachment.');
                }
                return stored;
              }

              return p;
            })
          )
        )
          .map((media) => {
            if (
              typeof media?.path !== 'string' ||
              !media.path ||
              !mediaPathValidator.validate(
                media.path,
                mediaValidationArguments
              ) ||
              !mediaExtensionValidator.validate(
                media.path,
                mediaValidationArguments
              )
            ) {
              throw new BadRequestException('Invalid media attachment.');
            }
            return media;
          })
          .map((m) => {
            const isRemote = /^https?:\/\//i.test(m.path);
            const localFile = isRemote
              ? resolveAppOwnedLocalUploadFilePath(m.path)
              : resolveLocalUploadFilePath(m.path);
            if (!isRemote && !localFile) {
              throw new BadRequestException('Invalid media attachment.');
            }
            return {
              ...m,
              localFile,
              url: !isRemote
                ? process.env.FRONTEND_URL +
                  '/' +
                  process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY +
                  m.path
                : m.path,
              type: hasExtension(m.path, 'mp4') ? 'video' : 'image',
              path: !isRemote ? localFile : m.path,
            };
          })
          .map(async ({ localFile, ...m }) => {
            if (!convertToJPEG) {
              return m;
            }

            if (m.type === 'image' && hasExtension(m.path, 'png')) {
              imageUpdateNeeded = true;
              const imageBuffer = localFile
                ? await readOrFetch(localFile)
                : await fetchRemoteBuffer(m.url, {
                    maxBytes: SAFE_REMOTE_IMAGE_FETCH_MAX_BYTES,
                    bodyTimeoutMs: SAFE_REMOTE_IMAGE_FETCH_BODY_TIMEOUT_MS,
                  });

              // Use sharp to get the metadata of the image
              const buffer = await sharp(imageBuffer)
                .jpeg({ quality: 100 })
                .toBuffer();

              const { path, originalname } = await this.storage.uploadFile({
                buffer,
                mimetype: 'image/jpeg',
                size: buffer.length,
                path: '',
                fieldname: '',
                destination: '',
                stream: new Readable(),
                filename: '',
                originalname: '',
                encoding: '',
              });

              const converted = {
                ...m,
                name: originalname,
                url:
                  path.indexOf('http') === -1
                    ? process.env.FRONTEND_URL +
                      '/' +
                      process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY +
                      path
                    : path,
                type: 'image',
                path:
                  path.indexOf('http') === -1
                    ? process.env.UPLOAD_DIRECTORY + path
                    : path,
              };
              if (
                !mediaPathValidator.validate(
                  converted.path,
                  mediaValidationArguments
                ) ||
                !mediaExtensionValidator.validate(
                  converted.path,
                  mediaValidationArguments
                )
              ) {
                throw new BadRequestException('Invalid media attachment.');
              }
              return converted;
            }

            return m;
          })
      );

      if (imageUpdateNeeded) {
        await this._postRepository.updateImages(
          id,
          JSON.stringify(getImageList)
        );
      }

      return getImageList;
    } catch (err: any) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      throw new Error('Unable to prepare media safely.');
    }
  }

  async getPostGroupDebugExport(orgId: string, group: string) {
    const loadAll = await this._postRepository.getPostsByGroup(orgId, group);
    const errors = await this._postRepository.getErrorsByPostIds(
      loadAll.map((p) => p.id)
    );
    const posts = this.arrangePostsByGroup(loadAll, undefined);
    const rootPost = posts[0] as any;

    return {
      type: 'draft' as const,
      shortLink: false,
      date: rootPost.publishDate.toISOString(),
      tags:
        rootPost.tags?.map((t: any) => ({
          value: t.tag.id,
          label: t.tag.name,
        })) || [],
      posts: [
        {
          integration: { id: 'REPLACE_WITH_LOCAL_INTEGRATION_ID' },
          group: rootPost.group,
          settings: JSON.parse(rootPost.settings || '{}'),
          value: posts.map((post) => ({
            content: post.content,
            image: JSON.parse(post.image || '[]'),
            delay: post.delay || 0,
          })),
        },
      ],
      _debug: {
        providerIdentifier: rootPost.integration?.providerIdentifier,
        providerName: rootPost.integration?.name,
        state: rootPost.state,
        error: rootPost.error,
        errors: errors.map((e) => ({
          message: e.message,
          platform: e.platform,
          body: e.body,
          createdAt: e.createdAt,
        })),
        originalGroup: group,
        originalPublishDate: rootPost.publishDate,
        exportedAt: new Date().toISOString(),
      },
    };
  }

  async getPostsByGroup(orgId: string, group: string) {
    const convertToJPEG = false;
    const loadAll = await this._postRepository.getPostsByGroup(orgId, group);
    const posts = this.arrangePostsByGroup(loadAll, undefined);

    return {
      group: posts?.[0]?.group,
      posts: await Promise.all(
        (posts || []).map(async (post) => ({
          ...post,
          image: await this.updateMedia(
            post.id,
            JSON.parse(post.image || '[]'),
            convertToJPEG
          ),
        }))
      ),
      integrationPicture: posts[0]?.integration?.picture,
      integration: posts[0].integrationId,
      settings: JSON.parse(posts[0].settings || '{}'),
    };
  }

  arrangePostsByGroup(all: any, parent?: string): PostWithConditionals[] {
    const findAll = all
      .filter((p: any) =>
        !parent ? !p.parentPostId : p.parentPostId === parent
      )
      .map(({ integration, ...all }: any) => ({
        ...all,
        ...(!parent ? { integration } : {}),
      }));

    return [
      ...findAll,
      ...(findAll.length
        ? findAll.flatMap((p: any) => this.arrangePostsByGroup(all, p.id))
        : []),
    ];
  }

  async getPost(orgId: string, id: string, convertToJPEG = false) {
    const posts = await this.getPostsRecursively(id, true, orgId, true);
    const list = {
      group: posts?.[0]?.group,
      posts: await Promise.all(
        (posts || []).map(async (post) => ({
          ...post,
          image: await this.updateMedia(
            post.id,
            JSON.parse(post.image || '[]'),
            convertToJPEG
          ),
        }))
      ),
      integrationPicture: posts[0]?.integration?.picture,
      integration: posts[0].integrationId,
      settings: JSON.parse(posts[0].settings || '{}'),
    };

    return list;
  }

  async getOldPosts(orgId: string, date: string) {
    return this._postRepository.getOldPosts(orgId, date);
  }

  public async updateTags(orgId: string, post: Post[]): Promise<Post[]> {
    const plainText = JSON.stringify(post);
    const extract = Array.from(
      plainText.match(/\(post:[a-zA-Z0-9-_]+\)/g) || []
    );
    if (!extract.length) {
      return post;
    }

    const ids = (extract || []).map((e) =>
      e.replace('(post:', '').replace(')', '')
    );
    const urls = await this._postRepository.getPostUrls(orgId, ids);
    const newPlainText = ids.reduce((acc, value) => {
      const findUrl = urls?.find?.((u) => u.id === value)?.releaseURL || '';
      return acc.replace(
        new RegExp(`\\(post:${value}\\)`, 'g'),
        findUrl.split(',')[0]
      );
    }, plainText);

    return this.updateTags(orgId, JSON.parse(newPlainText) as Post[]);
  }

  public async checkInternalPlug(
    integration: Integration,
    orgId: string,
    id: string,
    settings: any
  ) {
    const plugs = Object.entries(settings).filter(([key]) => {
      return key.indexOf('plug-') > -1;
    });

    if (plugs.length === 0) {
      return [];
    }

    const parsePlugs = plugs.reduce((all, [key, value]) => {
      const [_, name, identifier] = key.split('--');
      all[name] = all[name] || { name };
      all[name][identifier] = value;
      return all;
    }, {} as any);

    const list: {
      name: string;
      integrations: { id: string }[];
      delay: string;
      active: boolean;
    }[] = Object.values(parsePlugs);

    return (list || []).flatMap((trigger) => {
      return (trigger?.integrations || []).flatMap((int) => ({
        type: 'internal-plug',
        post: id,
        originalIntegration: integration.id,
        integration: int.id,
        plugName: trigger.name,
        orgId: orgId,
        delay: +trigger.delay,
        information: trigger,
      }));
    });
  }

  public async checkPlugs(
    orgId: string,
    providerName: string,
    integrationId: string
  ) {
    const loadAllPlugs = this._integrationManager.getAllPlugs();
    const getPlugs = await this._integrationService.getPlugs(
      orgId,
      integrationId
    );

    const currentPlug = loadAllPlugs.find((p) => p.identifier === providerName);

    return getPlugs
      .filter((plug) => {
        return currentPlug?.plugs?.some(
          (p: any) => p.methodName === plug.plugFunction
        );
      })
      .map((plug) => {
        const runPlug = currentPlug?.plugs?.find(
          (p: any) => p.methodName === plug.plugFunction
        )!;
        return {
          type: 'global',
          plugId: plug.id,
          delay: runPlug.runEveryMilliseconds,
          totalRuns: runPlug.totalRuns,
        };
      });
  }

  async deletePost(orgId: string, group: string) {
    const post = await this._postRepository.deletePost(orgId, group);

    if (post?.id) {
      try {
        const workflows = this._temporalService.client
          .getRawClient()
          ?.workflow.list({
            query: `postId="${post.id}" AND ExecutionStatus="Running"`,
          });

        for await (const executionInfo of workflows) {
          try {
            const workflow =
              await this._temporalService.client.getWorkflowHandle(
                executionInfo.workflowId
              );
            if (
              workflow &&
              (await workflow.describe()).status.name !== 'TERMINATED'
            ) {
              await workflow.terminate();
            }
          } catch (err) {}
        }
      } catch (err) {}
    }

    return { error: true };
  }

  async countPostsFromDay(orgId: string, date: Date) {
    return this._postRepository.countPostsFromDay(orgId, date);
  }

  getPostByForWebhookId(id: string) {
    return this._postRepository.getPostByForWebhookId(id);
  }

  async startWorkflow(
    taskQueue: string,
    postId: string,
    orgId: string,
    state: State
  ) {
    try {
      const workflows = this._temporalService.client
        .getRawClient()
        ?.workflow.list({
          query: `postId="${postId}" AND ExecutionStatus="Running"`,
        });

      for await (const executionInfo of workflows) {
        try {
          const workflow = await this._temporalService.client.getWorkflowHandle(
            executionInfo.workflowId
          );
          if (
            workflow &&
            (await workflow.describe()).status.name !== 'TERMINATED'
          ) {
            await workflow.terminate();
          }
        } catch (err) {}
      }
    } catch (err) {}

    if (state === 'DRAFT') {
      return;
    }

    try {
      await this._temporalService.client
        .getRawClient()
        ?.workflow.start('postWorkflowV105', {
          workflowId: `post_${postId}`,
          taskQueue: 'main',
          workflowIdConflictPolicy: 'TERMINATE_EXISTING',
          args: [
            {
              taskQueue: taskQueue,
              postId: postId,
              organizationId: orgId,
            },
          ],
          typedSearchAttributes: new TypedSearchAttributes([
            {
              key: postIdSearchParam,
              value: postId,
            },
            {
              key: organizationId,
              value: orgId,
            },
          ]),
        });
    } catch (err) {}
  }

  /**
   * Server-side validation that used to live on the client (`checkValidity` +
   * the manage modal loop). Runs the provider's settings DTO validation, the
   * provider `checkValidity` (media rules) and the empty-content / too-long
   * character checks. Returns one result per post so the frontend can show the
   * same toasts it did before — and so `/posts` can refuse to create invalid
   * posts.
   */
  async validatePosts(
    orgId: string,
    posts: Array<{
      integration: { id: string };
      value: Array<{
        content?: string;
        image?: Array<{
          id?: string;
          path: string;
          thumbnail?: string;
          type?: 'image' | 'video' | string;
        }>;
      }>;
      settings?: any;
    }>,
    options: { v2Only?: boolean } = {}
  ) {
    return Promise.all(
      (posts || []).map(async (post) => {
        const integration = await this._integrationService.getIntegrationById(
          orgId,
          post?.integration?.id
        );

        if (!integration) {
          throw new BadRequestException(
            `Integration with id ${post?.integration?.id} not found`
          );
        }

        const provider = this._integrationManager.getSocialIntegration(
          integration.providerIdentifier
        );

        let additionalSettings: any[] = [];
        try {
          additionalSettings = JSON.parse(
            integration.additionalSettings || '[]'
          );
        } catch {
          additionalSettings = [];
        }

        const settings = post.settings || {};
        const media = (post.value || []).map((p) => p.image || []);

        // Settings DTO validation — mirrors the client `form.trigger()`.
        let valid = true;
        let settingsError = '';
        if (!options.v2Only && provider?.dto) {
          const instance = plainToInstance(provider.dto, settings, {
            enableImplicitConversion: false,
          });
          const validationErrors = await validate(instance as object, {
            skipMissingProperties: false,
          });
          settingsError = this.firstValidationError(validationErrors);
          valid = validationErrors.length === 0;
        }

        // Provider-specific media validation (the old client `checkValidity`).
        let errors: string | true = true;
        if (!options.v2Only) {
          try {
            errors = await provider.checkValidity(
              media,
              settings,
              additionalSettings
            );
          } catch (err: any) {
            errors = err?.message || 'Invalid media';
          }
        }

        const contentAnalyses = await Promise.all(
          (post.value || []).map(async (item) => {
            const resolvedMedia = await this.validationMedia(item.image || []);
            const resolvedCapabilities =
              await this._integrationManager.resolveCapabilitiesV2({
                providerName: integration.providerIdentifier,
                settings,
                media: resolvedMedia,
                integration,
              });
            const capabilities = this.withLegacyBridgeMaximum(
              resolvedCapabilities,
              integration.providerIdentifier,
              additionalSettings
            );
            const analysis = analyzePlatformContentV2({
              canonicalHtml: item.content || '',
              settings,
              media: resolvedMedia,
              capability: capabilities,
              convertMentionFunction: provider.mentionFormat,
            });
            const legacyAnalysis =
              capabilities.verification === 'unverified-adapter'
                ? analyzePlatformContent({
                    content: item.content || '',
                    media: resolvedMedia,
                    capabilities: this._integrationManager.getCapabilities(
                      integration.providerIdentifier,
                      additionalSettings
                    ),
                  })
                : undefined;

            return {
              analysis,
              capabilities,
              legacyMessages: legacyAnalysis?.messages || [],
              media: resolvedMedia,
            };
          })
        );
        const contentMessages = contentAnalyses.flatMap(
          ({ analysis, legacyMessages }) => [
            ...analysis.diagnostics,
            ...legacyMessages,
          ]
        );
        const contentError =
          contentAnalyses
            .flatMap(({ analysis }) => analysis.diagnostics)
            .find((item) => item.severity === 'error')?.message ||
          contentAnalyses
            .flatMap(({ legacyMessages }) => legacyMessages)
            .find((item) => item.severity === 'error')?.text ||
          '';
        const emptyContent = contentAnalyses.some(
          ({ analysis, capabilities, media: resolvedMedia }) =>
            resolvedMedia.length === 0 &&
            capabilities.fields.every((field) => {
              const normalized = analysis.fields[field.key];
              return (
                !normalized ||
                normalizedFieldMeasurementValue(normalized.value, field).trim()
                  .length === 0
              );
            })
        );
        const tooLong = contentAnalyses.some(
          ({ analysis, capabilities }) =>
            capabilities.verification === 'unverified-adapter' &&
            analysis.diagnostics.some((item) => item.code === 'text-too-long')
        );
        const maximumCharacters =
          contentAnalyses[0]?.capabilities.fields.find(
            ({ source, limit }) => source === 'canonical-editor' && !!limit
          )?.limit?.max || provider.maxLength(additionalSettings);

        return {
          id: integration.id,
          identifier: integration.providerIdentifier,
          name: integration.name,
          valid,
          settingsError,
          errors,
          emptyContent,
          tooLong,
          maximumCharacters,
          contentMessages,
          contentError,
        };
      })
    );
  }

  /** Returns the first class-validator message (incl. nested children), or ''. */
  private firstValidationError(errors: any[]): string {
    for (const e of errors || []) {
      if (e?.constraints) {
        return Object.values(e.constraints as Record<string, string>)[0] || '';
      }
      const child = e?.children?.length
        ? this.firstValidationError(e.children)
        : '';
      if (child) {
        return child;
      }
    }
    return '';
  }

  private async validationMedia(
    media: Array<{ id?: string; path?: string; type?: string }>
  ): Promise<Array<{ type: 'image' | 'video' }>> {
    if (!Array.isArray(media)) {
      throw new BadRequestException('Invalid media list.');
    }

    try {
      return await Promise.all(
        media.map(async (item) => {
          if (!item || typeof item !== 'object') {
            throw new BadRequestException('Invalid media attachment.');
          }
          const stored =
            !item.path &&
            item.id &&
            typeof (this._mediaService as any)?.getMediaById === 'function'
              ? await this._mediaService.getMediaById(item.id)
              : undefined;
          const trusted = stored || item;
          if (
            typeof trusted?.path !== 'string' ||
            !trusted.path ||
            !mediaPathValidator.validate(
              trusted.path,
              mediaValidationArguments
            ) ||
            !mediaExtensionValidator.validate(
              trusted.path,
              mediaValidationArguments
            )
          ) {
            throw new BadRequestException('Invalid media attachment.');
          }
          return {
            type: hasExtension(trusted.path, 'mp4')
              ? ('video' as const)
              : ('image' as const),
          };
        })
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Invalid media attachment.');
    }
  }

  private withLegacyBridgeMaximum(
    capabilities: ResolvedPlatformCapabilityV2,
    providerIdentifier: string,
    additionalSettings: unknown
  ): ResolvedPlatformCapabilityV2 {
    if (capabilities.verification !== 'unverified-adapter') {
      return capabilities;
    }

    const maximum = this._integrationManager.getCapabilities(
      providerIdentifier,
      additionalSettings
    ).text.max;
    return {
      ...capabilities,
      fields: capabilities.fields.map((field) =>
        field.source === 'canonical-editor' && field.limit
          ? { ...field, limit: { ...field.limit, max: maximum } }
          : field
      ),
    };
  }

  async createPost(
    orgId: string,
    body: CreatePostDto,
    creationMethod: CreationMethod
  ): Promise<any[]> {
    const preparedPosts = await Promise.all(
      body.posts.map(async (post) => {
        const provider = this._integrationManager.getSocialIntegration(
          (post.settings as any)?.__type
        );
        const removeLinks = !!provider?.stripLinks?.();
        const messages = (post.value || []).map((item) => item.content);
        const updateContent =
          !body.shortLink || removeLinks
            ? messages
            : await this._shortLinkService.convertTextToShortLinks(
                orgId,
                messages
              );

        return {
          ...post,
          value: (post.value || []).map((item, index) => ({
            ...item,
            content: updateContent[index],
          })),
        };
      })
    );

    const finalValidation = await this.validatePosts(orgId, preparedPosts, {
      v2Only: true,
    });
    const finalFailure = selectPostValidationFailure(
      finalValidation,
      body.type === 'draft'
    );
    if (finalFailure) {
      throw new BadRequestException(this.validationError(finalFailure));
    }

    const postList = [];
    for (const post of preparedPosts) {
      const { posts } = await this._postRepository.createOrUpdatePost(
        body.type,
        orgId,
        body.type === 'now' ? dayjs().format('YYYY-MM-DDTHH:mm:00') : body.date,
        post,
        body.tags,
        creationMethod,
        body.inter
      );

      if (!posts?.length) {
        return [] as any[];
      }

      if (body.type !== 'update') {
        this.startWorkflow(
          post.settings.__type.split('-')[0].toLowerCase(),
          posts[0].id,
          orgId,
          posts[0].state
        ).catch((err) => {});
      }

      Sentry.metrics.count('post_created', 1);
      postList.push({
        postId: posts[0].id,
        integration: post.integration.id,
      });
    }

    return postList;
  }

  async separatePosts(content: string, len: number) {
    return this._openaiService.separatePosts(content, len);
  }

  async changeState(id: string, state: State, err?: any, body?: any) {
    return this._postRepository.changeState(id, state, err, body);
  }

  async changePostStatus(
    orgId: string,
    id: string,
    status: 'draft' | 'schedule'
  ) {
    const getPostById = await this._postRepository.getPostById(id, orgId);
    if (!getPostById) {
      throw new BadRequestException('Post not found');
    }

    if (status === 'schedule' && getPostById.state === 'DRAFT') {
      const persistedGroup = await this._postRepository.getPostsByGroup(
        orgId,
        getPostById.group
      );
      const validationPosts = this.persistedValidationThread(
        persistedGroup,
        getPostById
      );
      const rootPost = validationPosts[0];
      const validation = await this.validatePosts(orgId, [
        {
          integration: { id: rootPost.integrationId },
          settings: this.parsePersistedJson(rootPost.settings, {}),
          value: validationPosts.map((post) => ({
            content: post.content,
            image: this.parsePersistedJson(post.image, []),
            delay: post.delay || 0,
          })),
        },
      ]);
      const failure = selectPostValidationFailure(validation, false);
      if (failure) {
        throw new BadRequestException(this.validationError(failure));
      }
    }

    const state: State = status === 'draft' ? 'DRAFT' : 'QUEUE';
    await this._postRepository.changeState(id, state);

    try {
      await this.startWorkflow(
        getPostById.integration.providerIdentifier.split('-')[0].toLowerCase(),
        getPostById.id,
        orgId,
        state
      );
    } catch (err) {}

    return { id, state };
  }

  private parsePersistedJson<T>(value: string | null, fallback: T): T {
    try {
      return JSON.parse(value || '') as T;
    } catch {
      return fallback;
    }
  }

  private persistedValidationThread(groupPosts: any[], requestedPost: any) {
    const integrationPosts = groupPosts.filter(
      (post) => post.integrationId === requestedPost.integrationId
    );
    const postsById = new Map(
      integrationPosts.map((post) => [post.id, post] as const)
    );
    let rootPost = postsById.get(requestedPost.id) || requestedPost;
    const ancestorIds = new Set<string>();

    while (rootPost.parentPostId && !ancestorIds.has(rootPost.id)) {
      ancestorIds.add(rootPost.id);
      const parent = postsById.get(rootPost.parentPostId);
      if (!parent) {
        break;
      }
      rootPost = parent;
    }

    const orderedPosts: any[] = [];
    const appendedIds = new Set<string>();
    const appendThread = (post: any) => {
      if (appendedIds.has(post.id)) {
        return;
      }
      appendedIds.add(post.id);
      orderedPosts.push(post);
      integrationPosts
        .filter((candidate) => candidate.parentPostId === post.id)
        .forEach(appendThread);
    };
    appendThread(rootPost);

    return orderedPosts;
  }

  private validationError(failure: PostValidationFailure) {
    switch (failure.category) {
      case 'empty-content':
        return 'Your post should have at least one character or one image.';
      case 'invalid-settings':
        return failure.item.settingsError || 'Please fix your settings';
      case 'provider-validity':
        return failure.item.errors as string;
      case 'too-long':
        return 'post is too long, please fix it';
      case 'content-error':
        return failure.item.contentError!;
    }
  }

  async changeDate(
    orgId: string,
    id: string,
    date: string,
    action: 'schedule' | 'update' = 'schedule'
  ) {
    const getPostById = await this._postRepository.getPostById(id, orgId);

    // schedule: Set status to QUEUE and change date (reschedule the post)
    // update: Just change the date without changing the status
    const newDate = await this._postRepository.changeDate(
      orgId,
      id,
      date,
      getPostById.state === 'DRAFT',
      action
    );

    if (action === 'schedule') {
      try {
        await this.startWorkflow(
          getPostById.integration.providerIdentifier
            .split('-')[0]
            .toLowerCase(),
          getPostById.id,
          orgId,
          getPostById.state === 'DRAFT' ? 'DRAFT' : 'QUEUE'
        );
      } catch (err) {}
    }

    return newDate;
  }

  async generatePostsDraft(orgId: string, body: CreateGeneratedPostsDto) {
    const getAllIntegrations = (
      await this._integrationService.getIntegrationsList(orgId)
    ).filter((f) => !f.disabled && f.providerIdentifier !== 'reddit');

    // const posts = chunk(body.posts, getAllIntegrations.length);
    const allDates = dayjs()
      .isoWeek(body.week)
      .year(body.year)
      .startOf('isoWeek');

    const dates = [...new Array(7)].map((_, i) => {
      return allDates.add(i, 'day').format('YYYY-MM-DD');
    });

    const findTime = (): string => {
      const totalMinutes = Math.floor(Math.random() * 144) * 10;

      // Convert total minutes to hours and minutes
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;

      // Format hours and minutes to always be two digits
      const formattedHours = hours.toString().padStart(2, '0');
      const formattedMinutes = minutes.toString().padStart(2, '0');
      const randomDate =
        shuffle(dates)[0] + 'T' + `${formattedHours}:${formattedMinutes}:00`;

      if (dayjs(randomDate).isBefore(dayjs())) {
        return findTime();
      }

      return randomDate;
    };

    for (const integration of getAllIntegrations) {
      for (const toPost of body.posts) {
        const group = makeId(10);
        const randomDate = findTime();

        await this.createPost(
          orgId,
          {
            type: 'draft',
            date: randomDate,
            order: '',
            shortLink: false,
            tags: [],
            posts: [
              {
                group,
                integration: {
                  id: integration.id,
                },
                settings: {
                  __type: integration.providerIdentifier as any,
                  title: '',
                  tags: [],
                  subreddit: [],
                },
                value: [
                  ...toPost.list.map((l) => ({
                    id: '',
                    content: l.post,
                    delay: 0,
                    image: [],
                  })),
                  {
                    id: '',
                    delay: 0,
                    content: `Check out the full story here:\n${
                      body.postId || body.url
                    }`,
                    image: [],
                  },
                ],
              },
            ],
          },
          'WEB'
        );
      }
    }
  }

  findAllExistingCategories() {
    return this._postRepository.findAllExistingCategories();
  }

  findAllExistingTopicsOfCategory(category: string) {
    return this._postRepository.findAllExistingTopicsOfCategory(category);
  }

  findPopularPosts(category: string, topic?: string) {
    return this._postRepository.findPopularPosts(category, topic);
  }

  async findFreeDateTime(orgId: string, integrationId?: string) {
    const findTimes = await this._integrationService.findFreeDateTime(
      orgId,
      integrationId
    );
    return this.findFreeDateTimeRecursive(
      orgId,
      findTimes,
      dayjs.utc().startOf('day')
    );
  }

  async createPopularPosts(post: {
    category: string;
    topic: string;
    content: string;
    hook: string;
  }) {
    return this._postRepository.createPopularPosts(post);
  }

  private async findFreeDateTimeRecursive(
    orgId: string,
    times: number[],
    date: dayjs.Dayjs
  ): Promise<string> {
    const list = await this._postRepository.getPostsCountsByDates(
      orgId,
      times,
      date
    );

    if (!list.length) {
      return this.findFreeDateTimeRecursive(orgId, times, date.add(1, 'day'));
    }

    const num = list.reduce<null | number>((prev, curr) => {
      if (prev === null || prev > curr) {
        return curr;
      }
      return prev;
    }, null) as number;

    return date.clone().add(num, 'minutes').format('YYYY-MM-DDTHH:mm:00');
  }

  getComments(postId: string) {
    return this._postRepository.getComments(postId);
  }

  getTags(orgId: string) {
    return this._postRepository.getTags(orgId);
  }

  createTag(orgId: string, body: CreateTagDto) {
    return this._postRepository.createTag(orgId, body);
  }

  editTag(id: string, orgId: string, body: CreateTagDto) {
    return this._postRepository.editTag(id, orgId, body);
  }

  deleteTag(id: string, orgId: string) {
    return this._postRepository.deleteTag(id, orgId);
  }

  createComment(
    orgId: string,
    userId: string,
    postId: string,
    comment: string
  ) {
    return this._postRepository.createComment(orgId, userId, postId, comment);
  }
}
