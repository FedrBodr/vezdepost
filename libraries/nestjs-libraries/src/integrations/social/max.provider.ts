import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import dayjs from 'dayjs';
import {
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { Integration } from '@prisma/client';
import striptags from 'striptags';
import { Bot } from '@maxhub/max-bot-api';
import { readMediaSourceBuffer } from '@gitroom/helpers/utils/media.source';

// Bot token is permanent (like Telegram's). Constructing with an unset token
// must not throw at import time so other providers keep loading.
const bot = new Bot(process.env.MAX_TOKEN || '');
const frontendURL = process.env.FRONTEND_URL || 'http://localhost:5000';

export type MaxConnectionStatus =
  | 'waiting'
  | 'ready'
  | 'bot_not_admin'
  | 'missing_permissions'
  | 'max_error';

export type MaxConnectionResult =
  | { status: 'waiting'; lastChatId?: number }
  | { status: 'ready'; chatId: number }
  | {
      status: 'bot_not_admin' | 'missing_permissions';
      candidateChatId: number;
    }
  | { status: 'max_error' };

type MaxMembership = {
  is_admin?: boolean;
  permissions?: string[] | null;
};

export const parseMaxConnectionMessage = (text?: string | null) => {
  const match = text?.match(/^\/connect ([^\s]+)$/);
  return match ? { nonce: match[1] } : null;
};

export const evaluateMaxPermissions = (
  member: MaxMembership
): Extract<
  MaxConnectionStatus,
  'ready' | 'bot_not_admin' | 'missing_permissions'
> => {
  if (member.is_admin !== true) {
    return 'bot_not_admin';
  }
  const permissions = member.permissions || [];
  if (
    !permissions.includes('read_all_messages') ||
    !permissions.includes('write')
  ) {
    return 'missing_permissions';
  }
  return 'ready';
};

export class MaxProvider extends SocialAbstract implements SocialProvider {
  constructor(private readonly botClient: Bot['api'] = bot.api) {
    super();
  }

  override maxConcurrentJob = 3; // ~30 rps API limit; keep concurrency moderate
  identifier = 'max';
  name = 'MAX';
  isBetweenSteps = false;
  isWeb3 = true; // routes the "Add channel" UI to the web3 custom-connect component
  scopes = [] as string[]; // bot token; no OAuth scopes
  editor = 'html' as const;

  maxLength() {
    return 4000;
  }

  // Video publishing is not enabled yet: MAX processes uploaded video
  // asynchronously and sending right after upload can fail with
  // "attachment.not.ready" — needs a readiness retry that is not
  // implemented/tested yet. Reject early with a clear message.
  override async checkValidity(
    posts: Array<ValidityMedia[]>
  ): Promise<string | true> {
    if (
      posts?.some((p) =>
        p?.some((a) => /\.(mp4|mov|mkv|webm|m4v)(\?|$)/i.test(a?.path || ''))
      )
    ) {
      return 'Video posting to MAX is not supported yet.';
    }
    return true;
  }

  // Token is permanent — no refresh, mirrors TelegramProvider.
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

  async generateAuthUrl() {
    const state = makeId(17);
    return { url: state, codeVerifier: makeId(10), state };
  }

  private async verifyConnection(chatId: number): Promise<MaxConnectionResult> {
    const [, membership] = await Promise.all([
      this.botClient.getChat(chatId),
      this.botClient.getChatMembership(chatId),
    ]);
    const status = evaluateMaxPermissions(membership);
    return status === 'ready'
      ? { status, chatId }
      : { status, candidateChatId: chatId };
  }

  async getBotId(query: {
    id?: number;
    word: string;
    chatId?: number;
  }): Promise<MaxConnectionResult> {
    try {
      if (query.chatId !== undefined) {
        return await this.verifyConnection(query.chatId);
      }

      const updates: any = await this.botClient.getUpdates(
        ['message_created'],
        query.id !== undefined ? { marker: query.id } : {}
      );
      const list: any[] = Array.isArray(updates)
        ? updates
        : updates?.updates || [];
      const match = list.find((update) => {
        const command = parseMaxConnectionMessage(update?.message?.body?.text);
        return command?.nonce === query.word;
      });
      const chatId = match?.message?.recipient?.chat_id;

      if (typeof chatId === 'number') {
        return await this.verifyConnection(chatId);
      }

      const marker =
        (!Array.isArray(updates) && updates?.marker) ||
        list[list.length - 1]?.marker;
      return {
        status: 'waiting',
        ...(typeof marker === 'number' ? { lastChatId: marker } : {}),
      };
    } catch (error) {
      console.error('Failed to verify MAX connection:', error);
      return { status: 'max_error' };
    }
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const chat: any = await this.botClient.getChat(Number(params.code));

    return {
      id: String(chat?.chat_id ?? params.code),
      name: chat?.title ?? 'MAX Channel',
      accessToken: String(params.code), // store chat_id as accessToken (like Telegram)
      refreshToken: '',
      expiresIn: dayjs().add(200, 'year').unix() - dayjs().unix(),
      picture: chat?.icon?.url ?? '',
      username: chat?.link ?? '',
    };
  }

  private normalizeText(message: string) {
    return striptags(message || '', ['b', 'strong', 'i', 'u', 'a', 'p'])
      .replace(/<strong>/g, '<b>')
      .replace(/<\/strong>/g, '</b>')
      .replace(/<p>(.*?)<\/p>/g, '$1\n');
  }

  private async buildAttachments(media: PostDetails['media']) {
    const files = media || [];
    const attachments: any[] = [];
    for (const m of files) {
      // Local-storage paths are relative; make them absolute for the SDK upload.
      const url = m.path.startsWith('http')
        ? m.path
        : `${frontendURL}${m.path}`;
      // Upload media as bytes rather than by URL: uploadImage({ url }) is a
      // passthrough — MAX only fetches the URL at send time and rejects
      // plain-http / non-standard-port sources with "Failed to upload
      // image.", while uploadVideo has no { url } variant at all. Fetching
      // into a Buffer ourselves works with any storage the server can read.
      const buffer = await readMediaSourceBuffer(url);
      const attachment =
        m.type === 'video'
          ? await this.botClient.uploadVideo({ source: buffer })
          : await this.botClient.uploadImage({ source: buffer });
      // uploadVideo/uploadImage return class instances (VideoAttachment /
      // ImageAttachment) whose wire shape is produced by `.toJson()` —
      // NOT the JS-standard `.toJSON()`. The SDK's client does a plain
      // `JSON.stringify(body)` with no special-casing, so pushing the raw
      // instance would serialize its own properties (e.g. {token}) instead
      // of the required `{ type, payload }` wrapper. Serialize explicitly.
      attachments.push(attachment.toJson());
    }
    return attachments;
  }

  private async sendMessage(
    accessToken: string,
    post: PostDetails,
    replyMid?: string
  ) {
    const attachments = await this.buildAttachments(post.media);

    const message: any = await this.botClient.sendMessageToChat(
      Number(accessToken),
      this.normalizeText(post.message),
      {
        format: 'html',
        ...(replyMid ? { link: { type: 'reply', mid: replyMid } } : {}),
        ...(attachments.length ? { attachments } : {}),
      }
    );

    return message?.body?.mid ?? message?.mid;
  }

  async post(
    id: string,
    accessToken: string, // = chat_id of the channel
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const mid = await this.sendMessage(accessToken, firstPost);
    if (!mid) return [];

    return [
      {
        id: firstPost.id,
        postId: String(mid),
        releaseURL: `https://max.ru/${id}`,
        status: 'completed',
      },
    ];
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;
    const mid = await this.sendMessage(
      accessToken,
      commentPost,
      lastCommentId || postId
    );
    if (!mid) return [];

    return [
      {
        id: commentPost.id,
        postId: String(mid),
        releaseURL: `https://max.ru/${id}`,
        status: 'completed',
      },
    ];
  }
}
