import { beforeEach, describe, expect, it, vi } from 'vitest';

const callMock = vi.hoisted(() => vi.fn());
const multipartMock = vi.hoisted(() => vi.fn());
vi.mock('./telegram.rich.api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./telegram.rich.api')>()),
  callTelegramApi: callMock,
  callTelegramApiMultipart: multipartMock,
}));

import { buildTelegramMultipartBody } from './telegram.rich.api';
import { TelegramBusinessApi } from './telegram.business.api';
import { MemoryKeyValueStore } from './telegram.kv.store';

describe('buildTelegramMultipartBody', () => {
  it('encodes fields and the file part', () => {
    const body = buildTelegramMultipartBody(
      { business_connection_id: 'bc-1' },
      {
        field: 'story',
        filename: 'story.jpg',
        contentType: 'image/jpeg',
        data: Buffer.from('JPEG'),
      },
      'BOUNDARY'
    ).toString('utf8');

    expect(body).toContain(
      '--BOUNDARY\r\nContent-Disposition: form-data; name="business_connection_id"\r\n\r\nbc-1\r\n'
    );
    expect(body).toContain(
      'Content-Disposition: form-data; name="story"; filename="story.jpg"\r\nContent-Type: image/jpeg\r\n\r\nJPEG\r\n'
    );
    expect(body.endsWith('--BOUNDARY--\r\n')).toBe(true);
  });
});

describe('TelegramBusinessApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads a business connection', async () => {
    callMock.mockResolvedValue({
      id: 'bc-1',
      is_enabled: true,
      user: { id: 7 },
    });

    await expect(
      new TelegramBusinessApi('T').getBusinessConnection('bc-1')
    ).resolves.toMatchObject({ id: 'bc-1' });
    expect(callMock).toHaveBeenCalledWith('T', 'getBusinessConnection', {
      business_connection_id: 'bc-1',
    });
  });

  it('posts a video story with an attached upload', async () => {
    multipartMock.mockResolvedValue({ id: 99, chat: { id: 7 } });

    await new TelegramBusinessApi('T').postStory({
      businessConnectionId: 'bc-1',
      kind: 'video',
      file: Buffer.from('MP4'),
      durationSeconds: 12.5,
      activePeriod: 86400,
      caption: '<b>Hi</b>',
    });

    const [, method, fields, file] = multipartMock.mock.calls[0];
    expect(method).toBe('postStory');
    expect(JSON.parse(fields.content)).toEqual({
      type: 'video',
      video: 'attach://story',
      duration: 12.5,
      is_animation: false,
    });
    expect(fields).toMatchObject({
      business_connection_id: 'bc-1',
      active_period: '86400',
      caption: '<b>Hi</b>',
      parse_mode: 'HTML',
    });
    expect(file).toMatchObject({
      field: 'story',
      filename: 'story.mp4',
      contentType: 'video/mp4',
    });
  });

  it('omits empty captions', async () => {
    multipartMock.mockResolvedValue({ id: 1 });

    await new TelegramBusinessApi('T').postStory({
      businessConnectionId: 'bc',
      kind: 'photo',
      file: Buffer.from('x'),
      activePeriod: 21600,
      caption: '',
    });

    const [, , fields] = multipartMock.mock.calls[0];
    expect(fields.caption).toBeUndefined();
    expect(fields.parse_mode).toBeUndefined();
    expect(JSON.parse(fields.content)).toEqual({
      type: 'photo',
      photo: 'attach://story',
    });
  });
});

describe('MemoryKeyValueStore', () => {
  it('honours NX', async () => {
    const store = new MemoryKeyValueStore();

    expect(await store.set('k', '1', 'PX', 1000, 'NX')).toBe('OK');
    expect(await store.set('k', '2', 'PX', 1000, 'NX')).toBeNull();
    expect(await store.get('k')).toBe('1');
    await store.del('k');
    expect(await store.get('k')).toBeNull();
  });
});
