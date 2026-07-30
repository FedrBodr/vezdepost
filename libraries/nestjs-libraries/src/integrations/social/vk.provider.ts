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
import { unwrapVkResponse } from './vk.response';

export class VkProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 2; // VK has moderate API limits
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

  async refreshToken(refresh: string): Promise<AuthTokenDetails> {
    const [oldRefreshToken, device_id] = refresh.split('&&&&');
    const formData = new FormData();
    formData.append('grant_type', 'refresh_token');
    formData.append('refresh_token', oldRefreshToken);
    formData.append('client_id', process.env.VK_ID!);
    formData.append('device_id', device_id);
    formData.append('state', makeId(32));
    formData.append('scope', this.scopes.join(' '));

    const { access_token, refresh_token, expires_in } = this.unwrapPayload<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
    }>(
      await (
        await this.fetch('https://id.vk.com/oauth2/auth', {
          method: 'POST',
          body: formData,
        })
      ).json(),
      'oauth2/auth'
    );

    const newFormData = new FormData();
    newFormData.append('client_id', process.env.VK_ID!);
    newFormData.append('access_token', access_token);

    const {
      user: { user_id, first_name, last_name, avatar },
    } = this.unwrapPayload<{
      user: {
        user_id: string;
        first_name: string;
        last_name: string;
        avatar?: string;
      };
    }>(
      await (
        await this.fetch('https://id.vk.com/oauth2/user_info', {
          method: 'POST',
          body: newFormData,
        })
      ).json(),
      'oauth2/user_info'
    );

    return {
      id: user_id,
      name: first_name + ' ' + last_name,
      accessToken: access_token,
      refreshToken: refresh_token + '&&&&' + device_id,
      expiresIn: dayjs().add(expires_in, 'seconds').unix() - dayjs().unix(),
      picture: avatar || '',
      username: first_name.toLowerCase(),
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
    const [code, device_id] = params.code.split('&&&&');

    const formData = new FormData();
    formData.append('client_id', process.env.VK_ID!);
    formData.append('grant_type', 'authorization_code');
    formData.append('code_verifier', params.codeVerifier);
    formData.append('device_id', device_id);
    formData.append('code', code);
    formData.append(
      'redirect_uri',
      `${
        process?.env.FRONTEND_URL?.indexOf('https') == -1
          ? `https://redirectmeto.com/${process?.env.FRONTEND_URL}`
          : `${process?.env.FRONTEND_URL}`
      }/integrations/social/${this.identifier}`
    );

    const { access_token, scope, refresh_token, expires_in } =
      this.unwrapPayload<{
        access_token: string;
        scope?: string;
        refresh_token: string;
        expires_in: number;
      }>(
        await (
          await this.fetch('https://id.vk.com/oauth2/auth', {
            method: 'POST',
            body: formData,
          })
        ).json(),
        'oauth2/auth'
      );

    const newFormData = new FormData();
    newFormData.append('client_id', process.env.VK_ID!);
    newFormData.append('access_token', access_token);

    const {
      user: { user_id, first_name, last_name, avatar },
    } = this.unwrapPayload<{
      user: {
        user_id: string;
        first_name: string;
        last_name: string;
        avatar?: string;
      };
    }>(
      await (
        await this.fetch('https://id.vk.com/oauth2/user_info', {
          method: 'POST',
          body: newFormData,
        })
      ).json(),
      'oauth2/user_info'
    );

    return {
      id: user_id,
      name: first_name + ' ' + last_name,
      accessToken: access_token,
      refreshToken: refresh_token + '&&&&' + device_id,
      expiresIn: dayjs().add(expires_in, 'seconds').unix() - dayjs().unix(),
      picture: avatar || '',
      username: first_name.toLowerCase(),
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
    const publishedPostId = String(wallPost.post_id ?? '').trim();
    if (!publishedPostId) {
      throw new BadBody(
        'vk',
        '{}',
        {} as BodyInit,
        'VK wall.post returned no post ID'
      );
    }

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
    const publishedCommentId = String(wallComment.comment_id ?? '').trim();
    if (!publishedCommentId) {
      throw new BadBody(
        'vk',
        '{}',
        {} as BodyInit,
        'VK wall.createComment returned no comment ID'
      );
    }

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
