import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import dayjs from 'dayjs';
import { SocialAbstract } from '@gitroom/nestjs-libraries/integrations/social.abstract';
//@ts-ignore
import mime from 'mime';
import TelegramBot from 'node-telegram-bot-api';
import { Integration } from '@prisma/client';
import {
  getTelegramVisibleTextLength,
  normalizeTelegramHtml,
  shouldSendTelegramTextSeparately,
} from '@gitroom/helpers/utils/telegram.constraints';

const telegramBot = new TelegramBot(process.env.TELEGRAM_TOKEN!);
// Added to support local storage posting
const frontendURL = process.env.FRONTEND_URL || 'http://localhost:5000';
const mediaStorage = process.env.STORAGE_PROVIDER || 'local';

type TelegramBotClient = Pick<
  TelegramBot,
  | 'getChat'
  | 'getFileLink'
  | 'getUpdates'
  | 'getMe'
  | 'deleteMessage'
  | 'sendMessage'
  | 'sendVideo'
  | 'sendPhoto'
  | 'sendDocument'
  | 'sendMediaGroup'
  | 'getChatMember'
>;

export type TelegramConnectionStatus =
  | 'waiting'
  | 'ready'
  | 'bot_not_admin'
  | 'missing_post_permission'
  | 'telegram_error';

export type TelegramConnectionResult = {
  status: TelegramConnectionStatus;
  chatId?: number;
  candidateChatId?: number;
  lastChatId?: number;
};

export const parseTelegramConnectionMessage = (text?: string) => {
  if (!text) {
    return null;
  }

  const match = text.match(
    /^\/(start|connect)(?:@[A-Za-z0-9_]+)? ([A-Za-z0-9_-]{1,64})$/
  );
  if (!match) {
    return null;
  }

  return {
    kind: match[1] as 'start' | 'connect',
    nonce: match[2],
  };
};

export const evaluateTelegramPermissions = (
  chatType: string,
  member: TelegramBot.ChatMember
): TelegramConnectionStatus => {
  if (member.status === 'creator') {
    return 'ready';
  }
  if (member.status !== 'administrator') {
    return 'bot_not_admin';
  }
  if (chatType === 'channel' && member.can_post_messages !== true) {
    return 'missing_post_permission';
  }
  return 'ready';
};

export class TelegramProvider extends SocialAbstract implements SocialProvider {
  constructor(private readonly botClient: TelegramBotClient = telegramBot) {
    super();
  }

