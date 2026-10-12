import {
  Injectable,
  Module,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Bot } from '@maxhub/max-bot-api';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { TelegramAssistantLinkService } from '@gitroom/nestjs-libraries/database/prisma/telegram-assistant/telegram.assistant.link.service';
import { redisKeyValueStore } from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import {
  downloadOverHttps,
  TelegramAssistantApi,
} from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.api';
import { DraftStore } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.draft';
import { TelegramAssistantPublisher } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.publisher';
import { TelegramAssistantRouter } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.router';
import { TelegramAssistantPoller } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.poller';
import { QuickPostService } from '@gitroom/nestjs-libraries/quick-post/quick.post.service';
import { storeTelegramFile } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.storage';
import { AssistantRouter } from '@gitroom/nestjs-libraries/assistant/assistant.router';
import { MaxAssistantTransport } from '@gitroom/nestjs-libraries/assistant/max.assistant.transport';
import { MaxAssistantPoller } from '@gitroom/nestjs-libraries/assistant/max.assistant.poller';

/**
 * Runs the messenger assistants inside the backend: @vezde_post_bot on
 * Telegram when TELEGRAM_ASSISTANT_TOKEN is set, and the MAX assistant bot
 * when MAX_ASSISTANT_TOKEN is set (a separate bot from MAX_TOKEN, whose
 * getUpdates the channel provider already consumes).
 */
@Injectable()
export class TelegramAssistantWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private poller?: TelegramAssistantPoller;
  private maxPoller?: MaxAssistantPoller;

  constructor(
    private _postsService: PostsService,
    private _integrationService: IntegrationService,
    private _mediaService: MediaService,
    private _linkService: TelegramAssistantLinkService
  ) {}

  onApplicationBootstrap() {
    const storage = UploadFactory.createStorage();
    const appUrl = process.env.FRONTEND_URL || 'https://app.vezdepost.ru';
    const quickPost = new QuickPostService({
      integrationService: this._integrationService,
      postsService: this._postsService,
    });

    const token = process.env.TELEGRAM_ASSISTANT_TOKEN;
    if (token) {
      const api = new TelegramAssistantApi(token);
      const router = new TelegramAssistantRouter({
        api,
        linkService: this._linkService,
        drafts: new DraftStore(redisKeyValueStore),
        appUrl,
        publisher: new TelegramAssistantPublisher({
          api,
          storeFile: (buffer) => storeTelegramFile(buffer, storage),
          mediaService: this._mediaService,
          quickPost,
        }),
      });
      this.poller = new TelegramAssistantPoller(
        api,
        router,
        redisKeyValueStore,
        randomBytes(8).toString('hex')
      );
      void this.poller.start();
      console.log('[telegram-assistant] polling started');
    }

    const maxToken = process.env.MAX_ASSISTANT_TOKEN;
    if (maxToken) {
      const transport = new MaxAssistantTransport(
        new Bot(maxToken).api,
        downloadOverHttps
      );
      const publisher = new TelegramAssistantPublisher({
        api: { downloadFile: transport.downloadFile },
        storeFile: (buffer) => storeTelegramFile(buffer, storage),
        mediaService: this._mediaService,
        quickPost,
      });
      const router = new AssistantRouter({
        transport,
        linkService: {
          consumeLinkCode: (code, t, id) =>
            this._linkService.consumeLinkCode(code, id, t),
          findLink: (t, id) => this._linkService.findLink(id, t),
        },
        publisher: {
          listChannels: (orgId) => publisher.listChannels(orgId),
          publish: (orgId, draft, download) =>
            publisher.publish(orgId, draft, download),
        },
        drafts: new DraftStore(redisKeyValueStore),
        draftKeyOf: (id) => `max:${id}`,
        appUrl,
        linkButtonLabel: 'Постить из MAX',
      });
      this.maxPoller = new MaxAssistantPoller(
        transport,
        router,
        redisKeyValueStore,
        randomBytes(8).toString('hex')
      );
      void this.maxPoller.start();
      console.log('[max-assistant] polling started');
    }
  }

  async onModuleDestroy() {
    await Promise.all([this.poller?.stop(), this.maxPoller?.stop()]);
  }
}

@Module({
  providers: [TelegramAssistantWorker],
})
export class TelegramAssistantModule {}
