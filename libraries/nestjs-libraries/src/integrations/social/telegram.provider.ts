import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import dayjs from 'dayjs';
import {
  BadBody,
  SocialAbstract,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
//@ts-ignore
import mime from 'mime';
import TelegramBot from 'node-telegram-bot-api';
import { Integration } from '@prisma/client';
import {
  getTelegramVisibleTextLength,
  normalizeTelegramHtml,
  shouldSendTelegramTextSeparately,
  TELEGRAM_MEDIA_GROUP_MAX_ITEMS,
} from '@gitroom/helpers/utils/telegram.constraints';
import {
  buildTelegramRichMessage,
  telegramRichMediaEligible,
} from '@gitroom/helpers/utils/telegram.rich.normalization';
import { callTelegramApi } from '@gitroom/nestjs-libraries/integrations/social/telegram.rich.api';
import { TelegramUpdatesHub } from '@gitroom/nestjs-libraries/integrations/social/telegram.updates.hub';
import {
  KeyValueStore,
  redisKeyValueStore,
} from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import {
  isConnectionCandidate,
  rememberChatConnection,
  takeVerifiedChat,
} from '@gitroom/nestjs-libraries/integrations/social/chat.connection.store';

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

export { parseTelegramConnectionMessage } from '@gitroom/nestjs-libraries/integrations/social/telegram.updates.hub';

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
  constructor(
    private readonly botClient: TelegramBotClient = telegramBot,
    private readonly updatesHub = new TelegramUpdatesHub(
      botClient,
      redisKeyValueStore
    ),
    private readonly connectionStore: KeyValueStore = redisKeyValueStore
  ) {
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
    return 32768;
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
    const state = makeSecureId(17);
    // The nonce doubles as codeVerifier so authenticate can find the verified chat.
    return {
      url: state,
      codeVerifier: state,
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    if (
      !(await takeVerifiedChat(
        this.connectionStore,
        'telegram',
        params.codeVerifier,
        params.code
      ))
    ) {
      return 'Telegram connection expired. Start again.';
    }
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
    nonce: string,
    chatId: number
  ): Promise<TelegramConnectionResult> {
    const [chat, bot] = await Promise.all([
      this.botClient.getChat(chatId),
      this.botClient.getMe(),
    ]);
    const member = await this.botClient.getChatMember(chatId, bot.id);
    const status = evaluateTelegramPermissions(chat.type, member);

    const result: TelegramConnectionResult =
      status === 'ready'
        ? { status, chatId }
        : { status, candidateChatId: chatId };
    await rememberChatConnection(this.connectionStore, 'telegram', nonce, result);
    return result;
  }

  async getBotId(query: {
    /** Legacy client offset; ignored since updates are read through the hub. */
    id?: number;
    word: string;
    chatId?: number;
  }): Promise<TelegramConnectionResult> {
    try {
      if (query.chatId !== undefined) {
        // Re-checking permissions is allowed only for the chat that posted the nonce.
        if (
          !(await isConnectionCandidate(
            this.connectionStore,
            'telegram',
            query.word,
            query.chatId
          ))
        ) {
          return { status: 'waiting' };
        }
        return await this.verifyConnection(query.word, query.chatId);
      }

      await this.updatesHub.poll();
      const command = await this.updatesHub.findConnectionCommand(query.word);
      if (command) {
        return await this.verifyConnection(query.word, command.chatId);
      }

      return { status: 'waiting' };
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
    try {
      return await this.sendMessageInternal(
        accessToken,
        message,
        replyToMessageId
      );
    } catch (error: any) {
      // A Telegram 400 is a permanent rejection of this request (caption too
      // long, media Telegram could not download, ...): retrying it can never
      // succeed, so surface it to the user instead.
      const body = error?.response?.body;
      if (error?.code === 'ETELEGRAM' && body?.error_code === 400) {
        const description = (body.description || '').replace(
          'Bad Request: ',
          ''
        );
        throw new BadBody(
          'telegram-error',
          JSON.stringify(body),
          Buffer.from(JSON.stringify(body)),
          description === 'failed to get HTTP URL content'
            ? 'Telegram could not download your media file, please check the file and try again'
            : `Telegram rejected the post: ${description}`
        );
      }
      throw error;
    }
  }

  private async sendMessageInternal(
    accessToken: string,
    message: PostDetails,
    replyToMessageId?: number
  ): Promise<number | null> {
    let messageId: number | null = null;
    const mediaFiles = message.media || [];
    const text = normalizeTelegramHtml(message.message || '');

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
      const mediaGroups = this.chunkMedia(
        processedMedia,
        TELEGRAM_MEDIA_GROUP_MAX_ITEMS
      );
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

  /**
   * Sends the main post as a rich message. Returns null when the post is not
   * rich-eligible (local media, videos, documents) so the caller can use the
   * legacy transport; throws when Telegram rejects the rich payload.
   */
  private async trySendRichMessage(
    accessToken: string,
    message: PostDetails
  ): Promise<number | null> {
    const html = (message.message || '').trim();
    if (!html) {
      return null;
    }
    const files = (message.media || []).map(({ type, path }) => ({
      type,
      path,
    }));
    if (files.length && !telegramRichMediaEligible(files)) {
      return null;
    }
    const token = process.env.TELEGRAM_TOKEN;
    if (!token) {
      return null;
    }
    // sendRichMessage landed in Bot API 10.1, after the pinned
    // node-telegram-bot-api release; call the API directly on the same
    // classic https stack the library itself uses.
    const result = await callTelegramApi<{ message_id?: number }>(
      token,
      'sendRichMessage',
      {
        chat_id: accessToken,
        rich_message: JSON.stringify(
          buildTelegramRichMessage(html, message.media || [])
        ),
      }
    );
    return typeof result?.message_id === 'number' ? result.message_id : null;
  }

  private async sendMainPost(
    accessToken: string,
    message: PostDetails
  ): Promise<number | null> {
    try {
      const richMessageId = await this.trySendRichMessage(accessToken, message);
      if (richMessageId !== null) {
        return richMessageId;
      }
    } catch (error: any) {
      console.warn(
        '[telegram] rich message failed, falling back to legacy transport:',
        error?.message || error
      );
    }
    return this.sendMessage(accessToken, message);
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;

    const messageId = await this.sendMainPost(accessToken, firstPost);

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
    const result: Array<Array<{ type: string; media: string }>> = [];
    for (let i = 0; i < media.length; i += size) {
      result.push(media.slice(i, i + size));
    }
    const finalGroup = result.at(-1);
    const precedingGroup = result.at(-2);
    if (
      finalGroup?.length === 1 &&
      precedingGroup &&
      precedingGroup.length > 2
    ) {
      const rebalancedItem = precedingGroup.pop();
      if (rebalancedItem) finalGroup.unshift(rebalancedItem);
    }
    return result;
  }

}
