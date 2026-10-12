import { describe, expect, it, vi } from 'vitest';
import { MemoryKeyValueStore } from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import { TelegramAssistantLinkService } from './telegram.assistant.link.service';

const makeRepository = () => {
  const links = new Map<string, any>();
  const key = (transport: string, id: string) => `${transport}:${id}`;
  return {
    links,
    upsertLink: vi.fn(
      async (
        transport: string,
        telegramUserId: string,
        userId: string,
        organizationId: string
      ) => {
        const link = { transport, telegramUserId, userId, organizationId };
        links.set(key(transport, telegramUserId), link);
        return link;
      }
    ),
    findByMessengerUserId: vi.fn(
      async (transport: string, telegramUserId: string) =>
        links.get(key(transport, telegramUserId)) ?? null
    ),
    isActiveMember: vi.fn(async () => true),
    deleteByMessengerUserId: vi.fn(
      async (transport: string, telegramUserId: string) => {
        links.delete(key(transport, telegramUserId));
      }
    ),
  };
};

const make = () => {
  const repository = makeRepository();
  const store = new MemoryKeyValueStore();
  const service = new TelegramAssistantLinkService(
    repository as any,
    store,
    'vezde_post_bot',
    'vezdepost_assistant_bot'
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

  it('builds a MAX deep link', async () => {
    const { service } = make();
    const url = await service.createLinkUrl('u', 'o', 'max');
    expect(url).toMatch(
      /^https:\/\/max\.ru\/vezdepost_assistant_bot\?start=[A-Za-z0-9_-]+$/
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
    expect(repository.upsertLink).toHaveBeenCalledWith(
      'telegram',
      '777',
      'user-1',
      'org-1'
    );
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

  it('finds a legacy link by transport telegram', async () => {
    const { service, repository } = make();
    repository.links.set('telegram:5', {
      transport: 'telegram',
      telegramUserId: '5',
      userId: 'u',
      organizationId: 'o',
    });
    await expect(service.findLink(5)).resolves.toMatchObject({
      organizationId: 'o',
    });
    expect(repository.findByMessengerUserId).toHaveBeenCalledWith(
      'telegram',
      '5'
    );
  });

  it('keeps links apart per transport', async () => {
    const { service, store } = make();
    await store.set(
      'tg-assistant:link:c1',
      JSON.stringify({ userId: 'u1', organizationId: 'o1' })
    );
    await store.set(
      'tg-assistant:link:c2',
      JSON.stringify({ userId: 'u2', organizationId: 'o2' })
    );
    await service.consumeLinkCode('c1', 5, 'telegram');
    await service.consumeLinkCode('c2', 5, 'max');
    expect((await service.findLink(5, 'telegram'))?.organizationId).toBe('o1');
    expect((await service.findLink(5, 'max'))?.organizationId).toBe('o2');
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
    expect(repository.deleteByMessengerUserId).toHaveBeenCalledWith(
      'telegram',
      '777'
    );
  });
});
