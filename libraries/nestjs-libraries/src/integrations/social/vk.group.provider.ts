import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { VkProvider } from '@gitroom/nestjs-libraries/integrations/social/vk.provider';
import { BadBody } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { Integration } from '@prisma/client';
import axios from 'axios';
import FormDataNew from 'form-data';
import mime from 'mime-types';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';

export class VkGroupProvider extends VkProvider {
  override identifier = 'vk-group';
  override name = 'VK Group';
  override isBetweenSteps = true;
  override scopes = [
    'vkid.personal_info',
    'email',
    'wall',
    'status',
    'docs',
    'photos',
    'video',
    'groups',
  ];

  override async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const result = await super.authenticate(params);
    // Transient id: replaced by -{groupId} in saveProviderPage. Prefixed so the
    // organizationId_internalId upsert can never collide with a plain 'vk'
    // channel of the same account.
    return { ...result, id: `g_${result.id}` };
  }

  // Groups the user can post to (admin/editor). Ids are returned negated to
  // match the internalId convention (VK owner_id semantics) — this also lets
  // the picker's existingId filter recognize already-connected groups.
  async pages(accessToken: string) {
    const { response } = await (
      await this.fetch(
        `https://api.vk.com/method/groups.get?filter=admin,editor&extended=1&fields=photo_200,screen_name&access_token=${accessToken}&v=5.251`
      )
    ).json();

    return (response?.items || []).map((g: any) => ({
      id: String(-g.id),
      name: g.name,
      username: g.screen_name || '',
      picture: g.photo_200 || '',
    }));
  }

  async fetchPageInformation(accessToken: string, data: { page: string }) {
    const groupId = Math.abs(Number(data.page));
    const { response } = await (
      await this.fetch(
        `https://api.vk.com/method/groups.getById?group_id=${groupId}&fields=photo_200,screen_name&access_token=${accessToken}&v=5.251`
      )
    ).json();

    const group = response?.groups?.[0] ?? response?.[0];

    if (!group) {
      throw new Error(`VK group ${groupId} could not be resolved`);
    }

    return {
      id: String(-groupId),
      name: group?.name ?? '',
      // Same user token — VK ID has no per-group token in this flow.
      access_token: accessToken,
      picture: group?.photo_200 ?? '',
      username: group?.screen_name ?? '',
    };
  }

  async reConnect(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>> {
    const information = await this.fetchPageInformation(accessToken, {
      page: requiredId,
    });

    return {
      id: information.id,
      name: information.name,
      accessToken: information.access_token,
      picture: information.picture,
      username: information.username,
    };
  }

  // userId here is the integration internalId: the NEGATIVE group id.
  protected override async uploadMedia(
    userId: string,
    accessToken: string,
    post: PostDetails
  ): Promise<{ id: string; type: string }[]> {
    const groupId = Math.abs(Number(userId));

    return await Promise.all(
      (post?.media || []).map(async (media) => {
        const all = await (
          await this.fetch(
            hasExtension(media.path, 'mp4')
              ? `https://api.vk.com/method/video.save?group_id=${groupId}&access_token=${accessToken}&v=5.251`
              : `https://api.vk.com/method/photos.getWallUploadServer?group_id=${groupId}&access_token=${accessToken}&v=5.251`
          )
        ).json();

        if (all?.error || !all?.response) {
          throw new BadBody(
            this.identifier,
            JSON.stringify(all),
            '{}',
            all?.error?.error_msg || 'VK media upload failed'
          );
        }

        const { data } = await axios.get(media.path!, {
          responseType: 'stream',
        });

        const slash = media.path.split('/').at(-1);

        const formData = new FormDataNew();
        formData.append('photo', data, {
          filename: slash,
          contentType: mime.lookup(slash!) || '',
        });
        const value = (
          await axios.post(all.response.upload_url, formData, {
            headers: {
              ...formData.getHeaders(),
            },
          })
        ).data;

        if (hasExtension(media.path, 'mp4')) {
          return {
            id: all.response.video_id,
            type: 'video',
          };
        }

        const formSend = new FormData();
        formSend.append('photo', value.photo);
        formSend.append('server', value.server);
        formSend.append('hash', value.hash);
        formSend.append('group_id', String(groupId));

        const saveWallPhoto = await (
          await fetch(
            `https://api.vk.com/method/photos.saveWallPhoto?access_token=${accessToken}&v=5.251`,
            {
              method: 'POST',
              body: formSend,
            }
          )
        ).json();

        if (saveWallPhoto?.error || !saveWallPhoto?.response?.[0]) {
          throw new BadBody(
            this.identifier,
            JSON.stringify(saveWallPhoto),
            '{}',
            saveWallPhoto?.error?.error_msg || 'VK photo save failed'
          );
        }

        const { id } = saveWallPhoto.response[0];

        return {
          id,
          type: 'photo',
        };
      })
    );
  }

  override async post(
    userId: string,
    accessToken: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;

    const mediaList = await this.uploadMedia(userId, accessToken, firstPost);

    const body = new FormData();
    body.append('owner_id', userId); // negative group id
    body.append('from_group', '1'); // post as the community
    body.append('message', firstPost.message);

    if (mediaList.length) {
      body.append(
        'attachments',
        mediaList.map((p) => `${p.type}${userId}_${p.id}`).join(',')
      );
    }

    const wallPostResult = await (
      await this.fetch(
        `https://api.vk.com/method/wall.post?v=5.251&access_token=${accessToken}&client_id=${process.env.VK_ID}`,
        {
          method: 'POST',
          body,
        }
      )
    ).json();

    if (wallPostResult?.error || !wallPostResult?.response) {
      throw new BadBody(
        this.identifier,
        JSON.stringify(wallPostResult),
        '{}',
        wallPostResult?.error?.error_msg || 'VK post failed'
      );
    }

    const { response } = wallPostResult;

    return [
      {
        id: firstPost.id,
        postId: String(response?.post_id),
        releaseURL: `https://vk.com/wall${userId}_${response?.post_id}`,
        status: 'completed',
      },
    ];
  }

  override async comment(
    userId: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;

    const mediaList = await this.uploadMedia(userId, accessToken, commentPost);

    const body = new FormData();
    body.append('owner_id', userId); // negative group id
    // wall.createComment expects the POSITIVE community id here (unlike
    // wall.post, where from_group is a 0/1 flag).
    body.append('from_group', String(Math.abs(Number(userId))));
    body.append('message', commentPost.message);
    body.append('post_id', postId);

    if (mediaList.length) {
      body.append(
        'attachments',
        mediaList.map((p) => `${p.type}${userId}_${p.id}`).join(',')
      );
    }

    const wallCommentResult = await (
      await this.fetch(
        `https://api.vk.com/method/wall.createComment?v=5.251&access_token=${accessToken}&client_id=${process.env.VK_ID}`,
        {
          method: 'POST',
          body,
        }
      )
    ).json();

    if (wallCommentResult?.error || !wallCommentResult?.response) {
      throw new BadBody(
        this.identifier,
        JSON.stringify(wallCommentResult),
        '{}',
        wallCommentResult?.error?.error_msg || 'VK comment failed'
      );
    }

    const { response } = wallCommentResult;

    return [
      {
        id: commentPost.id,
        postId: String(response?.comment_id),
        releaseURL: `https://vk.com/wall${userId}_${postId}`,
        status: 'completed',
      },
    ];
  }
}
