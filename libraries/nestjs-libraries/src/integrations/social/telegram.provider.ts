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
  TELEGRAM_MEDIA_GROUP_MAX_ITEMS,
} from '@gitroom/helpers/utils/telegram.constraints';
import { telegramRichMediaEligible } from '@gitroom/helpers/utils/telegram.rich.normalization';

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

  async getBotId(query: { id?: number; word: string }) {
    // Added allowed_updates Ensure only necessary updates are fetched
    const res = await this.botClient.getUpdates({
      ...(query.id ? { offset: query.id } : {}),
      allowed_updates: ['message', 'channel_post'],
    });
    //message.text is for groups, channel_post.text is for channels
    const match = res.find(
      (p) =>
        (p?.message?.text === `/connect ${query.word}` &&
          p?.message?.chat?.id) ||
        (p?.channel_post?.text === `/connect ${query.word}` &&
          p?.channel_post?.chat?.id)
    );
    // get correct chatId based on the channel type
    const chatId = match?.message?.chat?.id || match?.channel_post?.chat?.id;

    // prevents the code from running while chatId is still undefined to avoid the error 'ETELEGRAM: 400 Bad Request: chat_id is empty'. the code would still work eventually but console spam is not pretty
    if (chatId) {
      //get the numberic ID of the bot
      const botId = (await this.botClient.getMe()).id;
      // check if the bot is an admin in the chat
      const isAdmin = await this.botIsAdmin(chatId, botId);
      // get the messageId of the message that triggered the connection
      const connectMessageId =
        match?.message?.message_id || match?.channel_post?.message_id;

      if (!isAdmin) {
        // alternatively you can replace this with a console.log if you do not want to inform the user of the bot's admin status
        this.botClient.sendMessage(
          chatId,
          "Connection Successful. I don't have admin privileges to delete these messages, please go ahead and remove them yourself."
        );
      } else {
        // Delete the message that triggered the connection
        await this.botClient.deleteMessage(chatId, connectMessageId);
        // Send success message to the chat
        const successMessage = await this.botClient.sendMessage(
          chatId,
          'Connection Successful. Message will be deleted in 10 seconds.'
        );
        // Delete the success message after 10 seconds
        setTimeout(async () => {
          await this.botClient.deleteMessage(chatId, successMessage.message_id);
          console.log('Success message deleted.');
        }, 10000);
      }
    }

    // modified lastChatId to work with any type of channel (private/public groups/channels)
    return chatId
      ? { chatId }
      : res.length > 0
      ? {
          lastChatId: res[res.length - 1].update_id + 1,
        }
      : {};
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
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendRichMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: accessToken,
          rich_message: JSON.stringify({ html }),
        }),
      }
    );
    const data: any = await response.json();
    if (!response.ok || !data?.ok) {
      throw new Error(
        data?.description ||
          `Telegram rich message failed with status ${response.status}`
      );
    }
    return typeof data.result?.message_id === 'number'
      ? data.result.message_id
      : null;
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

  async botIsAdmin(chatId: number, botId: number): Promise<boolean> {
    try {
      const chatMember = await this.botClient.getChatMember(chatId, botId);

      if (
        chatMember.status === 'administrator' ||
        chatMember.status === 'creator'
      ) {
        const permissions = chatMember.can_delete_messages;
        return !!permissions; // Return true if bot can delete messages
      }

      return false;
    } catch (error) {
      console.error('Error checking bot privileges:', error);
      return false;
    }
  }
}
