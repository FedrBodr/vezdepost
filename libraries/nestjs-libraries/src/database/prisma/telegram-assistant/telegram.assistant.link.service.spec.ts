import { describe, expect, it, vi } from 'vitest';
import { MemoryKeyValueStore } from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import { TelegramAssistantLinkService } from './telegram.assistant.link.service';

const makeRepository = () => {
  const links = new Map<string, any>();
  return {
    links,
    upsertLink: vi.fn(
      async (
        telegramUserId: string,
        userId: string,
        organizationId: string
      ) => {
        const link = { telegramUserId, userId, organizationId };
        links.set(telegramUserId, link);
        return link;
      }
    ),
    findByTelegramUserId: vi.fn(
      async (telegramUserId: string) => links.get(telegramUserId) ?? null
    ),
    isActiveMember: vi.fn(async () => true),
    deleteByTelegramUserId: vi.fn(async (telegramUserId: string) => {
      links.delete(telegramUserId);
    }),
  };
};

const make = () => {
  const repository = makeRepository();
  const store = new MemoryKeyValueStore();
  const service = new TelegramAssistantLinkService(
    repository as any,
    store,
    'vezde_post_bot'
  );
  return { service, repository, store };
};

describe('TelegramAssistantLinkService', () => {
  it('creates a one-time deep link for the user and organization', async () => {
    const { service } = make();

    const url = await service.createLinkUrl('user-1', 'org-1');

    expect(url).toMatch(
      /^https:\/\/t\.me\/vezde_post_bot\?start=[A-Za-z0-9_-]{16,64}$/
    );
  });

  it('links the Telegram user once per code', async () => {
    const { service, repository } = make();
    const code = new URL(
      await service.createLinkUrl('user-1', 'org-1')
    ).searchParams.get('start')!;

    await expect(service.consumeLinkCode(code, 777)).resolves.toEqual({
      telegramUserId: '777',
      userId: 'user-1',
      organizationId: 'org-1',
    });
    await expect(service.consumeLinkCode(code, 888)).resolves.toBeNull();
    expect(repository.upsertLink).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown codes', async () => {
    const { service } = make();

    await expect(service.consumeLinkCode('nope', 777)).resolves.toBeNull();
  });

  it('finds an existing link', async () => {
    const { service } = make();
    const code = new URL(
      await service.createLinkUrl('user-1', 'org-1')
    ).searchParams.get('start')!;
    await service.consumeLinkCode(code, 777);

    await expect(service.findLink(777)).resolves.toMatchObject({
      organizationId: 'org-1',
    });
    await expect(service.findLink(999)).resolves.toBeNull();
  });

  it('drops the link once the user left the organization', async () => {
    const { service, repository } = make();
    const code = new URL(
      await service.createLinkUrl('user-1', 'org-1')
    ).searchParams.get('start')!;
    await service.consumeLinkCode(code, 777);
    repository.isActiveMember.mockResolvedValue(false);

    await expect(service.findLink(777)).resolves.toBeNull();
    expect(repository.isActiveMember).toHaveBeenCalledWith('user-1', 'org-1');
    expect(repository.deleteByTelegramUserId).toHaveBeenCalledWith('777');
  });
});
