import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import {
  PostValidationResult,
  selectPostValidationFailure,
} from '@gitroom/nestjs-libraries/database/prisma/posts/post.validation';
import type { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import type { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

/** A problem the user can fix; its message is shown as is. */
export class QuickPostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuickPostError';
  }
}

export type QuickPostSchedule =
  | { type: 'now' }
  | { type: 'queue' }
  | { type: 'date'; date: string };

export type QuickPostMedia = { id: string; path: string };

export type QuickPostInput = {
  text: string;
  media: QuickPostMedia[];
  integrationIds: string[];
  schedule: QuickPostSchedule;
};

export type QuickPostChannel = {
  id: string;
  name: string;
  providerIdentifier: string;
};

export type QuickPostResult = {
  published: Array<{ id: string; name: string }>;
  failed: Array<{ id: string; name: string; error: string }>;
};

export type QuickPostDeps = {
  integrationService: Pick<IntegrationService, 'getIntegrationsList'>;
  postsService: Pick<
    PostsService,
    'validatePosts' | 'mapTypeToPost' | 'createPost' | 'findFreeDateTime'
  >;
  now?: () => Date;
};

// Verbatim from telegram.assistant.draft.ts: only these three characters.
const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain text to the editor's HTML: one paragraph per non-empty line. */
export const plainTextToHtml = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');

export const validationMessage = (item: PostValidationResult) => {
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
export const errorText = (error: unknown) => {
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

/** Creates one dashboard post per selected channel with default settings. */
export class QuickPostService {
  constructor(private readonly deps: QuickPostDeps) {}

  private now() {
    return (this.deps.now ?? (() => new Date()))();
  }

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

  async listChannels(organizationId: string): Promise<QuickPostChannel[]> {
    return (await this.activeIntegrations(organizationId)).map(
      ({ id, name, providerIdentifier }) => ({ id, name, providerIdentifier })
    );
  }

  private async scheduleFor(
    organizationId: string,
    integrationId: string,
    schedule: QuickPostSchedule
  ): Promise<{ type: 'now' | 'schedule'; date: string }> {
    switch (schedule.type) {
      case 'now':
        return { type: 'now', date: this.now().toISOString() };
      case 'queue':
        return {
          type: 'schedule',
          date: await this.deps.postsService.findFreeDateTime(
            organizationId,
            integrationId
          ),
        };
      case 'date':
        return { type: 'schedule', date: schedule.date };
    }
  }

  async publish(
    organizationId: string,
    input: QuickPostInput,
    creationMethod: 'WEB' | 'API'
  ): Promise<QuickPostResult> {
    const ids = Array.from(new Set(input.integrationIds));
    if (!ids.length) {
      throw new QuickPostError('Выберите хотя бы один канал');
    }
    if (!input.text.trim() && !input.media.length) {
      throw new QuickPostError('Пустой пост');
    }
    if (
      input.schedule.type === 'date' &&
      new Date(input.schedule.date).getTime() <= this.now().getTime()
    ) {
      throw new QuickPostError('Дата публикации уже прошла');
    }

    const integrations = (await this.activeIntegrations(organizationId)).filter(
      (integration) => ids.includes(integration.id)
    );
    if (!integrations.length) {
      throw new QuickPostError(
        'Выбранные каналы недоступны — подключите их заново'
      );
    }

    const content = plainTextToHtml(input.text);
    const image = input.media.map(({ id, path }) => ({ id, path }));

    const result: QuickPostResult = { published: [], failed: [] };
    for (const integration of integrations) {
      const settings = { __type: integration.providerIdentifier };
      const channel = { id: integration.id, name: integration.name };
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
          result.failed.push({ ...channel, error: problem });
          continue;
        }
        const when = await this.scheduleFor(
          organizationId,
          integration.id,
          input.schedule
        );
        const body = await this.deps.postsService.mapTypeToPost(
          {
            ...when,
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
        await this.deps.postsService.createPost(
          organizationId,
          body,
          creationMethod
        );
        result.published.push(channel);
      } catch (error) {
        result.failed.push({ ...channel, error: errorText(error) });
      }
    }
    return result;
  }
}
