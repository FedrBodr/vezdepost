import {
  Injectable,
  Module,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { TelegramAssistantLinkService } from '@gitroom/nestjs-libraries/database/prisma/telegram-assistant/telegram.assistant.link.service';
import { redisKeyValueStore } from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { TelegramAssistantApi } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.api';
import { DraftStore } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.draft';
import { TelegramAssistantPublisher } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.publisher';
import { TelegramAssistantRouter } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.router';
import { TelegramAssistantPoller } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.poller';
import { storeTelegramFile } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.storage';

/** Runs @vezde_post_bot inside the backend when its token is configured. */
@Injectable()
export class TelegramAssistantWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private poller?: TelegramAssistantPoller;

  constructor(
    private _postsService: PostsService,
    private _integrationService: IntegrationService,
    private _mediaService: MediaService,
    private _linkService: TelegramAssistantLinkService
  ) {}

  onApplicationBootstrap() {
    const token = process.env.TELEGRAM_ASSISTANT_TOKEN;
    if (!token) {
      return;
    }
    const api = new TelegramAssistantApi(token);
    const storage = UploadFactory.createStorage();
    const router = new TelegramAssistantRouter({
      api,
      linkService: this._linkService,
      drafts: new DraftStore(redisKeyValueStore),
      appUrl: process.env.FRONTEND_URL || 'https://app.vezdepost.ru',
      publisher: new TelegramAssistantPublisher({
        api,
        storeFile: (buffer) => storeTelegramFile(buffer, storage),
        mediaService: this._mediaService,
        integrationService: this._integrationService,
        postsService: this._postsService,
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

  onModuleDestroy() {
    this.poller?.stop();
  }
}

@Module({
  providers: [TelegramAssistantWorker],
})
export class TelegramAssistantModule {}
