import { describe, expect, it } from 'vitest';
import { maxUpdateToEvent } from './max.events';

const user = { user_id: 42, name: 'U', username: null };
const created = (body: any) => ({
  update_type: 'message_created',
  timestamp: 1,
  message: {
    sender: user,
    recipient: { chat_id: 500, chat_type: 'dialog' },
    timestamp: 1,
    body: { mid: 'm1', seq: 1, text: null, attachments: null, ...body },
  },
});

describe('maxUpdateToEvent', () => {
  it('maps a text message in a dialog', () => {
    expect(maxUpdateToEvent(created({ text: ' hi ' }) as any)).toEqual({
      kind: 'message',
      chatId: '500',
      userId: '42',
      text: 'hi',
    });
  });

  it('maps an image attachment to a file keyed by its url', () => {
    expect(
      maxUpdateToEvent(
        created({
          attachments: [
            {
              type: 'image',
              payload: { url: 'https://cdn/x.jpg', token: 't', photo_id: 1 },
            },
          ],
        }) as any
      )
    ).toEqual({
      kind: 'message',
      chatId: '500',
      userId: '42',
      text: '',
      files: [{ fileId: 'https://cdn/x.jpg', kind: 'image' }],
    });
  });

  it('refuses a video attachment with a clear message', () => {
    expect(
      maxUpdateToEvent(
        created({
          attachments: [
            { type: 'video', payload: { url: 'https://cdn/v', token: 't' } },
          ],
        }) as any
      )
    ).toMatchObject({ kind: 'message', unsupported: true });
  });

  it('keeps every photo of an album', () => {
    const event = maxUpdateToEvent(
      created({
        attachments: [
          { type: 'image', payload: { url: 'https://cdn/1.jpg', token: 't' } },
          { type: 'image', payload: { url: 'https://cdn/2.jpg', token: 't' } },
        ],
      }) as any
    ) as any;
    expect(event.files).toHaveLength(2);
    expect(event.unsupported).toBeUndefined();
  });

  it('refuses the whole message when a video comes with a photo', () => {
    const event = maxUpdateToEvent(
      created({
        attachments: [
          { type: 'image', payload: { url: 'https://cdn/1.jpg', token: 't' } },
          { type: 'video', payload: { url: 'https://cdn/v', token: 't' } },
        ],
      }) as any
    ) as any;
    expect(event.unsupported).toBe(true);
    expect(event.files).toBeUndefined();
  });

  it('maps a button press', () => {
    expect(
      maxUpdateToEvent({
        update_type: 'message_callback',
        timestamp: 1,
        callback: { timestamp: 1, callback_id: 'cb', payload: 't:vk', user },
        message: {
          sender: user,
          recipient: { chat_id: 500, chat_type: 'dialog' },
          timestamp: 1,
          body: { mid: 'm9', seq: 2, text: '', attachments: null },
        },
      } as any)
    ).toEqual({
      kind: 'callback',
      chatId: '500',
      userId: '42',
      messageId: 'm9',
      callbackId: 'cb',
      data: 't:vk',
    });
  });

  it('turns bot_started with a payload into /start <code>', () => {
    expect(
      maxUpdateToEvent({
        update_type: 'bot_started',
        timestamp: 1,
        chat_id: 500,
        user,
        payload: 'abc',
      } as any)
    ).toEqual({ kind: 'message', chatId: '500', userId: '42', text: '/start abc' });
  });

  it('ignores other updates and non-dialog chats', () => {
    expect(
      maxUpdateToEvent({
        update_type: 'message_removed',
        timestamp: 1,
        message_id: 'x',
        chat_id: 1,
        user_id: 1,
      } as any)
    ).toBeNull();
    const group = created({ text: 'x' });
    group.message.recipient = { chat_id: 1, chat_type: 'chat' };
    expect(maxUpdateToEvent(group as any)).toBeNull();
  });
});
