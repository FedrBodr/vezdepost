import type { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import type { TelegramAssistantApi } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.api';
import {
  Draft,
  DraftChannel,
  DraftFile,
} from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.draft';
import {
  QuickPostError,
  QuickPostService,
} from '@gitroom/nestjs-libraries/quick-post/quick.post.service';

/** A problem the user can fix in Telegram; its message is shown as is. */
export const PublishError = QuickPostError;
export type PublishError = QuickPostError;

export type PublishResult = {
  published: string[];
  failed: Array<{ name: string; error: string }>;
};

export type TelegramAssistantPublisherDeps = {
  api: Pick<TelegramAssistantApi, 'downloadFile'>;
  storeFile: (
    buffer: Buffer,
    kind: DraftFile['kind']
  ) => Promise<{ path: string; name: string }>;
  mediaService: Pick<MediaService, 'saveFile'>;
  quickPost: Pick<QuickPostService, 'listChannels' | 'publish'>;
};

/** Turns a Telegram draft into dashboard posts, one per selected channel. */
export class TelegramAssistantPublisher {
  constructor(private readonly deps: TelegramAssistantPublisherDeps) {}

  listChannels(organizationId: string): Promise<DraftChannel[]> {
    return this.deps.quickPost.listChannels(organizationId);
  }

  async publish(organizationId: string, draft: Draft): Promise<PublishResult> {
    // Validate before downloading so an empty draft never touches storage.
    if (!draft.selected.length) {
      throw new PublishError('Выберите хотя бы один канал');
    }
    if (!draft.text.trim() && !draft.files.length) {
      throw new PublishError('Пустой пост');
    }

    const media = [];
    for (const file of draft.files) {
      const stored = await this.deps.storeFile(
        await this.deps.api.downloadFile(file.fileId),
        file.kind
      );
      const saved = await this.deps.mediaService.saveFile(
        organizationId,
        stored.name,
        stored.path
      );
      media.push({ id: saved.id, path: saved.path });
    }

    const result = await this.deps.quickPost.publish(
      organizationId,
      {
        text: draft.text,
        media,
        integrationIds: draft.selected,
        schedule: { type: 'now' },
      },
      'API'
    );
    return {
      published: result.published.map(({ name }) => name),
      failed: result.failed.map(({ name, error }) => ({ name, error })),
    };
  }
}
