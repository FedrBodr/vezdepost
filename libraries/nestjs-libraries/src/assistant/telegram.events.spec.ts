import { describe, expect, it } from 'vitest';
import { telegramUpdateToEvent } from './telegram.events';

const base = { update_id: 1 };

describe('telegramUpdateToEvent', () => {
  it('maps a private text message', () => {
    expect(
      telegramUpdateToEvent({
        ...base,
        message: {
          message_id: 10,
          chat: { id: 7, type: 'private' },
          from: { id: 7 },
          text: ' hi ',
        },
      })
    ).toEqual({ kind: 'message', chatId: '7', userId: '7', text: 'hi' });
  });

  it('maps the largest photo and a caption', () => {
    expect(
      telegramUpdateToEvent({
        ...base,
        message: {
          message_id: 10,
          chat: { id: 7, type: 'private' },
          from: { id: 7 },
          caption: 'c',
          photo: [
            { file_id: 's', file_size: 1 },
            { file_id: 'l', file_size: 9 },
          ],
        },
      })
    ).toEqual({
      kind: 'message',
      chatId: '7',
      userId: '7',
      text: 'c',
      file: { fileId: 'l', kind: 'image', size: 9 },
    });
  });

  it('flags unsupported documents', () => {
    const event = telegramUpdateToEvent({
      ...base,
      message: {
        message_id: 10,
        chat: { id: 7, type: 'private' },
        from: { id: 7 },
        document: { file_id: 'd', mime_type: 'application/pdf' },
      },
    });
    expect(event).toMatchObject({ kind: 'message', unsupported: true });
  });

  it('maps a button press', () => {
    expect(
      telegramUpdateToEvent({
        ...base,
        callback_query: {
          id: 'cb',
          from: { id: 7 },
          data: 't:vk',
          message: { message_id: 99, chat: { id: 7 } },
        },
      })
    ).toEqual({
      kind: 'callback',
      chatId: '7',
      userId: '7',
      messageId: '99',
      callbackId: 'cb',
      data: 't:vk',
    });
  });

  it('ignores group chats and empty updates', () => {
    expect(
      telegramUpdateToEvent({
        ...base,
        message: {
          message_id: 1,
          chat: { id: 1, type: 'group' },
          from: { id: 1 },
          text: 'x',
        },
      })
    ).toBeNull();
    expect(telegramUpdateToEvent({ ...base })).toBeNull();
  });
});
