import {
  AuthTokenDetails,
  FetchPageInformationResult,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  BadBody,
  RefreshToken,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { Integration } from '@prisma/client';
import axios from 'axios';
import FormDataNew from 'form-data';
import mime from 'mime-types';
import {
  authenticateVkUser,
  generateVkAuthUrl,
  refreshVkUser,
} from './vk.oauth';
import type { VkIdentifier } from './vk.oauth';
import {
  VK_GROUP_LEGACY_TOKEN_RECONNECT,
  VK_GROUP_PHOTO_ACCESS_MISSING,
  VK_GROUP_SELECTED_COMMUNITY_NOT_MANAGED,
} from './vk.group.errors';

const TOO_MANY_PHOTOS = 'VK Group supports up to 10 photographs per post.';
const UNSUPPORTED_MEDIA =
  'VK Group supports photographs only. Remove videos and other attachments.';
const isUnsupportedAttachmentPath = (path: string) =>
  /\.(?:mp4|mov|avi|mkv|webm|m4v|pdf|docx?|xlsx?|pptx?|txt|rtf|csv|zip|rar|7z|tar|gz)(?:[?#].*)?$/i.test(
    path || ''
  );

export type VkManagedCommunity = {
  id: string;
  page: string;
  username: string;
  name: string;
  picture: string;
};

export class VkGroupProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 2;
  refreshCron = true;
  identifier: VkIdentifier = 'vk-group';
  name = 'VK Group';
  isBetweenSteps = true;
  scopes = ['vkid.personal_info', 'wall', 'photos', 'groups'];
  editor = 'normal' as const;

  maxLength() {
    return 16384;
  }

  override async checkValidity(
    posts: Array<ValidityMedia[]>
  ): Promise<string | true> {
    const [mainPost = [], ...comments] = posts || [];
    if (comments.some((comment) => comment.length > 0)) {
      return UNSUPPORTED_MEDIA;
    }
    if (mainPost.some((media) => media.type && media.type !== 'image')) {
      return UNSUPPORTED_MEDIA;
    }
    if (mainPost.some((media) => isUnsupportedAttachmentPath(media.path))) {
      return UNSUPPORTED_MEDIA;
    }
    if (mainPost.length > 10) {
      return TOO_MANY_PHOTOS;
    }
    return true;
  }

  async generateAuthUrl() {
    return generateVkAuthUrl({
      identifier: this.identifier,
      scopes: this.scopes,
    });
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

  private async callVk(
    method: string,
    accessToken: string,
    params: Record<string, string> = {}
  ) {
    const body = new FormData();
    body.append('access_token', accessToken);
    body.append('v', '5.251');
    Object.entries(params).forEach(([key, value]) => body.append(key, value));

    return (
      await this.fetch(`https://api.vk.com/method/${method}`, {
        method: 'POST',
        body,
      })
    ).json();
  }

  private badGroupResponse(message: string, code?: number): never {
    throw new BadBody(
      this.identifier,
      code === undefined ? '{}' : JSON.stringify({ code }),
      {} as BodyInit,
      message
    );
  }

  private unwrapGroupResponse<T>(payload: unknown, method: string): T {
    const envelope =
      payload && typeof payload === 'object'
        ? (payload as {
            response?: T;
            error?: { error_code?: unknown } | unknown;
          })
        : {};

    if (envelope.error !== undefined && envelope.error !== null) {
      const rawCode =
        typeof envelope.error === 'object'
          ? (envelope.error as { error_code?: unknown }).error_code
          : undefined;
      const parsedCode = Number(rawCode);
      const code =
        Number.isFinite(parsedCode) && Number.isInteger(parsedCode)
          ? parsedCode
          : 0;
      const message = `VK ${method} failed with error ${code}`;

      if (code === 5) {
        throw new RefreshToken(
          this.identifier,
          JSON.stringify({ code }),
          {} as BodyInit,
          message
        );
      }
      if (code === 27 && method.startsWith('photos.')) {
        this.badGroupResponse(VK_GROUP_LEGACY_TOKEN_RECONNECT, code);
      }
      if (code === 15 && method.startsWith('photos.')) {
        this.badGroupResponse(VK_GROUP_PHOTO_ACCESS_MISSING, code);
      }
      this.badGroupResponse(message, code);
    }

    if (envelope.response === undefined || envelope.response === null) {
      this.badGroupResponse(`VK ${method} returned no response`);
    }
    return envelope.response;
  }

  private parsePositiveId(
    value: unknown,
    method: string,
    field: string
  ): string {
    if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      Number.isInteger(value) &&
      Number.isSafeInteger(value) &&
      value > 0
    ) {
      return String(value);
    }
    if (
      typeof value === 'string' &&
      /^\d+$/.test(value) &&
      /[1-9]/.test(value)
    ) {
      return value;
    }
    this.badGroupResponse(`VK ${method} returned invalid ${field}`);
  }

  private parseSignedId(value: unknown, method: string, field: string): string {
    if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      Number.isInteger(value) &&
      Number.isSafeInteger(value) &&
      value !== 0
    ) {
      return String(value);
    }
    if (
      typeof value === 'string' &&
      /^-?\d+$/.test(value) &&
      /[1-9]/.test(value)
    ) {
      return value;
    }
    this.badGroupResponse(`VK ${method} returned invalid ${field}`);
  }

  private parseHttpsUploadUrl(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
      this.badGroupResponse(
        'VK photos.getWallUploadServer returned an invalid HTTPS upload URL'
      );
    }

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      this.badGroupResponse(
        'VK photos.getWallUploadServer returned an invalid HTTPS upload URL'
      );
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
      this.badGroupResponse(
        'VK photos.getWallUploadServer returned an invalid HTTPS upload URL'
      );
    }
    return value;
  }

  private async callPhotoVk<T>(
    method: 'photos.getWallUploadServer' | 'photos.saveWallPhoto',
    accessToken: string,
    params: Record<string, string>
  ): Promise<T> {
    return this.callGroupVk(method, accessToken, params);
  }

  private async callGroupVk<T>(
    method: string,
    accessToken: string,
    params: Record<string, string> = {}
  ): Promise<T> {
    let payload: unknown;
    try {
      payload = await this.callVk(method, accessToken, params);
    } catch {
      this.badGroupResponse(`VK ${method} request failed`);
    }
    return this.unwrapGroupResponse<T>(payload, method);
  }

  private parsePhotoUploadFields(payload: unknown): {
    photo: string;
    server: string;
    hash: string;
  } {
    if (!payload || typeof payload !== 'object') {
      this.badGroupResponse('VK Group photo upload returned invalid fields');
    }
    const value = payload as Record<string, unknown>;
    if (
      typeof value.photo !== 'string' ||
      !value.photo.trim() ||
      typeof value.hash !== 'string' ||
      !value.hash.trim()
    ) {
      this.badGroupResponse('VK Group photo upload returned invalid fields');
    }

    let server: string;
    try {
      server = this.parsePositiveId(
        value.server,
        'photos.getWallUploadServer',
        'upload server ID'
      );
    } catch {
      this.badGroupResponse('VK Group photo upload returned invalid fields');
    }
    return { photo: value.photo, server, hash: value.hash };
  }

  private async uploadPhoto(
    positiveGroupId: string,
    accessToken: string,
    media: NonNullable<PostDetails['media']>[number]
  ): Promise<{ ownerId: string; id: string }> {
    const uploadServer = await this.callPhotoVk<unknown>(
      'photos.getWallUploadServer',
      accessToken,
      { group_id: positiveGroupId }
    );
    if (!uploadServer || typeof uploadServer !== 'object') {
      this.badGroupResponse(
        'VK photos.getWallUploadServer returned an invalid response'
      );
    }
    const uploadUrl = this.parseHttpsUploadUrl(
      (uploadServer as Record<string, unknown>).upload_url
    );

    let mediaStream: unknown;
    try {
      ({ data: mediaStream } = await axios.get(media.path, {
        responseType: 'stream',
      }));
    } catch {
      this.badGroupResponse('VK Group media download failed');
    }

    let formData: FormDataNew;
    let uploadPayload: unknown;
    try {
      const pathTail = media.path.split('/').at(-1) || 'photo';
      const filename = pathTail.split(/[?#]/)[0] || 'photo';
      formData = new FormDataNew();
      formData.append('photo', mediaStream, {
        filename,
        contentType: mime.lookup(filename) || '',
      });
      uploadPayload = (
        await axios.post(uploadUrl, formData, {
          headers: formData.getHeaders(),
          maxRedirects: 0,
        })
      ).data;
    } catch {
      this.badGroupResponse('VK Group photo upload failed');
    }

    const uploaded = this.parsePhotoUploadFields(uploadPayload);
    const saved = await this.callPhotoVk<unknown>(
      'photos.saveWallPhoto',
      accessToken,
      {
        group_id: positiveGroupId,
        photo: uploaded.photo,
        server: uploaded.server,
        hash: uploaded.hash,
      }
    );
    if (
      !Array.isArray(saved) ||
      saved.length !== 1 ||
      !saved[0] ||
      typeof saved[0] !== 'object'
    ) {
      this.badGroupResponse(
        'VK photos.saveWallPhoto returned an invalid photo response'
      );
    }

    const savedPhoto = saved[0] as Record<string, unknown>;
    const savedOwnerId = this.parseSignedId(
      savedPhoto.owner_id,
      'photos.saveWallPhoto',
      'owner ID'
    );
    return {
      ownerId: savedOwnerId,
      id: this.parsePositiveId(
        savedPhoto.id,
        'photos.saveWallPhoto',
        'photo ID'
      ),
    };
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
      id: `vk-group-oauth:${user.userId}`,
      name: user.name,
      accessToken: user.accessToken,
      refreshToken: user.refreshToken,
      expiresIn: user.expiresIn,
      picture: user.picture,
      username: user.username,
    };
  }

  async pages(accessToken: string): Promise<VkManagedCommunity[]> {
    const response = await this.callGroupVk<unknown>(
      'groups.get',
      accessToken,
      {
        filter: 'admin',
        extended: '1',
        fields: 'photo_200,screen_name',
      }
    );
    if (!response || typeof response !== 'object') {
      this.badGroupResponse('VK groups.get returned invalid communities');
    }

    const items = (response as { items?: unknown }).items;
    if (!Array.isArray(items)) {
      this.badGroupResponse('VK groups.get returned invalid communities');
    }

    return items.map((item) => {
      if (!item || typeof item !== 'object') {
        this.badGroupResponse('VK groups.get returned invalid community');
      }
      const group = item as Record<string, unknown>;
      const id = this.parsePositiveId(group.id, 'groups.get', 'community ID');
      if (typeof group.name !== 'string' || !group.name) {
        this.badGroupResponse('VK groups.get returned invalid community name');
      }
      return {
        id,
        page: id,
        username:
          typeof group.screen_name === 'string' ? group.screen_name : '',
        name: group.name,
        picture: typeof group.photo_200 === 'string' ? group.photo_200 : '',
      };
    });
  }

  async fetchPageInformation(
    accessToken: string,
    data: { page: string }
  ): Promise<FetchPageInformationResult> {
    if (typeof data?.page !== 'string' || !/^[1-9]\d*$/.test(data.page)) {
      this.badGroupResponse(VK_GROUP_SELECTED_COMMUNITY_NOT_MANAGED);
    }

    const group = (await this.pages(accessToken)).find(
      ({ id }) => id === data.page
    );
    if (!group) {
      this.badGroupResponse(VK_GROUP_SELECTED_COMMUNITY_NOT_MANAGED);
    }

    const uploadServer = await this.callPhotoVk<unknown>(
      'photos.getWallUploadServer',
      accessToken,
      { group_id: group.id }
    );
    if (!uploadServer || typeof uploadServer !== 'object') {
      this.badGroupResponse(
        'VK photos.getWallUploadServer returned an invalid response'
      );
    }
    this.parseHttpsUploadUrl(
      (uploadServer as Record<string, unknown>).upload_url
    );

    return {
      id: `-${group.id}`,
      name: group.name,
      access_token: accessToken,
      picture: group.picture,
      username: group.username,
    };
  }

  async post(
    userId: string,
    accessToken: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost, ...comments] = postDetails;
    const mainMedia = firstPost?.media || [];
    if (comments.some((comment) => (comment.media || []).length > 0)) {
      throw new Error(UNSUPPORTED_MEDIA);
    }
    if (
      mainMedia.some(
        (item) =>
          item.type !== 'image' || isUnsupportedAttachmentPath(item.path)
      )
    ) {
      throw new Error(UNSUPPORTED_MEDIA);
    }
    if (mainMedia.length > 10) {
      throw new Error(TOO_MANY_PHOTOS);
    }

    const ownerId = this.parseSignedId(userId, 'wall.post', 'owner ID');
    if (!ownerId.startsWith('-')) {
      this.badGroupResponse('VK wall.post returned invalid community owner ID');
    }
    const positiveGroupId = this.parsePositiveId(
      ownerId.slice(1),
      'wall.post',
      'community ID'
    );
    const photos: Array<{ ownerId: string; id: string }> = [];
    for (const media of mainMedia) {
      photos.push(await this.uploadPhoto(positiveGroupId, accessToken, media));
    }

    let wallPostPayload: unknown;
    try {
      wallPostPayload = await this.callVk('wall.post', accessToken, {
        owner_id: ownerId,
        from_group: '1',
        message: firstPost.message,
        ...(photos.length
          ? {
              attachments: photos
                .map(
                  ({ ownerId: photoOwnerId, id }) =>
                    `photo${photoOwnerId}_${id}`
                )
                .join(','),
            }
          : {}),
      });
    } catch {
      this.badGroupResponse('VK wall.post request failed');
    }
    const wallPostResult = this.unwrapGroupResponse<{
      post_id?: unknown;
    }>(wallPostPayload, 'wall.post');
    const publishedPostId = this.parsePositiveId(
      wallPostResult.post_id,
      'wall.post',
      'post ID'
    );

    return [
      {
        id: firstPost.id,
        postId: publishedPostId,
        releaseURL: `https://vk.com/wall${ownerId}_${publishedPostId}`,
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
    const wallCommentResult = await this.callGroupVk<{
      comment_id?: unknown;
    }>('wall.createComment', accessToken, {
      owner_id: userId,
      from_group: String(Math.abs(Number(userId))),
      message: commentPost.message,
      post_id: postId,
    });

    const publishedCommentId = this.parsePositiveId(
      wallCommentResult.comment_id,
      'wall.createComment',
      'comment ID'
    );

    return [
      {
        id: commentPost.id,
        postId: publishedCommentId,
        releaseURL: `https://vk.com/wall${userId}_${postId}`,
        status: 'completed',
      },
    ];
  }
}
