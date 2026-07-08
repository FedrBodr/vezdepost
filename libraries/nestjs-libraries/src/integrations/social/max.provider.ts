import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import dayjs from 'dayjs';
import { SocialAbstract } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { Integration } from '@prisma/client';
import striptags from 'striptags';
import { Bot } from '@maxhub/max-bot-api';

// Bot token is permanent (like Telegram's). Constructing with an unset token
// must not throw at import time so other providers keep loading.
const bot = new Bot(process.env.MAX_TOKEN || '');
const frontendURL = process.env.FRONTEND_URL || 'http://localhost:5000';

export class MaxProvider extends SocialAbstract implements SocialProvider {
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

  // Long-poll the bot's updates for a "/connect <word>" message in the channel.
  // Returns { chatId } on match, { lastChatId } to advance the poll cursor, or {}.
  async getBotId(query: { id?: number; word: string }) {
    const updates: any = await bot.api.getUpdates(
      ['message_created'],
      query.id ? { marker: query.id } : {}
    );

    const list: any[] = Array.isArray(updates) ? updates : updates?.updates || [];

    const match = list.find(
      (u) => u?.message?.body?.text === `/connect ${query.word}`
    );
    const chatId = match?.message?.recipient?.chat_id;

    if (chatId) {
      return { chatId };
    }

    const marker =
      (updates && !Array.isArray(updates) && updates.marker) ||
      list[list.length - 1]?.marker;

    return marker ? { lastChatId: marker } : {};
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const chat: any = await bot.api.getChat(Number(params.code));

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
      const url = m.path.startsWith('http') ? m.path : `${frontendURL}${m.path}`;
      // Upload media as bytes rather than by URL: uploadImage({ url }) is a
      // passthrough — MAX only fetches the URL at send time and rejects
      // plain-http / non-standard-port sources with "Failed to upload
      // image.", while uploadVideo has no { url } variant at all. Fetching
      // into a Buffer ourselves works with any storage the server can read.
      const res = await fetch(url);
      const buffer = Buffer.from(await res.arrayBuffer());
      const attachment =
        m.type === 'video'
          ? await bot.api.uploadVideo({ source: buffer })
          : await bot.api.uploadImage({ source: buffer });
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

    const message: any = await bot.api.sendMessageToChat(
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
