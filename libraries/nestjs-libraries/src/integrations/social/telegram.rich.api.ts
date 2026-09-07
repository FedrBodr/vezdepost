import { request as httpsRequest } from 'https';

/**
 * Minimal Bot API transport over the classic node https stack — mirrors what
 * node-telegram-bot-api uses, so rich messages ride the same network path as
 * every legacy send (the pinned library predates sendRichMessage).
 */
export const callTelegramApi = <T = unknown>(
  token: string,
  method: string,
  payload: unknown
): Promise<T> =>
  new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = httpsRequest(
      {
        hostname: 'api.telegram.org',
        path: `/bot${token}/${method}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 60_000,
      },
      (response) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          data += chunk;
        });
        response.on('end', () => {
          let parsed: { ok?: boolean; result?: T; description?: string };
          try {
            parsed = JSON.parse(data);
          } catch {
            reject(new Error(`Telegram ${method} returned invalid JSON`));
            return;
          }
          if (response.statusCode && response.statusCode >= 400) {
            reject(
              new Error(
                parsed?.description ||
                  `Telegram ${method} failed with status ${response.statusCode}`
              )
            );
            return;
          }
          if (!parsed?.ok) {
            reject(
              new Error(parsed?.description || `Telegram ${method} failed`)
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
