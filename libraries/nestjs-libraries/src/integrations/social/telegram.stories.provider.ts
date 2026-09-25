import dayjs from 'dayjs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import TelegramBot from 'node-telegram-bot-api';
import { Integration } from '@prisma/client';
import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  RefreshToken,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';
import { readOrFetch } from '@gitroom/helpers/utils/read.or.fetch';
import { normalizeVerifiedHtml } from '@gitroom/helpers/utils/verified.html.normalization';
import { measureContent } from '@gitroom/helpers/utils/platform.content.measurement';
import {
  resolveStoryFrameCaptions,
  TELEGRAM_STORIES_IDENTIFIER,
  TELEGRAM_STORY_CAPTION_MAX,
  TELEGRAM_STORY_DEFAULT_ACTIVE_PERIOD,
  TELEGRAM_STORY_MAX_FRAMES,
  TELEGRAM_STORY_VIDEO_MAX_SECONDS,
} from '@gitroom/helpers/utils/telegram.stories.constants';
import { TelegramStoriesDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/telegram.stories.dto';
import { TelegramBusinessApi } from '@gitroom/nestjs-libraries/integrations/social/telegram.business.api';
import { TelegramUpdatesHub } from '@gitroom/nestjs-libraries/integrations/social/telegram.updates.hub';
import {
  KeyValueStore,
  redisKeyValueStore,
} from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import {
  evaluateBusinessConnection,
  resolveStoriesConnection,
  takeVerifiedStoriesConnection,
} from '@gitroom/nestjs-libraries/integrations/social/telegram.stories.connection';
import {
  prepareStoryPhoto,
  prepareStoryVideo,
  probeVideoDuration,
  withTempDir,
} from '@gitroom/nestjs-libraries/integrations/social/telegram.stories.media';
import { publishStorySeries } from '@gitroom/nestjs-libraries/integrations/social/telegram.stories.publisher';

const CAPTION_LIMIT = {
  max: TELEGRAM_STORY_CAPTION_MAX,
  unit: 'utf16-code-units',
  source: 'platform',
} as const;

type TelegramStoriesDeps = {
  api: Pick<TelegramBusinessApi, 'getBusinessConnection' | 'postStory'>;
  hub: Pick<
    TelegramUpdatesHub,
    'poll' | 'findConnectionCommand' | 'findBusinessConnection'
  >;
  store: KeyValueStore;
  readMedia: (path: string) => Promise<Buffer>;
  preparePhoto: (input: Buffer) => Promise<Buffer>;
  prepareVideo: (
    input: Buffer
  ) => Promise<{ file: Buffer; durationSeconds: number }>;
  probeDuration: (input: Buffer) => Promise<number>;
};

// Stored media paths may be relative (e.g. "uploads/x.png").
const resolveMediaUrl = (path: string) =>
  path.indexOf('http') === -1 ? `${process.env.FRONTEND_URL}/${path}` : path;

const defaultDeps = (): TelegramStoriesDeps => ({
  api: new TelegramBusinessApi(),
  hub: new TelegramUpdatesHub(
    new TelegramBot(process.env.TELEGRAM_TOKEN || 'missing'),
    redisKeyValueStore
  ),
  store: redisKeyValueStore,
  readMedia: (path) => readOrFetch(resolveMediaUrl(path)),
  preparePhoto: prepareStoryPhoto,
  prepareVideo: prepareStoryVideo,
  probeDuration: (input) =>
    withTempDir(async (dir) => {
      const file = join(dir, 'probe');
      await writeFile(file, input);
      return probeVideoDuration(file);
    }),
});

@Rules(
  'Telegram Stories needs 1 to 10 photos or videos; every file becomes a separate story. Videos must be at most 60 seconds. By default the post text is the caption of the first story; use settings.frames (by position, {text: "post" | "none" | "custom", caption}) to change it. settings.active_period is 21600, 43200, 86400 (default) or 172800 seconds.'
)
export class TelegramStoriesProvider
  extends SocialAbstract
  implements SocialProvider
{
  private readonly deps: TelegramStoriesDeps;

  constructor(deps: Partial<TelegramStoriesDeps> = {}) {
    super();
    this.deps = { ...defaultDeps(), ...deps };
  }

  override maxConcurrentJob = 1;
  identifier = TELEGRAM_STORIES_IDENTIFIER;
  name = 'Telegram Stories';
  isBetweenSteps = false;
  isWeb3 = true;
  scopes = [] as string[];
  editor = 'html' as const;
  dto = TelegramStoriesDto;
  toolTip =
    'Personal stories through Telegram Business (requires Telegram Premium)';

  maxLength() {
    return TELEGRAM_STORY_CAPTION_MAX;
  }

  // An empty token marks the integration for reconnection.
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
    return {
      url: state,
      codeVerifier: makeId(10),
      state,
    };
  }

  getConnectionStatus(nonce: string) {
    return resolveStoriesConnection(this.deps.hub, this.deps.store, nonce);
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const verified = await takeVerifiedStoriesConnection(
      this.deps.store,
      params.code
    );
    if (!verified) {
      return 'Telegram Stories connection expired. Start again.';
    }
    const connection = await this.deps.api.getBusinessConnection(
      verified.businessConnectionId
    );
    if (
      connection.user.id !== verified.telegramUserId ||
      evaluateBusinessConnection(connection) !== 'ready'
    ) {
      return 'Enable "Manage stories" for the bot in Telegram Business.';
    }

    const { user } = connection;
    return {
      id: String(user.id),
      name:
        [user.first_name, user.last_name].filter(Boolean).join(' ') ||
        user.username ||
        String(user.id),
      accessToken: connection.id,
      refreshToken: '',
      expiresIn: dayjs().add(200, 'year').unix() - dayjs().unix(),
      picture: '',
      username: user.username || '',
    };
  }

  override async checkValidity(
    posts: Array<ValidityMedia[]>
  ): Promise<string | true> {
    const media = posts[0] || [];
    if (!media.length) {
      return 'Telegram Stories needs at least one photo or video.';
    }
    if (media.length > TELEGRAM_STORY_MAX_FRAMES) {
      return 'Telegram Stories supports at most 10 files per post.';
    }
    for (const item of media) {
      if (item.type !== 'video') {
        continue;
      }
      const duration = await this.deps.probeDuration(
        await this.deps.readMedia(item.path)
      );
      if (duration > TELEGRAM_STORY_VIDEO_MAX_SECONDS) {
        return 'Story videos must be at most 60 seconds long.';
      }
    }
    return true;
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<TelegramStoriesDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const connection = await this.deps.api.getBusinessConnection(accessToken);
    if (evaluateBusinessConnection(connection) !== 'ready') {
      throw new RefreshToken(
        this.identifier,
        JSON.stringify({
          is_enabled: connection.is_enabled,
          rights: connection.rights,
        }),
        '',
        'Telegram Stories access was revoked. Reconnect the channel.'
      );
    }

    const media = firstPost.media || [];
    const captions = resolveStoryFrameCaptions(
      firstPost.message || '',
      media as Array<{ id?: string }>,
      firstPost.settings?.frames
    ).map((caption) =>
      normalizeVerifiedHtml(caption, 'telegram', undefined, true)
    );
    const tooLong = captions.findIndex(
      (caption) => measureContent(caption.visibleText, CAPTION_LIMIT).exceeded
    );
    if (tooLong !== -1) {
      throw new Error(
        `Story ${tooLong + 1} caption exceeds ${TELEGRAM_STORY_CAPTION_MAX} characters.`
      );
    }
    const activePeriod = Number(
      firstPost.settings?.active_period || TELEGRAM_STORY_DEFAULT_ACTIVE_PERIOD
    );

    const { storyIds } = await publishStorySeries({
      postId: firstPost.id,
      frames: media.map((item, index) => ({ index, path: item.path })),
      store: this.deps.store,
      send: async (frame) => {
        const item = media[frame.index];
        const source = await this.deps.readMedia(item.path);
        const common = {
          businessConnectionId: accessToken,
          activePeriod,
          caption: captions[frame.index].normalized || undefined,
        };
        if (item.type === 'video') {
          const { file, durationSeconds } = await this.deps.prepareVideo(
            source
          );
          return (
            await this.deps.api.postStory({
              ...common,
              kind: 'video',
              file,
              durationSeconds,
            })
          ).id;
        }
        const file = await this.deps.preparePhoto(source);
        return (
          await this.deps.api.postStory({ ...common, kind: 'photo', file })
        ).id;
      },
    });

    const username = integration?.profile;
    return [
      {
        id: firstPost.id,
        postId: storyIds.join(','),
        releaseURL: username ? `https://t.me/${username}/s/${storyIds[0]}` : '',
        status: 'completed',
      },
    ];
  }
}
