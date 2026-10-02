import { Readable } from 'stream';
import { randomBytes } from 'crypto';
import { PUBLISHABLE_MIME } from '@gitroom/nestjs-libraries/telegram-assistant/telegram.assistant.draft';
import type { IUploadProvider } from '@gitroom/nestjs-libraries/upload/upload.interface';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fromBuffer } = require('file-type');

/** Detects the real type of a Telegram file and stores it like an upload. */
export const storeTelegramFile = async (
  buffer: Buffer,
  storage: Pick<IUploadProvider, 'uploadFile'>
) => {
  const detected = await fromBuffer(buffer);
  if (!detected || !PUBLISHABLE_MIME.has(detected.mime)) {
    throw new Error(
      'Неподдерживаемый формат файла — отправьте JPG, PNG, GIF, WEBP или MP4'
    );
  }
  const originalname = `telegram-${randomBytes(6).toString('hex')}.${
    detected.ext
  }`;
  const uploaded = await storage.uploadFile({
    buffer,
    mimetype: detected.mime,
    size: buffer.length,
    path: '',
    fieldname: '',
    destination: '',
    stream: new Readable(),
    filename: '',
    originalname,
    encoding: '',
  } as Express.Multer.File);
  return {
    path: uploaded.path as string,
    name: uploaded.originalname as string,
  };
};
