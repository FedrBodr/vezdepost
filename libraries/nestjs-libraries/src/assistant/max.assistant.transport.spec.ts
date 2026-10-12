import { describe, expect, it, vi } from 'vitest';
import { MaxAssistantTransport, toMaxKeyboard } from './max.assistant.transport';

const keyboard = {
  inline_keyboard: [
    [{ text: 'A', callback_data: 't:1' }],
    [{ text: '🚀', callback_data: 'p' }],
  ],
};

describe('MaxAssistantTransport', () => {
  it('maps the canonical keyboard to MAX callback buttons', () => {
    expect(toMaxKeyboard(keyboard)).toEqual({
      type: 'inline_keyboard',
      payload: {
        buttons: [
          [{ type: 'callback', text: 'A', payload: 't:1' }],
          [{ type: 'callback', text: '🚀', payload: 'p' }],
        ],
      },
    });
  });

  it('sends, edits, deletes and answers through the MAX API', async () => {
    const api = {
      sendMessageToChat: vi.fn(async () => ({ body: { mid: 'm1' } })),
      editMessage: vi.fn(async () => ({ success: true })),
      deleteMessage: vi.fn(async () => {
        throw new Error('gone');
      }),
      answerOnCallback: vi.fn(async () => ({ success: true })),
    };
    const transport = new MaxAssistantTransport(api as any, vi.fn());

    await expect(transport.sendMessage('500', 'hi', keyboard)).resolves.toBe(
      'm1'
    );
    expect(api.sendMessageToChat).toHaveBeenCalledWith(500, 'hi', {
      attachments: [toMaxKeyboard(keyboard)],
    });
    await transport.editMessage('500', 'm1', 'edited');
    expect(api.editMessage).toHaveBeenCalledWith('m1', {
      text: 'edited',
      attachments: [],
    });
    await expect(transport.deleteMessage('500', 'm1')).resolves.toBeUndefined();
    await transport.answerCallback('cb', 'ok');
    expect(api.answerOnCallback).toHaveBeenCalledWith('cb', {
      notification: 'ok',
    });
  });

  it('downloads a file by url within the limit', async () => {
    const download = vi.fn(async () => Buffer.from('img'));
    const transport = new MaxAssistantTransport({} as any, download);
    await expect(transport.downloadFile('https://cdn/x.jpg')).resolves.toEqual(
      Buffer.from('img')
    );
    expect(download).toHaveBeenCalledWith(
      'https://cdn/x.jpg',
      transport.maxFileBytes
    );
  });

  it('polls message, callback and start updates with the marker', async () => {
    const api = {
      getUpdates: vi.fn(async () => ({ updates: [{ update_type: 'x' }], marker: 9 })),
    };
    const transport = new MaxAssistantTransport(api as any, vi.fn());
    await expect(transport.getUpdates(5, 25)).resolves.toEqual({
      updates: [{ update_type: 'x' }],
      marker: 9,
    });
    expect(api.getUpdates).toHaveBeenCalledWith(
      ['message_created', 'message_callback', 'bot_started'],
      { marker: 5, timeout: 25 }
    );
  });
});
