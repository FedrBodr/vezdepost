import { describe, expect, it } from 'vitest';
import {
  addMessageToDraft,
  emptyDraft,
  plainTextToHtml,
  renderPanel,
  toggleChannel,
} from './telegram.assistant.draft';

const channels = [
  { id: 'vk-1', name: 'My VK', providerIdentifier: 'vk' },
  { id: 'tg-1', name: 'Channel', providerIdentifier: 'telegram' },
];

describe('addMessageToDraft', () => {
  it('collects text, the largest photo and a video', () => {
    let draft = emptyDraft();
    draft = addMessageToDraft(draft, {
      message_id: 1,
      chat: { id: 1, type: 'private' },
      text: 'Hello',
    }).draft;
    draft = addMessageToDraft(draft, {
      message_id: 2,
      chat: { id: 1, type: 'private' },
      caption: 'Second',
      photo: [{ file_id: 'small' }, { file_id: 'large' }],
    }).draft;
    draft = addMessageToDraft(draft, {
      message_id: 3,
      chat: { id: 1, type: 'private' },
      video: { file_id: 'clip', file_size: 100 },
    }).draft;

    expect(draft.text).toBe('Hello\n\nSecond');
    expect(draft.files).toEqual([
      { fileId: 'large', kind: 'image' },
      { fileId: 'clip', kind: 'video' },
    ]);
  });

  it('accepts image and video documents and rejects other files', () => {
    const image = addMessageToDraft(emptyDraft(), {
      message_id: 1,
      chat: { id: 1, type: 'private' },
      document: { file_id: 'doc', mime_type: 'image/png' },
    });
    const pdf = addMessageToDraft(emptyDraft(), {
      message_id: 1,
      chat: { id: 1, type: 'private' },
      document: { file_id: 'pdf', mime_type: 'application/pdf' },
    });

    expect(image.draft.files).toEqual([{ fileId: 'doc', kind: 'image' }]);
    expect(pdf.error).toBe('unsupported');
    expect(pdf.draft.files).toEqual([]);
  });

  it('refuses files above the Bot API limit and more than ten files', () => {
    const big = addMessageToDraft(emptyDraft(), {
      message_id: 1,
      chat: { id: 1, type: 'private' },
      video: { file_id: 'big', file_size: 21 * 1024 * 1024 },
    });
    expect(big.error).toBe('too_large');

    let draft = emptyDraft();
    for (let i = 0; i < 10; i++) {
      draft = addMessageToDraft(draft, {
        message_id: i,
        chat: { id: 1, type: 'private' },
        photo: [{ file_id: `p${i}` }],
      }).draft;
    }
    const eleventh = addMessageToDraft(draft, {
      message_id: 11,
      chat: { id: 1, type: 'private' },
      photo: [{ file_id: 'p11' }],
    });
    expect(eleventh.error).toBe('too_many');
    expect(eleventh.draft.files).toHaveLength(10);
  });
});

describe('publishable formats', () => {
  it.each([
    [{ document: { file_id: 'heic', mime_type: 'image/heic' } }],
    [{ document: { file_id: 'mov', mime_type: 'video/quicktime' } }],
    [{ video: { file_id: 'mov', mime_type: 'video/quicktime' } }],
  ])('refuses %j at draft time', (patch) => {
    const result = addMessageToDraft(emptyDraft(), {
      message_id: 1,
      chat: { id: 1, type: 'private' },
      ...(patch as any),
    });

    expect(result.error).toBe('unsupported');
    expect(result.draft.files).toEqual([]);
  });
});

describe('renderPanel', () => {
  it('shows a toggle per channel and the actions', () => {
    const draft = toggleChannel(
      {
        ...emptyDraft(),
        text: 'Hello',
        files: [{ fileId: 'a', kind: 'image' }],
      },
      'vk-1'
    );

    const panel = renderPanel(draft, channels);

    expect(panel.text).toContain('Текст: 5');
    expect(panel.text).toContain('Файлы: 1');
    expect(panel.keyboard.inline_keyboard).toEqual([
      [{ text: '✅ My VK · vk', callback_data: 't:vk-1' }],
      [{ text: '▫️ Channel · telegram', callback_data: 't:tg-1' }],
      [
        { text: '🚀 Опубликовать', callback_data: 'p' },
        { text: '🗑 Сбросить', callback_data: 'r' },
      ],
    ]);
  });

  it('toggles a channel off again', () => {
    const once = toggleChannel(emptyDraft(), 'vk-1');
    expect(toggleChannel(once, 'vk-1').selected).toEqual([]);
  });
});

describe('plainTextToHtml', () => {
  it('escapes HTML and keeps lines as paragraphs', () => {
    expect(plainTextToHtml('Hi <b> & co\n\nNext line')).toBe(
      '<p>Hi &lt;b&gt; &amp; co</p><p>Next line</p>'
    );
    expect(plainTextToHtml('')).toBe('');
  });
});
