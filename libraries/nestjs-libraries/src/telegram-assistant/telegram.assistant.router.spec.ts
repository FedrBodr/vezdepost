import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryKeyValueStore } from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import { DraftStore } from './telegram.assistant.draft';
import { PublishError } from './telegram.assistant.publisher';
import { TelegramAssistantRouter } from './telegram.assistant.router';

const USER = 7;
const message = (patch: any) => ({
  update_id: 1,
  message: {
    message_id: 10,
    chat: { id: USER, type: 'private' },
    from: { id: USER },
    ...patch,
  },
});
const press = (data: string) => ({
  update_id: 2,
  callback_query: {
    id: 'cb-1',
    from: { id: USER },
    data,
    message: { message_id: 99, chat: { id: USER } },
  },
});

const make = (linked = true) => {
  let nextMessageId = 100;
  const api = {
    sendMessage: vi.fn(async () => nextMessageId++),
    editMessage: vi.fn(async () => undefined),
    deleteMessage: vi.fn(async () => undefined),
    answerCallback: vi.fn(async () => undefined),
  };
  const linkService = {
    consumeLinkCode: vi.fn(async (code: string) =>
      code === 'good' ? { organizationId: 'org-1' } : null
    ),
    findLink: vi.fn(async () => (linked ? { organizationId: 'org-1' } : null)),
  };
  const publisher = {
    listChannels: vi.fn(async () => [
      { id: 'vk-1', name: 'My VK', providerIdentifier: 'vk' },
    ]),
    publish: vi.fn(async () => ({
      published: ['My VK'],
      failed: [{ name: 'Boards', error: 'Board is required' }],
    })),
  };
  const drafts = new DraftStore(new MemoryKeyValueStore());
  const router = new TelegramAssistantRouter({
    api: api as any,
    linkService: linkService as any,
    publisher: publisher as any,
    drafts,
    appUrl: 'https://app.vezdepost.ru',
  });
  return { router, api, linkService, publisher, drafts };
};

const lastText = (api: { sendMessage: any }) =>
  api.sendMessage.mock.calls.at(-1)[1] as string;

describe('TelegramAssistantRouter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('links the account from the start payload', async () => {
    const { router, api, linkService } = make(false);

    await router.handle(message({ text: '/start good' }));

    expect(linkService.consumeLinkCode).toHaveBeenCalledWith('good', USER);
    expect(lastText(api)).toContain('привязан');
  });

  it('explains how to link with an expired code', async () => {
    const { router, api } = make(false);

    await router.handle(message({ text: '/start expired' }));

    expect(lastText(api)).toContain('устарела');
  });

  it('asks unlinked users to link from the app', async () => {
    const { router, api, publisher } = make(false);

    await router.handle(message({ text: 'Hello' }));

    expect(lastText(api)).toContain('https://app.vezdepost.ru');
    expect(publisher.listChannels).not.toHaveBeenCalled();
  });

  it('ignores group chats', async () => {
    const { router, api } = make();

    await router.handle(
      message({ text: 'Hi', chat: { id: -5, type: 'supergroup' } })
    );

    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('adds messages to the draft and keeps one panel at the bottom', async () => {
    const { router, api, drafts } = make();

    await router.handle(message({ text: 'Hello' }));
    await router.handle(message({ photo: [{ file_id: 'p1' }] }));

    const draft = await drafts.get(USER);
    expect(draft.text).toBe('Hello');
    expect(draft.files).toHaveLength(1);
    expect(api.deleteMessage).toHaveBeenCalledWith(USER, 100);
    expect(draft.panelMessageId).toBe(101);
    const [, text, keyboard] = api.sendMessage.mock.calls.at(-1);
    expect(text).toContain('Файлы: 1');
    expect(keyboard.inline_keyboard[0][0].callback_data).toBe('t:vk-1');
  });

  it('tells the user why a file was refused', async () => {
    const { router, api } = make();

    await router.handle(
      message({ video: { file_id: 'big', file_size: 30 * 1024 * 1024 } })
    );

    expect(api.sendMessage.mock.calls[0][1]).toContain('20 МБ');
  });

  it('toggles a channel from the panel', async () => {
    const { router, api, drafts } = make();
    await router.handle(message({ text: 'Hello' }));

    await router.handle(press('t:vk-1'));

    expect((await drafts.get(USER)).selected).toEqual(['vk-1']);
    expect(
      api.editMessage.mock.calls.at(-1)[3].inline_keyboard[0][0].text
    ).toContain('✅');
    expect(api.answerCallback).toHaveBeenCalledWith('cb-1', undefined);
  });

  it('publishes the draft and reports each channel', async () => {
    const { router, api, publisher, drafts } = make();
    await router.handle(message({ text: 'Hello' }));
    await router.handle(press('t:vk-1'));

    await router.handle(press('p'));

    expect(api.answerCallback).toHaveBeenCalledWith('cb-1', '⏳ Публикую…');
    expect(api.answerCallback.mock.invocationCallOrder.at(-1)).toBeLessThan(
      publisher.publish.mock.invocationCallOrder[0]
    );
    expect(publisher.publish).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ text: 'Hello', selected: ['vk-1'] })
    );
    expect(lastText(api)).toContain('My VK');
    expect(lastText(api)).toContain('Boards: Board is required');
    expect((await drafts.get(USER)).text).toBe('');
  });

  it('keeps the draft and explains a fixable problem', async () => {
    const { router, api, publisher, drafts } = make();
    publisher.publish.mockRejectedValueOnce(
      new PublishError('Выберите хотя бы один канал')
    );
    await router.handle(message({ text: 'Hello' }));

    await router.handle(press('p'));

    expect(lastText(api)).toContain('Выберите хотя бы один канал');
    expect((await drafts.get(USER)).text).toBe('Hello');
  });

  it('resets the draft', async () => {
    const { router, drafts } = make();
    await router.handle(message({ text: 'Hello' }));

    await router.handle(press('r'));

    expect((await drafts.get(USER)).text).toBe('');
  });
});
