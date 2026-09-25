import { request as httpsRequest } from 'https';
import { randomBytes } from 'crypto';

export class TelegramApiError extends Error {
  constructor(
    message: string,
    public readonly method: string,
    public readonly errorCode?: number
  ) {
    super(message);
    this.name = 'TelegramApiError';
  }
}

export type TelegramUploadFile = {
  field: string;
  filename: string;
  contentType: string;
  data: Buffer;
};

/**
 * Minimal Bot API transport over the classic node https stack — mirrors what
 * node-telegram-bot-api uses, so rich messages ride the same network path as
 * every legacy send (the pinned library predates sendRichMessage).
 */
const sendTelegramRequest = <T>(
  token: string,
  method: string,
  body: Buffer,
  contentType: string,
  timeoutMs: number
): Promise<T> =>
  new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        hostname: 'api.telegram.org',
        path: `/bot${token}/${method}`,
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'Content-Length': body.length,
        },
        timeout: timeoutMs,
      },
      (response) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          data += chunk;
        });
        response.on('end', () => {
          let parsed: {
            ok?: boolean;
            result?: T;
            description?: string;
            error_code?: number;
          };
          try {
            parsed = JSON.parse(data);
          } catch {
            reject(new Error(`Telegram ${method} returned invalid JSON`));
            return;
          }
          if (response.statusCode && response.statusCode >= 400) {
            reject(
              new TelegramApiError(
                parsed?.description ||
                  `Telegram ${method} failed with status ${response.statusCode}`,
                method,
                parsed?.error_code ?? response.statusCode
              )
            );
            return;
          }
          if (!parsed?.ok) {
            reject(
              new TelegramApiError(
                parsed?.description || `Telegram ${method} failed`,
                method,
                parsed?.error_code
              )
            );
            return;
          }
          resolve(parsed.result as T);
        });
      }
    );
    request.on('timeout', () =>
      request.destroy(new Error(`Telegram ${method} timed out`))
    );
    request.on('error', reject);
    request.write(body);
    request.end();
  });

export const callTelegramApi = <T = unknown>(
  token: string,
  method: string,
  payload: unknown
): Promise<T> =>
  sendTelegramRequest<T>(
    token,
    method,
    Buffer.from(JSON.stringify(payload), 'utf8'),
    'application/json',
    60_000
  );

export const buildTelegramMultipartBody = (
  fields: Record<string, string>,
  file: TelegramUploadFile,
  boundary: string
): Buffer => {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        'utf8'
      )
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      'utf8'
    ),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  );
  return Buffer.concat(parts);
};

/** Uploads one file (attach://<field>) together with plain form fields. */
export const callTelegramApiMultipart = <T = unknown>(
  token: string,
  method: string,
  fields: Record<string, string>,
  file: TelegramUploadFile
): Promise<T> => {
  const boundary = `----vezdepost${randomBytes(12).toString('hex')}`;
  return sendTelegramRequest<T>(
    token,
    method,
    buildTelegramMultipartBody(fields, file, boundary),
    `multipart/form-data; boundary=${boundary}`,
    300_000
  );
};
