import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  BadBody,
  SocialAbstract,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import axios from 'axios';
import FormDataNew from 'form-data';
import mime from 'mime-types';
import { Integration } from '@prisma/client';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { withMediaSourceStream } from '@gitroom/helpers/utils/media.source';
import { parseVkPositiveIntegerId, unwrapVkResponse } from './vk.response';
import {
  authenticateVkUser,
  generateVkAuthUrl,
  refreshVkUser,
} from './vk.oauth';
import type { VkIdentifier } from './vk.oauth';

export class VkProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 2; // VK has moderate API limits
  refreshCron = true;
  identifier: VkIdentifier = 'vk';
  name = 'VK';
  isBetweenSteps = false;
  scopes = [
    'vkid.personal_info',
    'email',
    'wall',
    'status',
    'docs',
    'photos',
    'video',
  ];

  editor = 'normal' as const;
  maxLength() {
    return 16384;
  }

  private badResponse(method: string, detail: string): never {
    throw new BadBody(
      'vk',
      '{}',
      {} as BodyInit,
      `VK ${method} returned ${detail}`
    );
  }

  private parseUploadUrl(value: unknown, method: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      this.badResponse(method, 'invalid upload URL');
    }

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      this.badResponse(method, 'invalid upload URL');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      this.badResponse(method, 'invalid upload URL');
    }

    return value;
  }

  private parsePhotoUploadResponse(payload: unknown): {
    photo: string;
    server: string;
    hash: string;
  } {
    if (!payload || typeof payload !== 'object') {
      this.badResponse('photos.getWallUploadServer', 'invalid upload fields');
    }

    const value = payload as Record<string, unknown>;
    if (
      typeof value.photo !== 'string' ||
      !value.photo.trim() ||
      typeof value.hash !== 'string' ||
      !value.hash.trim()
    ) {
      this.badResponse('photos.getWallUploadServer', 'invalid upload fields');
    }

    return {
      photo: value.photo,
      server: parseVkPositiveIntegerId(
        value.server,
        'photos.getWallUploadServer',
        'upload server ID'
      ),
      hash: value.hash,
    };
  }

  async refreshToken(refresh: string): Promise<AuthTokenDetails> {
    const user = await refreshVkUser({
      refresh,
      scopes: this.scopes,
      fetcher: (url, options) => this.fetch(url, options),
    });

    return {
      id: user.userId,
      name: user.name,
      accessToken: user.accessToken,
      refreshToken: user.refreshToken,
      expiresIn: user.expiresIn,
      picture: user.picture,
      username: user.username,
    };
  }

  async generateAuthUrl() {
    return generateVkAuthUrl({
      identifier: this.identifier,
      scopes: this.scopes,
    });
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const user = await authenticateVkUser({
      identifier: this.identifier,
      code: params.code,
      codeVerifier: params.codeVerifier,
      fetcher: (url, options) => this.fetch(url, options),
    });

    return {
      id: user.userId,
      name: user.name,
      accessToken: user.accessToken,
      refreshToken: user.refreshToken,
      expiresIn: user.expiresIn,
      picture: user.picture,
      username: user.username,
    };
  }

  protected async uploadMedia(
    userId: string,
    accessToken: string,
    post: PostDetails
  ): Promise<{ id: string; type: string }[]> {
    return await Promise.all(
      (post?.media || []).map(async (media) => {
        const isVideo = hasExtension(media.path, 'mp4');
        const method = isVideo ? 'video.save' : 'photos.getWallUploadServer';
        const slash = media.path.split('/').at(-1);
        let sourceOpened = false;
        let uploaded: { value: unknown; videoId?: string };
        try {
          uploaded = await withMediaSourceStream(
            media.path,
            {},
            async ({ stream, size }) => {
              sourceOpened = true;
              const upload = unwrapVkResponse<unknown>(
                await (
                  await this.fetch(
                    isVideo
                      ? `https://api.vk.com/method/video.save?access_token=${accessToken}&v=5.251`
                      : `https://api.vk.com/method/photos.getWallUploadServer?owner_id=${userId}&access_token=${accessToken}&v=5.251`
                  )
                ).json(),
                method
              );
              if (!upload || typeof upload !== 'object') {
                this.badResponse(method, 'invalid upload response');
              }
              const uploadResponse = upload as Record<string, unknown>;
              const uploadUrl = this.parseUploadUrl(
                uploadResponse.upload_url,
                method
              );
              const videoId = isVideo
                ? parseVkPositiveIntegerId(
                    uploadResponse.video_id,
                    'video.save',
                    'video ID'
                  )
                : undefined;
              const formData = new FormDataNew();
              formData.append('photo', stream, {
                filename: slash,
                contentType: mime.lookup(slash!) || '',
                knownLength: size,
              });
              try {
                const headers = formData.getHeaders();
                if (size !== undefined) {
                  headers['Content-Length'] = String(formData.getLengthSync());
                }
                const value = (
                  await axios.post(uploadUrl, formData, {
                    headers,
                  })
                ).data;
                return { value, videoId };
              } catch {
                throw new BadBody(
                  'vk',
                  '{}',
                  {} as BodyInit,
                  `VK ${method} media upload failed`
                );
              }
            }
          );
        } catch (error) {
          if (error instanceof BadBody) throw error;
          if (sourceOpened) throw error;
          throw new BadBody(
            'vk',
            '{}',
            {} as BodyInit,
            `VK ${method} media download failed`
          );
        }

        const { value, videoId } = uploaded;
        if (videoId) {
          return {
            id: videoId,
            type: 'video',
          };
        }

        const photoUpload = this.parsePhotoUploadResponse(value);
        const formSend = new FormData();
        formSend.append('photo', photoUpload.photo);
        formSend.append('server', photoUpload.server);
        formSend.append('hash', photoUpload.hash);

        const savedPhoto = unwrapVkResponse<unknown>(
          await (
            await this.fetch(
              `https://api.vk.com/method/photos.saveWallPhoto?access_token=${accessToken}&v=5.251`,
              {
                method: 'POST',
                body: formSend,
              }
            )
          ).json(),
          'photos.saveWallPhoto'
        );
        if (!Array.isArray(savedPhoto)) {
          this.badResponse('photos.saveWallPhoto', 'invalid photo response');
        }
        const photoId = parseVkPositiveIntegerId(
          savedPhoto[0]?.id,
          'photos.saveWallPhoto',
          'photo ID'
        );

        return {
          id: photoId,
          type: 'photo',
        };
      })
    );
  }

  async post(
    userId: string,
    accessToken: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;

    // Upload media for the first post
    const mediaList = await this.uploadMedia(userId, accessToken, firstPost);

    const body = new FormData();
    body.append('message', firstPost.message);

    if (mediaList.length) {
      body.append(
        'attachments',
        mediaList.map((p) => `${p.type}${userId}_${p.id}`).join(',')
      );
    }

    const wallPost = unwrapVkResponse<{ post_id?: number | string }>(
      await (
        await this.fetch(
          `https://api.vk.com/method/wall.post?v=5.251&access_token=${accessToken}&client_id=${process.env.VK_ID}`,
          {
            method: 'POST',
            body,
          }
        )
      ).json(),
      'wall.post'
    );
    const publishedPostId = parseVkPositiveIntegerId(
      wallPost.post_id,
      'wall.post',
      'post ID'
    );

    return [
      {
        id: firstPost.id,
        postId: publishedPostId,
        releaseURL: `https://vk.com/feed?w=wall${userId}_${publishedPostId}`,
        status: 'completed',
      },
    ];
  }

  async comment(
    userId: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;

    // Upload media for the comment
    const mediaList = await this.uploadMedia(userId, accessToken, commentPost);

    const body = new FormData();
    body.append('message', commentPost.message);
    body.append('post_id', postId);

    if (mediaList.length) {
      body.append(
        'attachments',
        mediaList.map((p) => `${p.type}${userId}_${p.id}`).join(',')
      );
    }

    const wallComment = unwrapVkResponse<{ comment_id?: number | string }>(
      await (
        await this.fetch(
          `https://api.vk.com/method/wall.createComment?v=5.251&access_token=${accessToken}&client_id=${process.env.VK_ID}`,
          {
            method: 'POST',
            body,
          }
        )
      ).json(),
      'wall.createComment'
    );
    const publishedCommentId = parseVkPositiveIntegerId(
      wallComment.comment_id,
      'wall.createComment',
      'comment ID'
    );

    return [
      {
        id: commentPost.id,
        postId: publishedCommentId,
        releaseURL: `https://vk.com/feed?w=wall${userId}_${postId}`,
        status: 'completed',
      },
    ];
  }
}
