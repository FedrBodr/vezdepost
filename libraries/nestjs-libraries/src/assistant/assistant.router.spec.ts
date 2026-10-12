import { describe, expect, it, vi } from 'vitest';
import { MemoryKeyValueStore } from '@gitroom/nestjs-libraries/integrations/social/telegram.kv.store';
import { DraftStore } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.draft';
import { AssistantRouter } from './assistant.router';

const msg = (text: string, extra: any = {}) => ({
  kind: 'message',
  chatId: '7',
  userId: '7',
  text,
  ...extra,
});
const press = (data: string) => ({
  kind: 'callback',
  chatId: '7',
  userId: '7',
  messageId: '99',
  callbackId: 'cb',
  data,
});

const make = (linked = true) => {
  let next = 100;
  const transport = {
    name: 'max' as const,
    maxFileBytes: 1000,
    sendMessage: vi.fn(async () => String(next++)),
    editMessage: vi.fn(async () => undefined),
    deleteMessage: vi.fn(async () => undefined),
    answerCallback: vi.fn(async () => undefined),
    downloadFile: vi.fn(async () => Buffer.from('x')),
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
    publish: vi.fn(async () => ({ published: ['My VK'], failed: [] })),
  };
  const drafts = new DraftStore(new MemoryKeyValueStore());
  const router = new AssistantRouter({
    transport,
    linkService: linkService as any,
    publisher: publisher as any,
    drafts,
    draftKeyOf: (id) => `max:${id}`,
    appUrl: 'https://app.vezdepost.ru',
    linkButtonLabel: 'Постить из MAX',
    panelDelayMs: 0,
  });
  const handle = async (event: any) => {
    await router.handle(event);
    await router.idle();
  };
  return { handle, transport, linkService, publisher, drafts };
};

const lastText = (transport: { sendMessage: any }) =>
  transport.sendMessage.mock.calls.at(-1)[1] as string;

describe('AssistantRouter', () => {
  it('links the account with /start <code> and uses the transport name', async () => {
    const { handle, linkService, transport } = make(false);
    await handle(msg('/start good'));
    expect(linkService.consumeLinkCode).toHaveBeenCalledWith(
      'good',
      'max',
      '7'
    );
    expect(lastText(transport)).toContain('привязан');
  });

  it('tells the user to get a new link when the code is stale', async () => {
    const { handle, transport } = make(false);
    await handle(msg('/start stale'));
    expect(lastText(transport)).toContain('Постить из MAX');
  });

  it('builds a draft and renders the panel', async () => {
    const { handle, transport } = make();
    await handle(msg('Hello', { file: { fileId: 'f', kind: 'image', size: 10 } }));
    const [, text, keyboard] = transport.sendMessage.mock.calls.at(-1);
    expect(text).toContain('Файлы: 1');
    expect(keyboard.inline_keyboard[0][0].callback_data).toBe('t:vk-1');
  });

  it('refuses a file above the transport limit', async () => {
    const { handle, transport } = make();
    await handle(msg('', { file: { fileId: 'f', kind: 'image', size: 5000 } }));
    expect(transport.sendMessage.mock.calls[0][1]).toContain('больше');
  });

  it('publishes with the transport downloader', async () => {
    const { handle, transport, publisher } = make();
    await handle(msg('Hello'));
    await handle(press('t:vk-1'));
    await handle(press('p'));
    expect(publisher.publish).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ selected: ['vk-1'] }),
      transport.downloadFile
    );
    expect(lastText(transport)).toContain('✅');
  });
});