  override maxConcurrentJob = 3; // Telegram has moderate bot API limits
  identifier = 'telegram';
  name = 'Telegram';
  isBetweenSteps = false;
  isWeb3 = true;
  scopes = [] as string[];
  editor = 'html' as const;
  maxLength() {
    return 4096;
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
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
    return {
      url: state,
      codeVerifier: makeId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const chat = await this.botClient.getChat(params.code);

    console.log(JSON.stringify(chat));
    if (!chat?.id) {
      return 'No chat found';
    }

    const photo = !chat?.photo?.big_file_id
      ? ''
      : await this.botClient.getFileLink(chat.photo.big_file_id);

    // Modified id to work with chat.username (public groups/channels) or chat.id (private groups/channels) when chat.username is not available
    return {
      id: String(chat.username ? chat.username : chat.id),
      name: chat.title!,
      accessToken: String(chat.id),
      refreshToken: '',
      expiresIn: dayjs().add(200, 'year').unix() - dayjs().unix(),
      picture: photo || '',
      username: chat.username!,
    };
  }

  private async verifyConnection(
    chatId: number
  ): Promise<TelegramConnectionResult> {
    const [chat, bot] = await Promise.all([
      this.botClient.getChat(chatId),
      this.botClient.getMe(),
    ]);
    const member = await this.botClient.getChatMember(chatId, bot.id);
    const status = evaluateTelegramPermissions(chat.type, member);

    return status === 'ready'
      ? { status, chatId }
      : { status, candidateChatId: chatId };
  }

  async getBotId(query: {
    id?: number;
    word: string;
    chatId?: number;
  }): Promise<TelegramConnectionResult> {
    try {
      if (query.chatId !== undefined) {
        return await this.verifyConnection(query.chatId);
      }

      const res = await this.botClient.getUpdates({
        ...(query.id !== undefined ? { offset: query.id } : {}),
        allowed_updates: ['message', 'channel_post'],
      });
      const match = res.find((update) => {
        const message = update.message || update.channel_post;
        const connection = parseTelegramConnectionMessage(message?.text);
        return connection?.nonce === query.word && message?.chat?.id;
      });
      const chatId = match?.message?.chat?.id || match?.channel_post?.chat?.id;

      if (chatId !== undefined) {
        return await this.verifyConnection(chatId);
      }

      return {
        status: 'waiting',
        ...(res.length > 0
          ? { lastChatId: res[res.length - 1].update_id + 1 }
          : {}),
      };
    } catch (error) {
      console.error('Failed to verify Telegram connection:', error);
      return { status: 'telegram_error' };
    }
  }

  private processMedia(mediaFiles: PostDetails['media']) {
    return (mediaFiles || []).map((media) => {
      let mediaUrl = media.path;
      if (mediaStorage === 'local' && mediaUrl.startsWith(frontendURL)) {
        mediaUrl = mediaUrl.replace(frontendURL, '');
      }
      //get mime type to pass contentType to telegram api.
      //some photos and videos might not pass telegram api restrictions, so they are sent as documents instead of returning errors
      const mimeType = mime.getType(mediaUrl); // Detect MIME type
      let mediaType: 'photo' | 'video' | 'document';

      if (mimeType?.startsWith('image/')) {
        mediaType = 'photo';
      } else if (mimeType?.startsWith('video/')) {
        mediaType = 'video';
      } else {
        mediaType = 'document';
      }

      return {
        type: mediaType,
        media: mediaUrl,
        fileOptions: {
          filename: media.path.split('/').pop(),
          contentType: mimeType || 'application/octet-stream',
        },
      };
    });
  }

  private async sendMessage(
    accessToken: string,
    message: PostDetails,
    replyToMessageId?: number
  ): Promise<number | null> {
    let messageId: number | null = null;
    const mediaFiles = message.media || [];
    const text = normalizeTelegramHtml(message.message || '');

    console.log(text);
    const processedMedia = this.processMedia(mediaFiles);
    const sendTextSeparately = shouldSendTelegramTextSeparately(
      getTelegramVisibleTextLength(message.message || ''),
      processedMedia.length
    );
    const caption = sendTextSeparately ? undefined : text;

    // if there's no media, bot sends a text message only
    if (processedMedia.length === 0) {
      const response = await this.botClient.sendMessage(accessToken, text, {
        parse_mode: 'HTML',
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      });
      messageId = response.message_id;
    }
    // if there's only one media, bot sends the media with the text message as caption
    else if (processedMedia.length === 1) {
      const media = processedMedia[0];
      const options = {
        caption,
        parse_mode: 'HTML' as const,
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      };
      const response =
        media.type === 'video'
          ? await this.botClient.sendVideo(
              accessToken,
              media.media,
              options,
              media.fileOptions
            )
          : media.type === 'photo'
          ? await this.botClient.sendPhoto(
              accessToken,
              media.media,
              options,
              media.fileOptions
            )
          : await this.botClient.sendDocument(
              accessToken,
              media.media,
              options,
              media.fileOptions
            );
      messageId = response.message_id;
    }
    // if there are multiple media, bot sends them as a media group - max 10 media per group - with the text as a caption (if there are more than 1 group, the caption will only be sent with the first group)
    else {
      const mediaGroups = this.chunkMedia(processedMedia, 10);
      for (let i = 0; i < mediaGroups.length; i++) {
        const mediaGroup = mediaGroups[i].map((m, index) => ({
          type: m.type === 'document' ? 'document' : m.type, // Documents are not allowed in media groups
          media: m.media,
          caption: i === 0 && index === 0 ? caption : undefined,
          parse_mode: 'HTML',
        }));

        const response = await this.botClient.sendMediaGroup(
          accessToken,
          mediaGroup as any[],
          {
            ...(replyToMessageId && i === 0
              ? { reply_to_message_id: replyToMessageId }
              : {}),
          }
        );
        if (i === 0) {
          messageId = response[0].message_id;
        }
      }
    }

    if (sendTextSeparately) {
      await this.botClient.sendMessage(accessToken, text, {
        parse_mode: 'HTML',
      });
    }

    return messageId;
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;

    const messageId = await this.sendMessage(accessToken, firstPost);

    // for private groups/channels message.id is undefined so the link generated by Postiz will be unusable "https://t.me/c/undefined/16"
    // to avoid that, we use accessToken instead of message.id and we generate the link manually removing the -100 from the start.
    if (messageId) {
      return [
        {
          id: firstPost.id,
          postId: String(messageId),
          releaseURL: `https://t.me/${
            id !== 'undefined' ? id : `c/${accessToken.replace('-100', '')}`
          }/${messageId}`,
          status: 'completed',
        },
      ];
    }

    return [];
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
    const replyToId = Number(lastCommentId || postId);

    const messageId = await this.sendMessage(
      accessToken,
      commentPost,
      replyToId
    );

    if (messageId) {
      return [
        {
          id: commentPost.id,
          postId: String(messageId),
          releaseURL: `https://t.me/${
            id !== 'undefined' ? id : `c/${accessToken.replace('-100', '')}`
          }/${messageId}`,
          status: 'completed',
        },
      ];
    }

    return [];
  }
  // chunkMedia is used to split media into groups of "size". 10 is used here because telegram api allows a maximum of 10 media per group
  private chunkMedia(media: { type: string; media: string }[], size: number) {
    const result = [];
    for (let i = 0; i < media.length; i += size) {
      result.push(media.slice(i, i + size));
    }
    return result;
  }

}
