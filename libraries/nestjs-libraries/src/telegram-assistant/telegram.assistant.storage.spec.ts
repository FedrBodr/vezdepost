import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { storeTelegramFile } from './telegram.assistant.storage';

describe('storeTelegramFile', () => {
  it('uploads a detected image with its real extension', async () => {
    const jpeg = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#fff' },
    })
      .jpeg()
      .toBuffer();
    const storage = {
      uploadFile: vi.fn(async (file: any) => ({
        path: `https://app.test/uploads/${file.originalname}`,
        originalname: file.originalname,
      })),
    };

    const stored = await storeTelegramFile(jpeg, storage as any);

    expect(storage.uploadFile.mock.calls[0][0]).toMatchObject({
      mimetype: 'image/jpeg',
      size: jpeg.length,
      originalname: expect.stringMatching(/\.jpg$/),
    });
    expect(stored).toEqual({
      path: expect.stringMatching(/^https:\/\/app\.test\/uploads\/.+\.jpg$/),
      name: expect.stringMatching(/\.jpg$/),
    });
  });

  it('refuses files that are not supported images or MP4 video', async () => {
    const storage = { uploadFile: vi.fn() };

    await expect(
      storeTelegramFile(Buffer.from('%PDF-1.4 hello'), storage as any)
    ).rejects.toThrow('Неподдерживаемый формат');
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });
});
