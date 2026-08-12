import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  BadBody,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { Integration } from '@prisma/client';
import dayjs from 'dayjs';
import { parseVkPositiveIntegerId } from './vk.response';

const INVALID_GROUP = 'Enter a valid VK community link or short name.';
const INVALID_TOKEN = 'The VK community token is invalid.';
const WRONG_GROUP = 'This token belongs to a different VK community.';
const MISSING_PERMISSIONS =
  'The VK community key must allow community management, community wall, and photographs access. Recreate the key and reconnect VK Group.';
const TOO_MANY_PHOTOS = 'VK Group supports up to 10 photographs per post.';
const UNSUPPORTED_MEDIA =
  'VK Group supports photographs only. Remove videos and other attachments.';

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
    const media = postDetails.flatMap((post) => post.media || []);
    if (media.some((item) => item.type !== 'image')) {
      throw new Error(UNSUPPORTED_MEDIA);
    }
    if (media.length > 10) {
      throw new Error(TOO_MANY_PHOTOS);
    }

    const [firstPost] = postDetails;
    const wallPostResult = await this.callVk('wall.post', accessToken, {
      owner_id: userId,
      from_group: '1',
      message: firstPost.message,
    });

    if (wallPostResult?.error || !wallPostResult?.response) {
      throw new BadBody(this.identifier, '{}', '{}', 'VK post failed');
    }
    const publishedPostId = parseVkPositiveIntegerId(
      wallPostResult.response.post_id,
      'wall.post',
      'post ID'
    );

    return [
      {
        id: firstPost.id,
        postId: publishedPostId,
        releaseURL: `https://vk.com/wall${userId}_${publishedPostId}`,
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
    const publishedCommentId = parseVkPositiveIntegerId(
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
