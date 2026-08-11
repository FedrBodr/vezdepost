import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import dayjs from 'dayjs';
import {
  BadBody,
  SocialAbstract,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { createHash, randomBytes } from 'crypto';
import axios from 'axios';
import FormDataNew from 'form-data';
import mime from 'mime-types';
import { Integration } from '@prisma/client';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { parseVkPositiveIntegerId, unwrapVkResponse } from './vk.response';

type VkOAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

type VkUserInfo = {
  id: string;
  firstName: string;
  lastName: string;
  avatar: string;
};

export class VkProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 2; // VK has moderate API limits
  refreshCron = true;
  identifier = 'vk';
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

  private unwrapPayload<T>(payload: unknown, method: string): T {
    if (
      payload &&
      typeof payload === 'object' &&
      ('response' in payload || 'error' in payload)
    ) {
      return unwrapVkResponse<T>(payload, method);
    }

    return unwrapVkResponse<T>({ response: payload }, method);
  }

  private badResponse(method: string, detail: string): never {
    throw new BadBody(
      'vk',
      '{}',
      {} as BodyInit,
      `VK ${method} returned ${detail}`
    );
  }

  private parseDeviceBoundValue(value: unknown, field: string) {
    if (typeof value !== 'string') {
      this.badResponse('oauth2/auth', `invalid ${field} or device ID`);
    }
    const [secret, deviceId] = value.split('&&&&');
    if (!secret.trim() || !deviceId?.trim()) {
      this.badResponse('oauth2/auth', `invalid ${field} or device ID`);
    }
    return { secret, deviceId };
  }

  private parseOAuthTokens(payload: unknown): VkOAuthTokens {
    if (!payload || typeof payload !== 'object') {
      this.badResponse('oauth2/auth', 'invalid token fields');
    }

    const value = payload as Record<string, unknown>;
    if (
      typeof value.access_token !== 'string' ||
      !value.access_token.trim() ||
      typeof value.refresh_token !== 'string' ||
      !value.refresh_token.trim() ||
      typeof value.expires_in !== 'number' ||
      !Number.isFinite(value.expires_in) ||
      !Number.isInteger(value.expires_in) ||
      value.expires_in <= 0
    ) {
      this.badResponse('oauth2/auth', 'invalid token fields');
    }

    return {
      accessToken: value.access_token,
      refreshToken: value.refresh_token,
      expiresIn: value.expires_in,
    };
  }

  private parseUserInfo(payload: unknown): VkUserInfo {
    if (!payload || typeof payload !== 'object') {
      this.badResponse('oauth2/user_info', 'invalid user');
    }

    const user = (payload as Record<string, unknown>).user;
    if (!user || typeof user !== 'object') {
      this.badResponse('oauth2/user_info', 'invalid user');
    }

    const value = user as Record<string, unknown>;
    const id = parseVkPositiveIntegerId(
      value.user_id,
      'oauth2/user_info',
      'user ID'
    );
    if (
      typeof value.first_name !== 'string' ||
      !value.first_name ||
      typeof value.last_name !== 'string' ||
      !value.last_name ||
      (value.avatar !== undefined && typeof value.avatar !== 'string')
    ) {
      this.badResponse('oauth2/user_info', 'invalid user');
    }

    return {
      id,
      firstName: value.first_name,
      lastName: value.last_name,
      avatar: typeof value.avatar === 'string' ? value.avatar : '',
    };
  }

  async refreshToken(refresh: string): Promise<AuthTokenDetails> {
    const { secret: oldRefreshToken, deviceId } = this.parseDeviceBoundValue(
      refresh,
      'refresh token'
    );
    const formData = new FormData();
    formData.append('grant_type', 'refresh_token');
    formData.append('refresh_token', oldRefreshToken);
    formData.append('client_id', process.env.VK_ID!);
    formData.append('device_id', deviceId);
    formData.append('state', makeId(32));
    formData.append('scope', this.scopes.join(' '));

    const tokens = this.parseOAuthTokens(
      this.unwrapPayload<unknown>(
        await (
          await this.fetch('https://id.vk.com/oauth2/auth', {
            method: 'POST',
            body: formData,
          })
        ).json(),
        'oauth2/auth'
      )
    );

    const newFormData = new FormData();
    newFormData.append('client_id', process.env.VK_ID!);
    newFormData.append('access_token', tokens.accessToken);

    const user = this.parseUserInfo(
      this.unwrapPayload<unknown>(
        await (
          await this.fetch('https://id.vk.com/oauth2/user_info', {
            method: 'POST',
            body: newFormData,
          })
        ).json(),
        'oauth2/user_info'
      )
    );

    return {
      id: user.id,
      name: user.firstName + ' ' + user.lastName,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken + '&&&&' + deviceId,
      expiresIn:
        dayjs().add(tokens.expiresIn, 'seconds').unix() - dayjs().unix(),
      picture: user.avatar,
      username: user.firstName.toLowerCase(),
    };
  }

  async generateAuthUrl() {
    const state = makeId(32);
    const codeVerifier = randomBytes(64).toString('base64url');
    const challenge = Buffer.from(
      createHash('sha256').update(codeVerifier).digest()
    )
      .toString('base64')
      .replace(/=*$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    return {
      url:
        'https://id.vk.com/authorize' +
        `?response_type=code` +
        `&client_id=${process.env.VK_ID}` +
        `&code_challenge_method=S256` +
        `&code_challenge=${challenge}` +
        `&redirect_uri=${encodeURIComponent(
          `${
            process?.env.FRONTEND_URL?.indexOf('https') == -1
              ? `https://redirectmeto.com/${process?.env.FRONTEND_URL}`
              : `${process?.env.FRONTEND_URL}`
          }/integrations/social/${this.identifier}`
        )}` +
        `&state=${state}` +
        `&scope=${encodeURIComponent(this.scopes.join(' '))}`,
      codeVerifier,
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const { secret: code, deviceId } = this.parseDeviceBoundValue(
      params.code,
      'authorization code'
    );

    const formData = new FormData();
    formData.append('client_id', process.env.VK_ID!);
    formData.append('grant_type', 'authorization_code');
    formData.append('code_verifier', params.codeVerifier);
    formData.append('device_id', deviceId);
    formData.append('code', code);
    formData.append(
      'redirect_uri',
      `${
        process?.env.FRONTEND_URL?.indexOf('https') == -1
          ? `https://redirectmeto.com/${process?.env.FRONTEND_URL}`
          : `${process?.env.FRONTEND_URL}`
      }/integrations/social/${this.identifier}`
    );

    const tokens = this.parseOAuthTokens(
      this.unwrapPayload<unknown>(
        await (
          await this.fetch('https://id.vk.com/oauth2/auth', {
            method: 'POST',
            body: formData,
          })
        ).json(),
        'oauth2/auth'
      )
    );

    const newFormData = new FormData();
    newFormData.append('client_id', process.env.VK_ID!);
    newFormData.append('access_token', tokens.accessToken);

    const user = this.parseUserInfo(
      this.unwrapPayload<unknown>(
        await (
          await this.fetch('https://id.vk.com/oauth2/user_info', {
            method: 'POST',
            body: newFormData,
          })
        ).json(),
        'oauth2/user_info'
      )
    );

    return {
      id: user.id,
      name: user.firstName + ' ' + user.lastName,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken + '&&&&' + deviceId,
      expiresIn:
        dayjs().add(tokens.expiresIn, 'seconds').unix() - dayjs().unix(),
      picture: user.avatar,
      username: user.firstName.toLowerCase(),
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
        const upload = unwrapVkResponse<{
          upload_url?: string;
          video_id?: string | number;
        }>(
          await (
            await this.fetch(
              isVideo
                ? `https://api.vk.com/method/video.save?access_token=${accessToken}&v=5.251`
                : `https://api.vk.com/method/photos.getWallUploadServer?owner_id=${userId}&access_token=${accessToken}&v=5.251`
            )
          ).json(),
          method
        );
        if (!upload.upload_url) {
          throw new BadBody(
            'vk',
            '{}',
            {} as BodyInit,
            `VK ${method} returned no upload URL`
          );
        }
        if (
          isVideo &&
          (upload.video_id === undefined || upload.video_id === null)
        ) {
          throw new BadBody(
            'vk',
            '{}',
            {} as BodyInit,
            'VK video.save returned no video ID'
          );
        }

        let data: unknown;
        try {
          ({ data } = await axios.get(media.path!, {
            responseType: 'stream',
          }));
        } catch {
          throw new BadBody(
            'vk',
            '{}',
            {} as BodyInit,
            `VK ${method} media download failed`
          );
        }

        const slash = media.path.split('/').at(-1);

        const formData = new FormDataNew();
        formData.append('photo', data, {
          filename: slash,
          contentType: mime.lookup(slash!) || '',
        });
        let value: { photo: string; server: string | number; hash: string };
        try {
          value = (
            await axios.post(upload.upload_url, formData, {
              headers: {
                ...formData.getHeaders(),
              },
            })
          ).data;
        } catch {
          throw new BadBody(
            'vk',
            '{}',
            {} as BodyInit,
            `VK ${method} media upload failed`
          );
        }

        if (isVideo) {
          return {
            id: String(upload.video_id),
            type: 'video',
          };
        }

        const formSend = new FormData();
        formSend.append('photo', value.photo);
        formSend.append('server', String(value.server));
        formSend.append('hash', value.hash);

        const savedPhoto = unwrapVkResponse<{ id?: string | number }[]>(
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
        const id = savedPhoto[0]?.id;
        if (id === undefined || id === null) {
          throw new BadBody(
            'vk',
            '{}',
            {} as BodyInit,
            'VK photos.saveWallPhoto returned no photo ID'
          );
        }

        return {
          id: String(id),
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
