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

const INVALID_GROUP = 'Enter a valid VK community link or short name.';
const INVALID_TOKEN = 'The VK community token is invalid.';
const WRONG_GROUP = 'This token belongs to a different VK community.';
const MISSING_PERMISSIONS =
  'The VK community token must allow community management and wall access.';

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

  let candidate = input;
  const looksLikeVkUrl = /^(?:https?:\/\/)?(?:www\.)?vk\.com\//i.test(input);

  if (looksLikeVkUrl) {
    try {
      const url = new URL(
        /^https?:\/\//i.test(input) ? input : `https://${input}`
      );
      if (!/^(?:www\.)?vk\.com$/i.test(url.hostname)) {
        return null;
      }
      candidate = url.pathname.replace(/^\/+|\/+$/g, '');
    } catch {
      return null;
    }
  } else if (/^https?:\/\//i.test(input) || input.includes('/')) {
    return null;
  }

  if (!candidate || candidate.includes('/')) {
    return null;
  }

  if (/^-?\d+$/.test(candidate)) {
    return String(Math.abs(Number(candidate)));
  }

  const prefixedId = candidate.match(/^(?:club|public)(\d+)$/i);
  if (prefixedId) {
    return prefixedId[1];
  }

  return /^[a-zA-Z0-9_.-]+$/.test(candidate) ? candidate : null;
}

export class VkGroupProvider
  extends SocialAbstract
  implements SocialProvider
{
  override maxConcurrentJob = 2;
  identifier = 'vk-group';
  name = 'VK Group';
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'normal' as const;
  customFieldsInstructions = {
    title: 'When creating the VK access key, select only:',
    items: [
      'Allow the application to manage the community',
      'Allow the application to access the community wall',
    ],
    note: 'Messages, photos, documents, stories, and products/orders are not required.',
  };

  maxLength() {
    return 16384;
  }

  override async checkValidity(
    posts: Array<ValidityMedia[]>
  ): Promise<string | true> {
    if (posts?.some((post) => post?.length > 0)) {
      return 'VK Group temporarily supports text-only posts. Remove all media and try again.';
    }
    return true;
  }

  async customFields() {
    return [
      {
        key: 'group',
        label: 'VK community link or short name',
        validation: '/^.{1,255}$/',
        type: 'text' as const,
      },
      {
        key: 'accessToken',
        label: 'Community access token',
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
        .map((permission: any) => permission?.name)
        .filter(Boolean);

      if (
        permissionsPayload?.error ||
        !permissionNames.includes('manage') ||
        !permissionNames.includes('wall')
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
    const [firstPost] = postDetails;
    const wallPostResult = await this.callVk('wall.post', accessToken, {
      owner_id: userId,
      from_group: '1',
      message: firstPost.message,
    });

    if (wallPostResult?.error || !wallPostResult?.response) {
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        'VK post failed'
      );
    }

    return [
      {
        id: firstPost.id,
        postId: String(wallPostResult.response.post_id),
        releaseURL: `https://vk.com/wall${userId}_${wallPostResult.response.post_id}`,
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
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        'VK comment failed'
      );
    }

    return [
      {
        id: commentPost.id,
        postId: String(wallCommentResult.response.comment_id),
        releaseURL: `https://vk.com/wall${userId}_${postId}`,
        status: 'completed',
      },
    ];
  }
}
