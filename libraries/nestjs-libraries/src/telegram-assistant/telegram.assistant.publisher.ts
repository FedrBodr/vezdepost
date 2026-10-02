import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { selectPostValidationFailure } from '@gitroom/nestjs-libraries/database/prisma/posts/post.validation';
import type { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import type { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import type { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import type { TelegramAssistantApi } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.api';
import {
  Draft,
  DraftChannel,
  DraftFile,
  plainTextToHtml,
} from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.draft';

/** A problem the user can fix in Telegram; its message is shown as is. */
export class PublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishError';
  }
}

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
  integrationService: Pick<IntegrationService, 'getIntegrationsList'>;
  postsService: Pick<
    PostsService,
    'validatePosts' | 'mapTypeToPost' | 'createPost'
  >;
};

type ValidationItem = Parameters<typeof selectPostValidationFailure>[0][number];

const validationMessage = (item: ValidationItem) => {
  const failure = selectPostValidationFailure([item], false);
  switch (failure?.category) {
    case 'empty-content':
      return 'пустой пост';
    case 'invalid-settings':
      return (
        item.settingsError ||
        'нужны настройки канала — опубликуйте его через app.vezdepost.ru'
      );
    case 'provider-validity':
      return String(item.errors);
    case 'too-long':
      return `слишком длинный текст (максимум ${item.maximumCharacters})`;
    case 'content-error':
      return item.contentError || 'контент не подходит для канала';
    default:
      return undefined;
  }
};

// Nest HTTP exceptions keep the useful text in their response body.
const errorText = (error: unknown) => {
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  const message = (response as { message?: unknown } | undefined)?.message;
  if (Array.isArray(message)) {
    return message.join('; ');
  }
  if (typeof message === 'string') {
    return message;
  }
  return (error as Error)?.message || 'ошибка публикации';
};

/** Turns a Telegram draft into dashboard posts, one per selected channel. */
export class TelegramAssistantPublisher {
  constructor(private readonly deps: TelegramAssistantPublisherDeps) {}

  private async activeIntegrations(organizationId: string) {
    const integrations = await this.deps.integrationService.getIntegrationsList(
      organizationId
    );
    return integrations.filter(
      (integration) =>
        !integration.disabled &&
        !integration.refreshNeeded &&
        !integration.inBetweenSteps
    );
  }

  async listChannels(organizationId: string): Promise<DraftChannel[]> {
    return (await this.activeIntegrations(organizationId)).map(
      ({ id, name, providerIdentifier }) => ({ id, name, providerIdentifier })
    );
  }

  async publish(organizationId: string, draft: Draft): Promise<PublishResult> {
    if (!draft.selected.length) {
      throw new PublishError('Выберите хотя бы один канал');
    }
    if (!draft.text.trim() && !draft.files.length) {
      throw new PublishError('Пустой пост');
    }

    const integrations = (await this.activeIntegrations(organizationId)).filter(
      (integration) => draft.selected.includes(integration.id)
    );
    if (!integrations.length) {
      throw new PublishError(
        'Выбранные каналы недоступны — подключите их заново'
      );
    }

    const image = [];
    for (const file of draft.files) {
      const stored = await this.deps.storeFile(
        await this.deps.api.downloadFile(file.fileId),
        file.kind
      );
      const media = await this.deps.mediaService.saveFile(
        organizationId,
        stored.name,
        stored.path
      );
      image.push({ id: media.id, path: media.path });
    }
    const content = plainTextToHtml(draft.text);

    const result: PublishResult = { published: [], failed: [] };
    for (const integration of integrations) {
      const settings = { __type: integration.providerIdentifier };
      try {
        const [validation] = await this.deps.postsService.validatePosts(
          organizationId,
          [
            {
              integration: { id: integration.id },
              settings,
              value: [{ content, image }],
            },
          ]
        );
        const problem = validationMessage(validation);
        if (problem) {
          result.failed.push({ name: integration.name, error: problem });
          continue;
        }
        const body = await this.deps.postsService.mapTypeToPost(
          {
            type: 'now',
            date: new Date().toISOString(),
            shortLink: false,
            tags: [],
            posts: [
              {
                integration,
                group: makeId(10),
                settings,
                value: [{ content, id: makeId(10), delay: 0, image }],
              },
            ],
          } as any,
          organizationId
        );
        await this.deps.postsService.createPost(organizationId, body, 'API');
        result.published.push(integration.name);
      } catch (error) {
        result.failed.push({
          name: integration.name,
          error: errorText(error),
        });
      }
    }
    return result;
  }
}
