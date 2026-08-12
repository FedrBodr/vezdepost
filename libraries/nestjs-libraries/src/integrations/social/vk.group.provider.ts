import {
  AuthTokenDetails,
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
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { Integration } from '@prisma/client';
import axios from 'axios';
import dayjs from 'dayjs';
import FormDataNew from 'form-data';
import mime from 'mime-types';

const INVALID_GROUP = 'Enter a valid VK community link or short name.';
const INVALID_TOKEN = 'The VK community token is invalid.';
const WRONG_GROUP = 'This token belongs to a different VK community.';
const MISSING_PERMISSIONS =
  'The VK community key must allow community management, community wall, and photographs access. Recreate the key and reconnect VK Group.';
const TOO_MANY_PHOTOS = 'VK Group supports up to 10 photographs per post.';
const UNSUPPORTED_MEDIA =
  'VK Group supports photographs only. Remove videos and other attachments.';
const PHOTO_ACCESS_MISSING =
  'VK Group photo access is missing. Recreate the community key with photographs access and reconnect VK Group.';

const isUnsupportedAttachmentPath = (path: string) =>
  /\.(?:mp4|mov|avi|mkv|webm|m4v|pdf|docx?|xlsx?|pptx?|txt|rtf|csv|zip|rar|7z|tar|gz)(?:[?#].*)?$/i.test(
    path || ''
  );

type VkGroup = {
  id: number;
  name?: string;
  screen_name?: string;
  photo_200?: string;
};

const extractGroup = (payload: any): VkGroup | undefined =>
  payload?.response?.groups?.[0] ?? payload?.response?.[0];

export function normalizeVkGroupIdentifier(value: string): string | null {
  const input = value?.trim();
  if (!input) {
    return null;
  }

  const explicitScheme = input.match(/^([a-z][a-z\d+.-]*):\/\//i)?.[1];
  if (explicitScheme && explicitScheme.toLowerCase() !== 'https') {
    return null;
  }

  let candidate = input;
  const hostPattern = /^(?:www\.)?vk\.(?:com|ru)$/i;
  const looksLikeVkUrl =
    /^https:\/\//i.test(input) ||
    /^(?:www\.)?vk\.(?:com|ru)(?::\d+)?(?:\/|$)/i.test(input);

  if (looksLikeVkUrl) {
    try {
      const urlInput = /^https:\/\//i.test(input) ? input : `https://${input}`;
      const rawAuthority = urlInput.match(/^https:\/\/([^/?#]+)/i)?.[1];
      if (!rawAuthority || /[@:]/.test(rawAuthority)) {
        return null;
      }
      const url = new URL(urlInput);
      if (
        !hostPattern.test(url.hostname) ||
        url.username ||
        url.password ||
        url.port ||
        !/^\/[^/]+\/?$/.test(url.pathname)
      ) {
        return null;
      }
      candidate = url.pathname.slice(1).replace(/\/$/, '');
    } catch {
      return null;
    }
  } else if (/^https:\/\//i.test(input) || input.includes('/')) {
    return null;
  }

  if (!candidate || candidate.includes('/')) {
    return null;
  }

  const prefixedId = candidate.match(/^(?:club|public)([1-9]\d*)$/i);
  if (prefixedId) {
    return prefixedId[1];
  }

  if (/^(?:club|public)/i.test(candidate)) {
    return null;
  }

  if (/^-?\d+$/.test(candidate)) {
    return /^-?[1-9]\d*$/.test(candidate) ? candidate.replace(/^-/, '') : null;
  }

  return /^[a-zA-Z0-9_.-]+$/.test(candidate) ? candidate : null;
}

export class VkGroupProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 2;
  identifier = 'vk-group';
  name = 'VK Group';
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'normal' as const;
  customFieldsInstructions = {
    collapsible: true,
    summary: 'Where to get the link and key',
    title: 'Connect a VK community',
    items: [
      'Open the community in the desktop VK website and select Management.',
      'Open More → API usage → Access keys.',
      'Select Create key.',
      'Grant only community management, community wall, and photographs access.',
      'Copy the generated community access key into Vezdepost.',
      'Copy the public community address, for example https://vk.ru/fedrbodr_pro, into the first field.',
    ],
    notRequired: 'Callback API and Long Poll API are not required.',
    warning:
      'The access key is secret. Do not send it to support, put it in screenshots, or share it with third parties.',
  };

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

  async customFields() {
    return [
      {
        key: 'group',
        label: 'VK community link',
        placeholder: 'https://vk.ru/fedrbodr_pro',
        placeholderTranslationKey: 'vk_group_community_link_placeholder',
        validation: '/^.{1,255}$/',
        validationMessage: INVALID_GROUP,
        type: 'text' as const,
      },
      {
        key: 'accessToken',
        label: 'Community access key',
        validation: '/^.{10,}$/',
        type: 'password' as const,
      },
    ];
  }

  async generateAuthUrl() {
    const state = makeId(17);
    return { url: state, codeVerifier: makeId(10), state };
  }

  async refreshToken(): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
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
      if (code === 15 && method.startsWith('photos.')) {
        this.badGroupResponse(PHOTO_ACCESS_MISSING, code);
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
    if (!Array.isArray(saved) || !saved[0] || typeof saved[0] !== 'object') {
      this.badGroupResponse(
        'VK photos.saveWallPhoto returned an invalid photo response'
      );
    }

    const savedPhoto = saved[0] as Record<string, unknown>;
    return {
      ownerId: this.parseSignedId(
        savedPhoto.owner_id,
        'photos.saveWallPhoto',
        'owner ID'
      ),
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
    let credentials: { group?: unknown; accessToken?: unknown };
    try {
      credentials = JSON.parse(
        Buffer.from(params.code, 'base64').toString('utf8')
      );
    } catch {
      return INVALID_TOKEN;
    }

    if (typeof credentials.accessToken !== 'string') {
      return INVALID_TOKEN;
    }
    if (typeof credentials.group !== 'string') {
      return INVALID_GROUP;
    }

    const groupIdentifier = normalizeVkGroupIdentifier(credentials.group);
    if (!groupIdentifier) {
      return INVALID_GROUP;
    }

    const accessToken = credentials.accessToken;

    try {
      const requestedPayload = await this.callVk(
        'groups.getById',
        accessToken,
        {
          group_ids: groupIdentifier,
          fields: 'photo_200,screen_name',
        }
      );
      const requestedGroup = extractGroup(requestedPayload);
      if (requestedPayload?.error || !requestedGroup?.id) {
        return INVALID_TOKEN;
      }

      const ownerPayload = await this.callVk('groups.getById', accessToken);
      const tokenGroup = extractGroup(ownerPayload);
      if (ownerPayload?.error || !tokenGroup?.id) {
        return INVALID_TOKEN;
      }
      if (Number(tokenGroup.id) !== Number(requestedGroup.id)) {
        return WRONG_GROUP;
      }

      const permissionsPayload = await this.callVk(
        'groups.getTokenPermissions',
        accessToken
      );
      const permissionNames = (permissionsPayload?.response?.permissions || [])
        .filter((permission: any) => Number(permission?.setting) > 0)
        .map((permission: any) => permission.name)
        .filter(Boolean);
      const requiredPermissions = ['manage', 'wall', 'photos'];

      if (
        permissionsPayload?.error ||
        requiredPermissions.some((name) => !permissionNames.includes(name))
      ) {
        return MISSING_PERMISSIONS;
      }

      return {
        id: String(-Math.abs(Number(requestedGroup.id))),
        name: requestedGroup.name || '',
        accessToken,
        refreshToken: '',
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        picture: requestedGroup.photo_200 || '',
        username: requestedGroup.screen_name || '',
      };
    } catch {
      return INVALID_TOKEN;
    }
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
    const photos = await Promise.all(
      mainMedia.map((media) =>
        this.uploadPhoto(positiveGroupId, accessToken, media)
      )
    );

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
    const wallCommentResult = await this.callVk(
      'wall.createComment',
      accessToken,
      {
        owner_id: userId,
        from_group: String(Math.abs(Number(userId))),
        message: commentPost.message,
        post_id: postId,
      }
    );

    if (wallCommentResult?.error || !wallCommentResult?.response) {
      throw new BadBody(this.identifier, '{}', '{}', 'VK comment failed');
    }
    const publishedCommentId = this.parsePositiveId(
      wallCommentResult.response.comment_id,
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
